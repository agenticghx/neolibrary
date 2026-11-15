---------------------------- MODULE SpendCap ----------------------------
(***************************************************************************)
(* The spending cap on paid AI, as lib/ai/generate.ts builds it.           *)
(*                                                                         *)
(* Written for: a Claude session (or a developer) checking a change to     *)
(* the files listed in SKILL.md. Each action names the code it stands for. *)
(*                                                                         *)
(* A hold (the reservation of a call's estimate) is a row in the database  *)
(* (failed_spend, kind 'spend-hold'), written and removed under one        *)
(* Postgres advisory lock (withSpendLock), so every copy of the server     *)
(* sees it and a restart does not lose it.                                 *)
(*                                                                         *)
(* One call runs generate():                                               *)
(*   findStored / copyShared  -> LookForSavedAnswer                        *)
(*   inflight.get / .set      -> CheckSameRequestInFlight                  *)
(*   findStored / copyShared again, in the job -> LookAgain                *)
(*   reserveSpend: withSpendLock takes the lock and `spendingWithJobs`     *)
(*     reads (hold rows included) -> TakeLockAndReadSpending; then         *)
(*     assertRoom + insert the hold row, commit -> DecideAndHold           *)
(*   holdCost (the most the call can be billed) is what reserveSpend holds *)
(*   model.generate           -> TheAiAnswers / TheAiFailsButBills /       *)
(*                               TheAiFailsUnbilled; a refusal rescued by  *)
(*                               the fallback model -> TheAiFallsBackAndAnswers *)
(*   insert generations       -> SaveTheAnswer (SaveFails: it throws)      *)
(*   hold.billed (the hold row becomes the real cost) ->                   *)
(*     RecordTheBilledFailure / RecordTheLostAnswer                        *)
(*   hold.release (the hold row is deleted) -> ReleaseTheHold              *)
(*   a database write that fails again -> TheRecordFailsToo / ReleaseFails *)
(* Text-edition start (startTextEdition: under withSpendLock, read         *)
(* spendingWithJobs and insert the job row) -> TextEditionReads /          *)
(* TextEditionDecides; its batch -> TextEditionBilled / Stored / Ends.     *)
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
    Likely,              \* estimateCost: a call's likely cost, the price a reader is shown
    MaxCost,             \* the most one call can be billed (all of its maxTokens; holdCost)
    CapMonth, CapBook,   \* AI_CAP_PER_MONTH_USD, AI_CAP_PER_BOOK_USD
    CanRestart,          \* a server may restart once, mid-call
    SaveCanFail,         \* a database write after the AI was paid may fail (and the next one too)
    TextEditionStart,    \* a text-edition job is started on the book at the same time
    TextEditionEstimate, \* that job's estimateUsd (1,000 output tokens a page)
    TextEditionMaxCost,  \* the most its batch can be billed (8,000 output tokens a page)
    CanFallBack,         \* the API's fallback model may rescue a refusal, billed on top of the declined attempt
    Mutant               \* "none" describes the code; anything else is a broken variant (see SKILL.md)

ASSUME Mutant \in {"none", "noLock", "releaseBeforeSave", "noFailedSpendRecord", "releaseOnlyOnSuccess",
                   "holdsInMemory", "textEditionOutsideLock", "lostAnswerNotRecorded",
                   "holdTheLikelyCost", "noSecondLook"}

\* What reserveSpend holds for each call: holdCost, the most it can be billed (M44, finding 1).
\* Mutant "holdTheLikelyCost" (the code before the fix): estimateCost, the likely cost.
Hold    == IF Mutant = "holdTheLikelyCost" THEN Likely ELSE MaxCost

Calls   == 1..N
TeId    == N + 1      \* the text-edition start, when it holds the lock
Servers == {"first", "second"}
Books   == {"scan", "edition"}
ServerOf(c) == IF c \in OnSecondServer THEN "second" ELSE "first"
BookOf(c)   == IF c \in OnEdition THEN "edition" ELSE "scan"
KeyOf(c)    == IF c \in SameRequest THEN 0 ELSE c
Keys        == {KeyOf(c) : c \in Calls}
Free        == 0          \* no call holds the lock / no call in flight for a key

\* The lock a call's reserve and release take: the advisory lock in the database, shared by every
\* copy of the server. Mutant "holdsInMemory" (the code before the fix): each server's own lockSpend.
LockDomains == {"db"} \cup Servers
LockOf(c)   == IF Mutant = "holdsInMemory" THEN ServerOf(c) ELSE "db"
TeLocks     == Mutant \notin {"holdsInMemory", "textEditionOutsideLock"}

\* Where a call is. Finished: "done" (paid or failed, its cost settled), "reused" (a saved or
\* shared answer, free), "refused" (SpendingCapReached), "lost" (its server restarted).
Finished == {"done", "reused", "refused", "lost"}

VARIABLES
    pc,          \* pc[c]: the step call c is at
    lock,        \* lock[d]: the call (or TeId) whose turn under lock d runs
    holdRow,     \* holdRow[c]: call c's hold (its estimate) is a row in failed_spend
    left,        \* left[c]: call c's hold was left behind on purpose (restart, or a write failed twice)
    seen,        \* seen[c]: what `read` returned to call c, [m |-> month, b |-> book]
    billed,      \* billed[c]: what the AI provider has charged for call c
    recorded,    \* recorded[c]: the real cost written for call c (generations or failed_spend)
    inflight,    \* inflight[s][k]: the call running for request key k in server s
    saved,       \* keys with a saved answer in generations
    answered,    \* answered[c]: call c got a usable, paid answer
    path,        \* path[c]: "ok" once the answer is saved; "failed" on any failure path
    declined,    \* declined[c]: the part of billed[c] a declined attempt cost, before a fallback rescued it
    restarted,   \* the one restart has happened
    te,          \* the text-edition job: "idle", "deciding", "refused", "waiting", "answered", "stored", "ended"
    teSeen, teHold, teBilled, teRecorded

vars == <<pc, lock, holdRow, left, seen, billed, recorded, inflight, saved,
          answered, path, declined, restarted, te, teSeen, teHold, teBilled, teRecorded>>

RECURSIVE SumOver(_, _)
SumOver(f, S) == IF S = {} THEN 0 ELSE LET x == CHOOSE x \in S : TRUE IN f[x] + SumOver(f, S \ {x})

RecordedAll == SumOver(recorded, Calls) + teRecorded
BilledAll   == SumOver(billed, Calls) + teBilled
HeldAll     == Hold * Cardinality({d \in Calls : holdRow[d]})

\* The holds call c's read sees. Rows in the database: all of them (every server, both books of the
\* group). Mutant "holdsInMemory": only its own server's, and for the book only its own bookId's.
HeldSeenMonth(c) ==
    IF Mutant = "holdsInMemory"
      THEN Hold * Cardinality({d \in Calls : holdRow[d] /\ ServerOf(d) = ServerOf(c)})
      ELSE HeldAll
HeldSeenBook(c) ==
    IF Mutant = "holdsInMemory"
      THEN Hold * Cardinality({d \in Calls : holdRow[d] /\ ServerOf(d) = ServerOf(c) /\ BookOf(d) = BookOf(c)})
      ELSE HeldAll

Init ==
    /\ pc = [c \in Calls |-> "new"]
    /\ lock = [d \in LockDomains |-> Free]
    /\ holdRow = [c \in Calls |-> FALSE]
    /\ left = [c \in Calls |-> FALSE]
    /\ seen = [c \in Calls |-> [m |-> 0, b |-> 0]]
    /\ billed = [c \in Calls |-> 0]
    /\ recorded = [c \in Calls |-> 0]
    /\ inflight = [s \in Servers |-> [k \in Keys |-> Free]]
    /\ saved = {}
    /\ answered = [c \in Calls |-> FALSE]
    /\ path = [c \in Calls |-> "none"]
    /\ declined = [c \in Calls |-> 0]
    /\ restarted = FALSE
    /\ te = "idle"
    /\ teSeen = 0 /\ teHold = 0 /\ teBilled = 0 /\ teRecorded = 0

LockFree(c) == Mutant = "noLock" \/ lock[LockOf(c)] = Free

\* (declined changes only in TheAiFallsBackAndAnswers, which lists these itself.)
UnchangedTe == UNCHANGED <<te, teSeen, teHold, teBilled, teRecorded, declined>>

\* What the code writes as call c's cost: claude.ts reads the top-level usage, which covers only the
\* attempt that produced the answer, so a declined attempt before a fallback rescue is not in it.
Reported(c) == billed[c] - declined[c]

-----------------------------------------------------------------------------
(* generate(): one call's steps *)

\* findStored, then copyShared: a saved answer (this reader's or a shared one) is served free.
LookForSavedAnswer(c) ==
    /\ pc[c] = "new"
    /\ pc' = [pc EXCEPT ![c] = IF KeyOf(c) \in saved THEN "reused" ELSE "looked"]
    /\ UNCHANGED <<lock, holdRow, left, seen, billed, recorded, inflight, saved,
                   answered, path, restarted>> /\ UnchangedTe

\* inflight.get(key): the same request already running in this server is shared, free.
\* Otherwise the job starts and inflight.set(key, job) (no await between).
\* Mutant "noSecondLook" (the code before the fix of finding 7): the job goes straight to reserveSpend.
CheckSameRequestInFlight(c) ==
    LET s == ServerOf(c) IN
    /\ pc[c] = "looked"
    /\ IF inflight[s][KeyOf(c)] # Free
         THEN /\ pc' = [pc EXCEPT ![c] = "reused"]
              /\ UNCHANGED inflight
         ELSE /\ pc' = [pc EXCEPT ![c] = IF Mutant = "noSecondLook" THEN "waitLock" ELSE "lookingAgain"]
              /\ inflight' = [inflight EXCEPT ![s][KeyOf(c)] = c]
    /\ UNCHANGED <<lock, holdRow, left, seen, billed, recorded, saved, answered,
                   path, restarted>> /\ UnchangedTe

\* The job's first step (M44, finding 7): findStored / copyShared again. An identical request that
\* finished since the first look saved its answer before it left the in-flight map: found here, free;
\* generate's finally deletes this call's entry. Otherwise the job queues for reserveSpend's lock.
LookAgain(c) ==
    /\ pc[c] = "lookingAgain"
    /\ IF KeyOf(c) \in saved
         THEN /\ pc' = [pc EXCEPT ![c] = "reused"]
              /\ inflight' = [inflight EXCEPT ![ServerOf(c)][KeyOf(c)] = Free]
         ELSE /\ pc' = [pc EXCEPT ![c] = "waitLock"]
              /\ UNCHANGED inflight
    /\ UNCHANGED <<lock, holdRow, left, seen, billed, recorded, saved, answered,
                   path, restarted>> /\ UnchangedTe

\* reserveSpend: withSpendLock takes the lock, and `read` (spendingWithJobs, on the transaction)
\* runs its SELECTs: the hold rows are in failed_spend, so they are read with what was spent.
TakeLockAndReadSpending(c) ==
    /\ pc[c] = "waitLock"
    /\ LockFree(c)
    /\ lock' = IF Mutant = "noLock" THEN lock ELSE [lock EXCEPT ![LockOf(c)] = c]
    /\ seen' = [seen EXCEPT ![c] = [m |-> RecordedAll + teHold + HeldSeenMonth(c),
                                    b |-> RecordedAll + teHold + HeldSeenBook(c)]]
    /\ pc' = [pc EXCEPT ![c] = "deciding"]
    /\ UNCHANGED <<holdRow, left, billed, recorded, inflight, saved, answered,
                   path, restarted>> /\ UnchangedTe

\* assertRoom(spent, estimate); passing: insert the hold row. The transaction commits, the lock goes.
DecideAndHold(c) ==
    LET fits == /\ seen[c].m + Hold <= CapMonth
                /\ seen[c].b + Hold <= CapBook
    IN
    /\ pc[c] = "deciding"
    /\ lock' = IF Mutant = "noLock" THEN lock ELSE [lock EXCEPT ![LockOf(c)] = Free]
    /\ IF fits
         THEN /\ pc' = [pc EXCEPT ![c] = "calling"]
              /\ holdRow' = [holdRow EXCEPT ![c] = TRUE]
              /\ UNCHANGED inflight
         ELSE \* SpendingCapReached: the job rejects and generate's finally deletes the inflight entry.
              /\ pc' = [pc EXCEPT ![c] = "refused"]
              /\ inflight' = [inflight EXCEPT ![ServerOf(c)][KeyOf(c)] = Free]
              /\ UNCHANGED holdRow
    /\ UNCHANGED <<left, seen, billed, recorded, saved, answered, path, restarted>> /\ UnchangedTe

\* model.generate returns a usable answer: the provider has charged for it.
TheAiAnswers(c) ==
    /\ pc[c] = "calling"
    /\ \E x \in 1..MaxCost : billed' = [billed EXCEPT ![c] = x]
    /\ answered' = [answered EXCEPT ![c] = TRUE]
    /\ pc' = [pc EXCEPT ![c] = IF Mutant = "releaseBeforeSave" THEN "releasingEarly" ELSE "saving"]
    /\ UNCHANGED <<lock, holdRow, left, seen, recorded, inflight, saved, path,
                   restarted>> /\ UnchangedTe

\* The requested model declines; the API's fallback model answers in the same call (claude.ts,
\* fallbacks: "default"). Both attempts are billed; the answer reports the fallback's usage only.
TheAiFallsBackAndAnswers(c) ==
    /\ CanFallBack
    /\ pc[c] = "calling"
    /\ \E d \in 1..MaxCost, x \in 1..MaxCost :
          /\ billed' = [billed EXCEPT ![c] = d + x]
          /\ declined' = [declined EXCEPT ![c] = d]
    /\ answered' = [answered EXCEPT ![c] = TRUE]
    /\ pc' = [pc EXCEPT ![c] = IF Mutant = "releaseBeforeSave" THEN "releasingEarly" ELSE "saving"]
    /\ UNCHANGED <<lock, holdRow, left, seen, recorded, inflight, saved, path,
                   restarted, te, teSeen, teHold, teBilled, teRecorded>>

