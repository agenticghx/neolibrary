---------------------------- MODULE SpendCap ----------------------------
(***************************************************************************)
(* The spending cap on paid AI, as lib/ai/generate.ts builds it.           *)
(*                                                                         *)
(* Written for: a Claude session (or a developer) checking a change to     *)
(* the files listed in SKILL.md. Each action names the code it stands for. *)
(*                                                                         *)
(* One call runs generate():                                               *)
(*   findStored / copyShared  -> LookForSavedAnswer                        *)
(*   inflight.get / .set      -> CheckSameRequestInFlight                  *)
(*   reserveSpend: lockSpend runs `read` (the SELECTs of spendingWithJobs) *)
(*     -> TakeLockAndReadSpending; then assertRoom + addHold, and the      *)
(*     lock's turn ends            -> DecideAndHold                        *)
(*   model.generate           -> TheAiAnswers / TheAiFailsButBills /       *)
(*                               TheAiFailsUnbilled                        *)
(*   insert generations       -> SaveTheAnswer (SaveFails: a database or   *)
(*                               storage error after a paid answer)        *)
(*   insert failed_spend      -> RecordTheBilledFailure                    *)
(*   finally release() + inflight.delete -> ReleaseTheHold                 *)
(* Text-edition start (lib/library/text-edition.ts, textEditionSummary +   *)
(* the insert of the job row) -> TextEditionReads / TextEditionDecides;    *)
(* its batch -> TextEditionBilled / TextEditionStored / TextEditionEnds.   *)
(*                                                                         *)
(* Money is in whole units (think "cents"). All calls are for one          *)
(* provider, in one month, on one book group (a scan and its text edition: *)
(* bookGroup), so the month cap and the book cap both count every call.    *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
    N,                   \* how many paid requests arrive (calls 1..N)
    SameRequest,         \* calls that are the identical request from one reader (same cache key)
    OnEdition,           \* calls whose bookId is the text edition, not the scan (same book group)
    OnSecondServer,      \* calls handled by a second copy of the server (its own memory)
    Estimate,            \* estimateCost(...) of each call
    MaxCost,             \* the most one call can be billed (its maxTokens of output, real tokens)
    CapMonth, CapBook,   \* AI_CAP_PER_MONTH_USD, AI_CAP_PER_BOOK_USD
    CanRestart,          \* the server may restart once, mid-call
    SaveCanFail,         \* saving a paid answer may fail (database or storage error)
    TextEditionStart,    \* a text-edition job is started on the book at the same time
    TextEditionEstimate, \* that job's estimateUsd
    Mutant               \* "none" describes the code; anything else is a broken variant (see SKILL.md)

ASSUME Mutant \in {"none", "noLock", "releaseBeforeSave", "noFailedSpendRecord", "releaseOnlyOnSuccess"}

Calls   == 1..N
Servers == {"first", "second"}
Books   == {"scan", "edition"}
ServerOf(c) == IF c \in OnSecondServer THEN "second" ELSE "first"
BookOf(c)   == IF c \in OnEdition THEN "edition" ELSE "scan"
KeyOf(c)    == IF c \in SameRequest THEN 0 ELSE c
Keys        == {KeyOf(c) : c \in Calls}
Free        == 0          \* no call holds the lock / no call in flight for a key

\* Where a call is. Finished: "done" (paid or failed, hold released), "reused" (a saved or
\* shared answer, free), "refused" (SpendingCapReached), "lost" (its server restarted).
Finished == {"done", "reused", "refused", "lost"}

VARIABLES
    pc,          \* pc[c]: the step call c is at
    lock,        \* lock[s]: the call whose reserve/release turn runs in server s (spendTails)
    holdMonth,   \* holdMonth[s]: spendHolds[monthKey] in server s
    holdBook,    \* holdBook[s][b]: spendHolds[bookKey(b)] in server s
    seen,        \* seen[c]: what `read` returned to call c (recorded spending + text-edition job holds)
    billed,      \* billed[c]: what the AI provider has charged for call c
    recorded,    \* recorded[c]: what the database holds for call c (generations or failed_spend)
    reserved,    \* reserved[c]: call c's estimate is in the holds (between its hold and its release)
    inflight,    \* inflight[s][k]: the call running for request key k in server s
    saved,       \* keys with a saved answer in generations
    answered,    \* answered[c]: call c got a usable, paid answer
    path,        \* path[c]: "ok" once the answer is saved; "failed" on any failure path
    restarted,   \* the one restart has happened
    te,          \* the text-edition job: "idle", "deciding", "refused", "waiting", "answered", "stored", "ended"
    teSeen, teHold, teBilled, teRecorded

vars == <<pc, lock, holdMonth, holdBook, seen, billed, recorded, reserved, inflight, saved,
          answered, path, restarted, te, teSeen, teHold, teBilled, teRecorded>>

RECURSIVE SumOver(_, _)
SumOver(f, S) == IF S = {} THEN 0 ELSE LET x == CHOOSE x \in S : TRUE IN f[x] + SumOver(f, S \ {x})

RecordedAll == SumOver(recorded, Calls) + teRecorded
BilledAll   == SumOver(billed, Calls) + teBilled

Init ==
    /\ pc = [c \in Calls |-> "new"]
    /\ lock = [s \in Servers |-> Free]
    /\ holdMonth = [s \in Servers |-> 0]
    /\ holdBook = [s \in Servers |-> [b \in Books |-> 0]]
    /\ seen = [c \in Calls |-> 0]
    /\ billed = [c \in Calls |-> 0]
    /\ recorded = [c \in Calls |-> 0]
    /\ reserved = [c \in Calls |-> FALSE]
    /\ inflight = [s \in Servers |-> [k \in Keys |-> Free]]
    /\ saved = {}
    /\ answered = [c \in Calls |-> FALSE]
    /\ path = [c \in Calls |-> "none"]
    /\ restarted = FALSE
    /\ te = "idle"
    /\ teSeen = 0 /\ teHold = 0 /\ teBilled = 0 /\ teRecorded = 0

LockFree(s) == Mutant = "noLock" \/ lock[s] = Free

UnchangedTe == UNCHANGED <<te, teSeen, teHold, teBilled, teRecorded>>

-----------------------------------------------------------------------------
(* generate(): one call's steps *)

\* findStored, then copyShared: a saved answer (this reader's or a shared one) is served free.
LookForSavedAnswer(c) ==
    /\ pc[c] = "new"
    /\ pc' = [pc EXCEPT ![c] = IF KeyOf(c) \in saved THEN "reused" ELSE "looked"]
    /\ UNCHANGED <<lock, holdMonth, holdBook, seen, billed, recorded, reserved, inflight, saved,
                   answered, path, restarted>> /\ UnchangedTe

\* inflight.get(key): the same request already running in this server is shared, free.
\* Otherwise inflight.set(key, job), and the job queues for reserveSpend's lock (no await between).
CheckSameRequestInFlight(c) ==
    LET s == ServerOf(c) IN
    /\ pc[c] = "looked"
    /\ IF inflight[s][KeyOf(c)] # Free
         THEN /\ pc' = [pc EXCEPT ![c] = "reused"]
              /\ UNCHANGED inflight
         ELSE /\ pc' = [pc EXCEPT ![c] = "waitLock"]
              /\ inflight' = [inflight EXCEPT ![s][KeyOf(c)] = c]
    /\ UNCHANGED <<lock, holdMonth, holdBook, seen, billed, recorded, reserved, saved, answered,
                   path, restarted>> /\ UnchangedTe

\* reserveSpend: the lock's turn starts and `read` (spendingWithJobs) runs its SELECTs.
\* Other calls' inserts may land meanwhile; their holds stay until they release, which waits for the lock.
TakeLockAndReadSpending(c) ==
    LET s == ServerOf(c) IN
    /\ pc[c] = "waitLock"
    /\ LockFree(s)
    /\ lock' = IF Mutant = "noLock" THEN lock ELSE [lock EXCEPT ![s] = c]
    /\ seen' = [seen EXCEPT ![c] = RecordedAll + teHold]
    /\ pc' = [pc EXCEPT ![c] = "deciding"]
    /\ UNCHANGED <<holdMonth, holdBook, billed, recorded, reserved, inflight, saved, answered,
                   path, restarted>> /\ UnchangedTe

\* assertRoom(spent, held, estimate): held is this server's month hold and this bookId's hold.
\* Passing: addHold for the month and the book. Either way the lock's turn ends.
DecideAndHold(c) ==
    LET s == ServerOf(c)
        b == BookOf(c)
        fits == /\ seen[c] + holdMonth[s] + Estimate <= CapMonth
                /\ seen[c] + holdBook[s][b] + Estimate <= CapBook
    IN
    /\ pc[c] = "deciding"
    /\ lock' = IF Mutant = "noLock" THEN lock ELSE [lock EXCEPT ![s] = Free]
    /\ IF fits
         THEN /\ pc' = [pc EXCEPT ![c] = "calling"]
              /\ holdMonth' = [holdMonth EXCEPT ![s] = @ + Estimate]
              /\ holdBook' = [holdBook EXCEPT ![s][b] = @ + Estimate]
              /\ reserved' = [reserved EXCEPT ![c] = TRUE]
              /\ UNCHANGED inflight
         ELSE \* SpendingCapReached: the job rejects and generate's finally deletes the inflight entry.
              /\ pc' = [pc EXCEPT ![c] = "refused"]
              /\ inflight' = [inflight EXCEPT ![s][KeyOf(c)] = Free]
              /\ UNCHANGED <<holdMonth, holdBook, reserved>>
    /\ UNCHANGED <<seen, billed, recorded, saved, answered, path, restarted>> /\ UnchangedTe

\* model.generate returns a usable answer: the provider has charged for it.
TheAiAnswers(c) ==
    /\ pc[c] = "calling"
    /\ \E x \in 1..MaxCost : billed' = [billed EXCEPT ![c] = x]
    /\ answered' = [answered EXCEPT ![c] = TRUE]
    /\ pc' = [pc EXCEPT ![c] = IF Mutant = "releaseBeforeSave" THEN "releasingEarly" ELSE "saving"]
    /\ UNCHANGED <<lock, holdMonth, holdBook, seen, recorded, reserved, inflight, saved, path,
                   restarted>> /\ UnchangedTe

\* model.generate throws an AiError with `billed` (declined, cut off, empty): charged, nothing usable.
TheAiFailsButBills(c) ==
    /\ pc[c] = "calling"
    /\ \E x \in 1..MaxCost : billed' = [billed EXCEPT ![c] = x]
    /\ pc' = [pc EXCEPT ![c] = "recordingFailure"]
    /\ path' = [path EXCEPT ![c] = "failed"]
    /\ UNCHANGED <<lock, holdMonth, holdBook, seen, recorded, reserved, inflight, saved, answered,
                   restarted>> /\ UnchangedTe

\* model.generate throws without `billed` (no answer at all: rate limit, 5xx, refused key): not charged.
TheAiFailsUnbilled(c) ==
    /\ pc[c] = "calling"
    /\ pc' = [pc EXCEPT ![c] = "releasing"]
    /\ path' = [path EXCEPT ![c] = "failed"]
    /\ UNCHANGED <<lock, holdMonth, holdBook, seen, billed, recorded, reserved, inflight, saved,
                   answered, restarted>> /\ UnchangedTe

\* insert into generations, with the answer's real cost.
SaveTheAnswer(c) ==
    /\ pc[c] = "saving"
    /\ recorded' = [recorded EXCEPT ![c] = billed[c]]
    /\ saved' = saved \cup {KeyOf(c)}
    /\ path' = [path EXCEPT ![c] = "ok"]
    /\ pc' = [pc EXCEPT ![c] = "releasing"]
    /\ UNCHANGED <<lock, holdMonth, holdBook, seen, billed, reserved, inflight, answered,
                   restarted>> /\ UnchangedTe

\* The insert throws (not an AiError): the catch writes no failed_spend, finally releases.
SaveFails(c) ==
    /\ SaveCanFail
    /\ pc[c] = "saving"
    /\ path' = [path EXCEPT ![c] = "failed"]
    /\ pc' = [pc EXCEPT ![c] = "releasing"]
    /\ UNCHANGED <<lock, holdMonth, holdBook, seen, billed, recorded, reserved, inflight, saved,
                   answered, restarted>> /\ UnchangedTe

\* catch: insert into failed_spend, before the hold is released.
RecordTheBilledFailure(c) ==
    /\ pc[c] = "recordingFailure"
    /\ recorded' = IF Mutant = "noFailedSpendRecord" THEN recorded ELSE [recorded EXCEPT ![c] = billed[c]]
    /\ pc' = [pc EXCEPT ![c] = "releasing"]
    /\ UNCHANGED <<lock, holdMonth, holdBook, seen, billed, reserved, inflight, saved, answered,
                   path, restarted>> /\ UnchangedTe

\* finally: await release() (its own turn of the lock, no await inside), then inflight.delete(key).
ReleaseTheHold(c) ==
    LET s == ServerOf(c)
        b == BookOf(c)
        skip == Mutant = "releaseOnlyOnSuccess" /\ path[c] = "failed"
    IN
    /\ pc[c] = "releasing"
    /\ LockFree(s)
    /\ IF reserved[c] /\ ~skip
         THEN /\ holdMonth' = [holdMonth EXCEPT ![s] = @ - Estimate]
              /\ holdBook' = [holdBook EXCEPT ![s][b] = @ - Estimate]
              /\ reserved' = [reserved EXCEPT ![c] = FALSE]
         ELSE UNCHANGED <<holdMonth, holdBook, reserved>>
    /\ inflight' = [inflight EXCEPT ![s][KeyOf(c)] = Free]
    /\ pc' = [pc EXCEPT ![c] = "done"]
    /\ UNCHANGED <<lock, seen, billed, recorded, saved, answered, path, restarted>> /\ UnchangedTe

\* Mutant "releaseBeforeSave": the hold goes first, the answer is saved after.
ReleaseEarly(c) ==
    LET s == ServerOf(c)
        b == BookOf(c)
    IN
    /\ pc[c] = "releasingEarly"
    /\ LockFree(s)
    /\ holdMonth' = [holdMonth EXCEPT ![s] = @ - Estimate]
    /\ holdBook' = [holdBook EXCEPT ![s][b] = @ - Estimate]
    /\ reserved' = [reserved EXCEPT ![c] = FALSE]
    /\ pc' = [pc EXCEPT ![c] = "savingLate"]
    /\ UNCHANGED <<lock, seen, billed, recorded, inflight, saved, answered, path, restarted>> /\ UnchangedTe

SaveLate(c) ==
    LET s == ServerOf(c) IN
    /\ pc[c] = "savingLate"
    /\ recorded' = [recorded EXCEPT ![c] = billed[c]]
    /\ saved' = saved \cup {KeyOf(c)}
    /\ path' = [path EXCEPT ![c] = "ok"]
    /\ inflight' = [inflight EXCEPT ![s][KeyOf(c)] = Free]
    /\ pc' = [pc EXCEPT ![c] = "done"]
    /\ UNCHANGED <<lock, holdMonth, holdBook, seen, billed, reserved, answered, restarted>> /\ UnchangedTe

-----------------------------------------------------------------------------
(* The server restarts: spendTails, spendHolds and inflight are gone; calls in it stop. *)

Running == {"looked", "waitLock", "deciding", "calling", "saving", "recordingFailure",
            "releasing", "releasingEarly", "savingLate"}

ServerRestarts ==
    \E s \in Servers :
      /\ CanRestart /\ ~restarted
      /\ \E c \in Calls : ServerOf(c) = s /\ pc[c] \in Running
      /\ restarted' = TRUE
      /\ pc' = [c \in Calls |->
                  IF ServerOf(c) = s /\ pc[c] \in Running
                    THEN (IF pc[c] = "calling" THEN "orphan" ELSE "lost")
                    ELSE pc[c]]
      /\ reserved' = [c \in Calls |-> IF ServerOf(c) = s THEN FALSE ELSE reserved[c]]
      /\ lock' = [lock EXCEPT ![s] = Free]
      /\ holdMonth' = [holdMonth EXCEPT ![s] = 0]
      /\ holdBook' = [holdBook EXCEPT ![s] = [b \in Books |-> 0]]
      /\ inflight' = [inflight EXCEPT ![s] = [k \in Keys |-> Free]]
      /\ UNCHANGED <<seen, billed, recorded, saved, answered, path>> /\ UnchangedTe

\* The request had reached the provider; it finishes it, and may charge, with nobody left to record it.
TheAiFinishesAnOrphanedCall(c) ==
    /\ pc[c] = "orphan"
    /\ \E x \in 0..MaxCost : billed' = [billed EXCEPT ![c] = x]
    /\ pc' = [pc EXCEPT ![c] = "lost"]
    /\ UNCHANGED <<lock, holdMonth, holdBook, seen, recorded, reserved, inflight, saved, answered,
                   path, restarted>> /\ UnchangedTe

-----------------------------------------------------------------------------
(* A text-edition job starts beside the calls (startTextEdition). *)

\* textEditionSummary: spendingWithJobs, outside lockSpend; the in-memory holds are not read.
TextEditionReads ==
    /\ TextEditionStart /\ te = "idle"
    /\ teSeen' = RecordedAll + teHold
    /\ te' = "deciding"
    /\ UNCHANGED <<teHold, teBilled, teRecorded>>
    /\ UNCHANGED <<pc, lock, holdMonth, holdBook, seen, billed, recorded, reserved, inflight, saved,
                   answered, path, restarted>>

\* overLimit check, then the job row is inserted: from now on heldByJobs counts its estimate.
TextEditionDecides ==
    /\ te = "deciding"
    /\ IF teSeen + TextEditionEstimate <= CapBook /\ teSeen + TextEditionEstimate <= CapMonth
         THEN te' = "waiting" /\ teHold' = TextEditionEstimate
         ELSE te' = "refused" /\ UNCHANGED teHold
    /\ UNCHANGED <<teSeen, teBilled, teRecorded>>
    /\ UNCHANGED <<pc, lock, holdMonth, holdBook, seen, billed, recorded, reserved, inflight, saved,
                   answered, path, restarted>>

\* Anthropic answers the batch, and charges for it (at most the job's estimate here).
TextEditionBilled ==
    /\ te = "waiting"
    /\ \E x \in 1..TextEditionEstimate : teBilled' = x
    /\ te' = "answered"
    /\ UNCHANGED <<teSeen, teHold, teRecorded>>
    /\ UNCHANGED <<pc, lock, holdMonth, holdBook, seen, billed, recorded, reserved, inflight, saved,
                   answered, path, restarted>>

\* storeBatch: each page read becomes a generations row; heldByJobs keeps estimate - stored.
TextEditionStored ==
    /\ te = "answered"
    /\ teRecorded' = teBilled
    /\ teHold' = TextEditionEstimate - teBilled
    /\ te' = "stored"
    /\ UNCHANGED <<teSeen, teBilled>>
    /\ UNCHANGED <<pc, lock, holdMonth, holdBook, seen, billed, recorded, reserved, inflight, saved,
                   answered, path, restarted>>

\* finishIfDone: the job ends, and so does its hold.
TextEditionEnds ==
    /\ te = "stored"
    /\ teHold' = 0
    /\ te' = "ended"
    /\ UNCHANGED <<teSeen, teBilled, teRecorded>>
    /\ UNCHANGED <<pc, lock, holdMonth, holdBook, seen, billed, recorded, reserved, inflight, saved,
                   answered, path, restarted>>

-----------------------------------------------------------------------------

\* Every call has finished (an end state, not a deadlock).
AllFinished ==
    /\ \A c \in Calls : pc[c] \in Finished
    /\ te \in {"idle", "refused", "ended"}
    /\ UNCHANGED vars

Next ==
    \/ \E c \in Calls :
         \/ LookForSavedAnswer(c)
         \/ CheckSameRequestInFlight(c)
         \/ TakeLockAndReadSpending(c)
         \/ DecideAndHold(c)
         \/ TheAiAnswers(c)
         \/ TheAiFailsButBills(c)
         \/ TheAiFailsUnbilled(c)
         \/ SaveTheAnswer(c)
         \/ SaveFails(c)
         \/ RecordTheBilledFailure(c)
         \/ ReleaseTheHold(c)
         \/ ReleaseEarly(c)
         \/ SaveLate(c)
         \/ TheAiFinishesAnOrphanedCall(c)
    \/ ServerRestarts
    \/ TextEditionReads
    \/ TextEditionDecides
    \/ TextEditionBilled
    \/ TextEditionStored
    \/ TextEditionEnds
    \/ AllFinished

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* The rules *)

\* Money the provider has charged never passes the month's cap or the book's cap.
CapNeverPassed ==
    /\ BilledAll <= CapMonth
    /\ BilledAll <= CapBook

\* Money charged but not yet written to the database is still covered by the call's hold,
\* so the next cap check sees it. (The text-edition job: by its job hold.)
ChargedMoneyAlwaysCounted ==
    /\ \A c \in Calls : billed[c] <= recorded[c] + (IF reserved[c] THEN Estimate ELSE 0)
    /\ teBilled <= teRecorded + teHold

\* The holds are exactly the estimates of the calls holding a reservation: none leaked, none
\* released twice, and a finished call holds nothing.
ReservationReleasedOnce ==
    /\ \A s \in Servers :
         holdMonth[s] = Estimate * Cardinality({c \in Calls : ServerOf(c) = s /\ reserved[c]})
    /\ \A s \in Servers, b \in Books :
         holdBook[s][b] = Estimate * Cardinality({c \in Calls : ServerOf(c) = s /\ BookOf(c) = b /\ reserved[c]})
    /\ \A c \in Calls : pc[c] \in Finished => ~reserved[c]

\* A finished call has written exactly what it was charged: once, billed failures included.
EveryChargeRecordedOnce ==
    \A c \in Calls : pc[c] = "done" => recorded[c] = billed[c]

\* The same request from one reader is paid for once: two identical requests share one call.
PaidOncePerAnswer ==
    \A k \in Keys : Cardinality({c \in Calls : KeyOf(c) = k /\ answered[c]}) <= 1

TypeOK ==
    /\ pc \in [Calls -> {"new", "looked", "waitLock", "deciding", "calling", "saving",
                         "recordingFailure", "releasing", "releasingEarly", "savingLate",
                         "orphan"} \cup Finished]
    /\ \A s \in Servers : holdMonth[s] \in Nat
=============================================================================