\* model.generate throws an AiError with `billed` (declined, cut off, empty): charged, nothing usable.
TheAiFailsButBills(c) ==
    /\ pc[c] = "calling"
    /\ \E x \in 1..MaxCost : billed' = [billed EXCEPT ![c] = x]
    /\ pc' = [pc EXCEPT ![c] = "recordingFailure"]
    /\ path' = [path EXCEPT ![c] = "failed"]
    /\ UNCHANGED <<lock, holdRow, left, seen, recorded, inflight, saved, answered,
                   restarted>> /\ UnchangedTe

\* model.generate throws without `billed` (no answer at all: rate limit, 5xx, refused key): not charged.
TheAiFailsUnbilled(c) ==
    /\ pc[c] = "calling"
    /\ pc' = [pc EXCEPT ![c] = "releasing"]
    /\ path' = [path EXCEPT ![c] = "failed"]
    /\ UNCHANGED <<lock, holdRow, left, seen, billed, recorded, inflight, saved,
                   answered, restarted>> /\ UnchangedTe

\* insert into generations, with the answer's real cost (outside the lock: the hold still counts).
SaveTheAnswer(c) ==
    /\ pc[c] = "saving"
    /\ recorded' = [recorded EXCEPT ![c] = Reported(c)]
    /\ saved' = saved \cup {KeyOf(c)}
    /\ path' = [path EXCEPT ![c] = "ok"]
    /\ pc' = [pc EXCEPT ![c] = "releasing"]
    /\ UNCHANGED <<lock, holdRow, left, seen, billed, inflight, answered,
                   restarted>> /\ UnchangedTe

\* The insert throws (not an AiError). generate turns the hold into the real cost (hold.billed).
\* Mutant "lostAnswerNotRecorded": it only releases the hold, as the code did before the fix.
SaveFails(c) ==
    /\ SaveCanFail
    /\ pc[c] = "saving"
    /\ path' = [path EXCEPT ![c] = "failed"]
    /\ pc' = [pc EXCEPT ![c] = IF Mutant = "lostAnswerNotRecorded" THEN "releasing" ELSE "recordingLost"]
    /\ UNCHANGED <<lock, holdRow, left, seen, billed, recorded, inflight, saved,
                   answered, restarted>> /\ UnchangedTe

\* hold.billed: under the lock, one UPDATE turns the hold row into the paid answer's real cost.
RecordTheLostAnswer(c) ==
    /\ pc[c] = "recordingLost"
    /\ LockFree(c)
    /\ recorded' = [recorded EXCEPT ![c] = Reported(c)]
    /\ holdRow' = [holdRow EXCEPT ![c] = FALSE]
    /\ inflight' = [inflight EXCEPT ![ServerOf(c)][KeyOf(c)] = Free]
    /\ pc' = [pc EXCEPT ![c] = "done"]
    /\ UNCHANGED <<lock, left, seen, billed, saved, answered, path, restarted>> /\ UnchangedTe

\* catch: hold.billed turns the hold row into the billed failure's real cost (one UPDATE, under the lock).
RecordTheBilledFailure(c) ==
    /\ pc[c] = "recordingFailure"
    /\ LockFree(c)
    /\ recorded' = IF Mutant = "noFailedSpendRecord" THEN recorded ELSE [recorded EXCEPT ![c] = Reported(c)]
    /\ holdRow' = [holdRow EXCEPT ![c] = FALSE]
    /\ inflight' = [inflight EXCEPT ![ServerOf(c)][KeyOf(c)] = Free]
    /\ pc' = [pc EXCEPT ![c] = "done"]
    /\ UNCHANGED <<lock, left, seen, billed, saved, answered, path, restarted>> /\ UnchangedTe

\* The UPDATE fails too (the database is down): the hold row stays, counted at the estimate.
TheRecordFailsToo(c) ==
    /\ SaveCanFail
    /\ pc[c] \in {"recordingLost", "recordingFailure"}
    /\ left' = [left EXCEPT ![c] = TRUE]
    /\ inflight' = [inflight EXCEPT ![ServerOf(c)][KeyOf(c)] = Free]
    /\ pc' = [pc EXCEPT ![c] = "done"]
    /\ UNCHANGED <<lock, holdRow, seen, billed, recorded, saved, answered, path, restarted>> /\ UnchangedTe

\* hold.release: under the lock, the hold row is deleted; then inflight.delete(key).
ReleaseTheHold(c) ==
    LET skip == Mutant = "releaseOnlyOnSuccess" /\ path[c] = "failed" IN
    /\ pc[c] = "releasing"
    /\ LockFree(c)
    /\ holdRow' = IF skip THEN holdRow ELSE [holdRow EXCEPT ![c] = FALSE]
    /\ inflight' = [inflight EXCEPT ![ServerOf(c)][KeyOf(c)] = Free]
    /\ pc' = [pc EXCEPT ![c] = "done"]
    /\ UNCHANGED <<lock, left, seen, billed, recorded, saved, answered, path, restarted>> /\ UnchangedTe

\* The DELETE fails (the database is down): the hold row stays, counted beside the real cost.
ReleaseFails(c) ==
    /\ SaveCanFail
    /\ pc[c] = "releasing"
    /\ left' = [left EXCEPT ![c] = TRUE]
    /\ inflight' = [inflight EXCEPT ![ServerOf(c)][KeyOf(c)] = Free]
    /\ pc' = [pc EXCEPT ![c] = "done"]
    /\ UNCHANGED <<lock, holdRow, seen, billed, recorded, saved, answered, path, restarted>> /\ UnchangedTe

\* Mutant "releaseBeforeSave": the hold goes first, the answer is saved after.
ReleaseEarly(c) ==
    /\ pc[c] = "releasingEarly"
    /\ LockFree(c)
    /\ holdRow' = [holdRow EXCEPT ![c] = FALSE]
    /\ pc' = [pc EXCEPT ![c] = "savingLate"]
    /\ UNCHANGED <<lock, left, seen, billed, recorded, inflight, saved, answered, path, restarted>> /\ UnchangedTe

SaveLate(c) ==
    /\ pc[c] = "savingLate"
    /\ recorded' = [recorded EXCEPT ![c] = Reported(c)]
    /\ saved' = saved \cup {KeyOf(c)}
    /\ path' = [path EXCEPT ![c] = "ok"]
    /\ inflight' = [inflight EXCEPT ![ServerOf(c)][KeyOf(c)] = Free]
    /\ pc' = [pc EXCEPT ![c] = "done"]
    /\ UNCHANGED <<lock, holdRow, left, seen, billed, answered, restarted>> /\ UnchangedTe

-----------------------------------------------------------------------------
(* A server restarts: its memory (lockSpend's queue, inflight) is gone, its open transactions roll *)
(* back and their advisory locks go; calls in it stop. The hold rows stay in the database.        *)
(* Mutant "holdsInMemory": the holds were in that memory, and go too.                             *)

Running == {"looked", "lookingAgain", "waitLock", "deciding", "calling", "saving", "recordingFailure", "recordingLost",
            "releasing", "releasingEarly", "savingLate"}

ServerRestarts ==
    \E s \in Servers :
      LET stops(c) == ServerOf(c) = s /\ pc[c] \in Running IN
      /\ CanRestart /\ ~restarted
      /\ \E c \in Calls : stops(c)
      /\ restarted' = TRUE
      /\ pc' = [c \in Calls |-> IF stops(c) THEN (IF pc[c] = "calling" THEN "orphan" ELSE "lost") ELSE pc[c]]
      /\ holdRow' = [c \in Calls |-> IF Mutant = "holdsInMemory" /\ ServerOf(c) = s THEN FALSE ELSE holdRow[c]]
      /\ left' = [c \in Calls |-> IF stops(c) /\ holdRow[c] THEN TRUE ELSE left[c]]
      /\ lock' = [d \in LockDomains |->
                    IF d = s \/ (lock[d] \in Calls /\ ServerOf(lock[d]) = s) THEN Free ELSE lock[d]]
      /\ inflight' = [inflight EXCEPT ![s] = [k \in Keys |-> Free]]
      /\ UNCHANGED <<seen, billed, recorded, saved, answered, path>> /\ UnchangedTe

\* The request had reached the provider; it finishes it, and may charge, with nobody left to record it.
TheAiFinishesAnOrphanedCall(c) ==
    /\ pc[c] = "orphan"
    /\ \E x \in 0..MaxCost : billed' = [billed EXCEPT ![c] = x]
    /\ pc' = [pc EXCEPT ![c] = "lost"]
    /\ UNCHANGED <<lock, holdRow, left, seen, recorded, inflight, saved, answered,
                   path, restarted>> /\ UnchangedTe

-----------------------------------------------------------------------------
(* A text-edition job starts beside the calls (startTextEdition). *)

\* startTextEdition: under withSpendLock, spendingWithJobs on the transaction (hold rows included).
\* Mutant "textEditionOutsideLock": the same read without the lock. Mutant "holdsInMemory": the
\* code before the fix, the database only, no lock.
TextEditionReads ==
    /\ TextEditionStart /\ te = "idle"
    /\ TeLocks => lock["db"] = Free
    /\ lock' = IF TeLocks THEN [lock EXCEPT !["db"] = TeId] ELSE lock
    /\ teSeen' = RecordedAll + teHold + (IF Mutant = "holdsInMemory" THEN 0 ELSE HeldAll)
    /\ te' = "deciding"
    /\ UNCHANGED <<teHold, teBilled, teRecorded>>
    /\ UNCHANGED <<pc, holdRow, left, seen, billed, recorded, inflight, saved,
                   answered, path, declined, restarted>>

\* The overLimit test, then the job row is inserted: from now on heldByJobs counts its estimate.
TextEditionDecides ==
    /\ te = "deciding"
    /\ lock' = IF TeLocks THEN [lock EXCEPT !["db"] = Free] ELSE lock
    /\ IF teSeen + TextEditionEstimate <= CapBook /\ teSeen + TextEditionEstimate <= CapMonth
         THEN te' = "waiting" /\ teHold' = TextEditionEstimate
         ELSE te' = "refused" /\ UNCHANGED teHold
    /\ UNCHANGED <<teSeen, teBilled, teRecorded>>
    /\ UNCHANGED <<pc, holdRow, left, seen, billed, recorded, inflight, saved,
                   answered, path, declined, restarted>>

\* Anthropic answers the batch, and charges for it: up to TextEditionMaxCost (each page may use all
\* of MAX_TOKENS), while the job holds its estimate (finding 1, what is left).
TextEditionBilled ==
    /\ te = "waiting"
    /\ \E x \in 1..TextEditionMaxCost : teBilled' = x
    /\ te' = "answered"
    /\ UNCHANGED <<teSeen, teHold, teRecorded>>
    /\ UNCHANGED <<pc, lock, holdRow, left, seen, billed, recorded, inflight, saved,
                   answered, path, declined, restarted>>

\* storeBatch: each page read becomes a generations row; heldByJobs keeps estimate - stored.
TextEditionStored ==
    /\ te = "answered"
    /\ teRecorded' = teBilled
    /\ teHold' = IF teBilled < TextEditionEstimate THEN TextEditionEstimate - teBilled ELSE 0
    /\ te' = "stored"
    /\ UNCHANGED <<teSeen, teBilled>>
    /\ UNCHANGED <<pc, lock, holdRow, left, seen, billed, recorded, inflight, saved,
                   answered, path, declined, restarted>>

\* finishIfDone: the job ends, and so does its hold.
TextEditionEnds ==
    /\ te = "stored"
    /\ teHold' = 0
    /\ te' = "ended"
    /\ UNCHANGED <<teSeen, teBilled, teRecorded>>
    /\ UNCHANGED <<pc, lock, holdRow, left, seen, billed, recorded, inflight, saved,
                   answered, path, declined, restarted>>

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
         \/ LookAgain(c)
         \/ TakeLockAndReadSpending(c)
         \/ DecideAndHold(c)
         \/ TheAiAnswers(c)
         \/ TheAiFallsBackAndAnswers(c)
         \/ TheAiFailsButBills(c)
         \/ TheAiFailsUnbilled(c)
         \/ SaveTheAnswer(c)
         \/ SaveFails(c)
         \/ RecordTheLostAnswer(c)
         \/ RecordTheBilledFailure(c)
         \/ TheRecordFailsToo(c)
         \/ ReleaseTheHold(c)
         \/ ReleaseFails(c)
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

\* Money charged but not yet written to the database is still covered by the call's hold row,
\* so the next cap check sees it. (The text-edition job: by its job hold.)
ChargedMoneyAlwaysCounted ==
    /\ \A c \in Calls : billed[c] <= recorded[c] + (IF holdRow[c] THEN Hold ELSE 0)
    /\ teBilled <= teRecorded + teHold

\* A hold row exists only between a call's reserve and its settling, once per call; a finished call
\* has none, unless it was left behind on purpose (its server stopped mid-call, or the database failed
\* while its cost was being written): that one stays counted at its estimate.
ReservationReleasedOnce ==
    /\ \A c \in Calls : holdRow[c] => pc[c] \notin {"new", "looked", "lookingAgain", "waitLock", "deciding", "refused", "reused"}
    /\ \A c \in Calls : pc[c] \in Finished /\ holdRow[c] => left[c]

\* A finished call has written exactly what it was charged, once, billed failures included; or, when
\* the database failed while writing it, its hold row still counts at least that.
EveryChargeRecordedOnce ==
    \A c \in Calls : pc[c] = "done" =>
        \/ recorded[c] = billed[c]
        \/ (left[c] /\ holdRow[c] /\ recorded[c] = 0 /\ billed[c] <= Hold)

\* The same request from one reader is paid for once: two identical requests share one call, or the
\* second finds the first's saved answer. An answer that was paid for and then lost (its save failed,
\* or its server stopped) may be paid for again: the reader never got it.
Kept(c) == answered[c] /\ path[c] # "failed" /\ pc[c] # "lost"
PaidOncePerAnswer ==
    \A k \in Keys : Cardinality({c \in Calls : KeyOf(c) = k /\ Kept(c)}) <= 1

TypeOK ==
    /\ pc \in [Calls -> {"new", "looked", "lookingAgain", "waitLock", "deciding", "calling", "saving",
                         "recordingFailure", "recordingLost", "releasing", "releasingEarly",
                         "savingLate", "orphan"} \cup Finished]
    /\ holdRow \in [Calls -> BOOLEAN]
    /\ left \in [Calls -> BOOLEAN]
=============================================================================
