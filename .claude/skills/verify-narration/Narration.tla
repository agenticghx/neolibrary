----------------------------- MODULE Narration -----------------------------
(***************************************************************************)
(* Whole-book narration in Neolibrary: a paid voice reads every paragraph  *)
(* of an EPUB, and the Listen bar may ask for paragraphs at the same time. *)
(*                                                                         *)
(* Code it describes, as of the sync commit in SKILL.md (line numbers     *)
(* are at that commit; SKILL.md has the full table):                      *)
(*   lib/library/narration.ts  startNarration, run, stopNarration          *)
(*   lib/library/audio.ts      speakPassage, speak (the paid call)         *)
(*   lib/ai/generate.ts        reserveSpend, assertRoom, spending          *)
(*   app/api/books/[id]/narration/route.ts  POST (owner only), DELETE      *)
(*   app/api/books/[id]/audio/route.ts      POST (the Listen bar)          *)
(*                                                                         *)
(* One step of this model is one stretch of the code with no `await` that *)
(* waits on the database, the voice or another request: JavaScript runs    *)
(* such a stretch without anything else in between.                       *)
(*                                                                         *)
(* Every paragraph costs one unit. The limits are counted in paragraphs.   *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
  Books,            \* the owner's EPUBs: book -> its paragraphs' texts, in reading order
  Listened,         \* the book whose Listen bar the owner uses meanwhile
  CapBook,          \* VOICE_CAP_PER_BOOK_USD, in paragraphs
  CapMonth,         \* VOICE_CAP_PER_MONTH_USD, in paragraphs (all books)
  MaxRestarts,      \* how many times the site may restart (a deploy)
  MaxSaveFails,     \* how many times saving a paid paragraph may fail (storage.put or the insert throws)
  OldServerLingers, \* FALSE: a restart ends the old server at once. TRUE: it runs on beside the new one for a while.
  Broken            \* guards switched off to watch a rule fail (scratch only); {} in every committed config

(* The guards, each one line of code. Broken = {} in every committed config. *)
Guards == {"owner only",          \* narration/route.ts 59: if (!mayNarrateWholeBooks(at.user)) return ownerOnly()
           "confirm",             \* narration.ts 252: if (confirm !== true) throw ...
           "same run carries on", \* narration.ts 258: if (going?.running) return { started: false, ... }
           "one run per reader",  \* narration.ts 259-260: const other = ...; if (other) throw ...
           "stop check",          \* narration.ts 289: if (job.stopRequested) return end("stopped", ...)
           "skip saved",          \* narration.ts 292: if (saved.has(key)) continue
           "stored check",        \* audio.ts 269-270: const stored = await storedTrack(...); if (stored) return ...
           "limits",              \* audio.ts 272: await reserveSpend(...) (generate.ts 260-265: assertRoom under the lock)
           "share in-flight"}     \* audio.ts 248-251: const running = inflight.get(key); if (running) return ...
On(g) == g \notin Broken

ASSUME Broken \subseteq Guards

VARIABLES
  server,       \* which copy of the server takes requests now: 1, and 2 after a restart
  runs,         \* the narration runs (narration.ts Job), each in the memory of the server that started it
  listen,       \* the owner's Listen bar: its one request for a paragraph (audio route POST -> speakPassage)
  stored,       \* texts whose audio is saved in the voice (audio_tracks rows, found by cacheKeyOf): kept across restarts
  spent,        \* book -> what the database records as spent on it (audio_tracks.cost_usd), in paragraphs
  billed,       \* text -> how many times the voice was paid for it
  money,        \* book -> what the voice billed for it, in paragraphs, recorded or not
  est,          \* book -> the paragraphs left to make that the cost box stated at your last Create
  sinceCreate,  \* book -> paragraphs that runs paid for since your last Create
  stopPressed,  \* book -> you pressed Stop since your last Create
  afterStop,    \* book -> paragraphs that runs began paying for after you pressed Stop
  saveFails     \* how many times saving a paid paragraph has failed

vars == <<server, runs, listen, stored, spent, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

BookIds == DOMAIN Books
Texts == UNION {{Books[b][i] : i \in 1..Len(Books[b])} : b \in BookIds}

RECURSIVE SumOver(_, _)
SumOver(f, S) == IF S = {} THEN 0 ELSE LET x == CHOOSE x \in S : TRUE IN f[x] + SumOver(f, S \ {x})
Min(S) == CHOOSE x \in S : \A y \in S : x <= y

Ended == {"finished", "stopped", "month limit", "book limit", "error"}
Making == {"lookup", "reserve", "calling"}   \* its own speakPassage call is going on (the in-flight list holds it)
Running(r) == r.pc \notin Ended               \* narration.ts Job.running
Slots == 1..4                                \* room for the runs (YouPressCreate keeps fewer than 4 before adding one)

Section(a) == <<a.book, a.at>>
Text(a) == Books[a.book][a.at]
Idle == [srv |-> 1, book |-> Listened, pc |-> "idle", at |-> 0, savedWhenAsked |-> FALSE]
\* The Listen bar is used on book Listened; with Listened outside the books (NarrationFlow.cfg), it is not used.
ListenParas == IF Listened \in BookIds THEN 1..Len(Books[Listened]) ELSE {}

(* audio.ts 236 `inflight`, one per server: the paragraphs whose speakPassage call is going on there.
   Its key is owner|book|section|voice|model (audio.ts 247), so it is per paragraph, not per text. *)
Inflight(s) ==
  {Section(runs[k]) : k \in {k \in DOMAIN runs : runs[k].srv = s /\ runs[k].pc \in Making}}
    \cup (IF listen.srv = s /\ listen.pc \in Making THEN {Section(listen)} ELSE {})

(* generate.ts 214 spendHolds, one per server: a call reserved and not yet released (released in the same step as its save). *)
HoldsOn(s, b) ==
  Cardinality({k \in DOMAIN runs : runs[k].srv = s /\ runs[k].book = b /\ runs[k].pc = "calling"})
    + (IF listen.srv = s /\ listen.book = b /\ listen.pc = "calling" THEN 1 ELSE 0)
Holds(s) == SumOver([b \in BookIds |-> HoldsOn(s, b)], BookIds)

(* generate.ts 260-265 reserveSpend -> assertRoom: what is recorded (spending, 128), plus what is held here, plus this paragraph. *)
Room(s, b) == /\ spent[b] + HoldsOn(s, b) + 1 <= CapBook
              /\ SumOver(spent, BookIds) + Holds(s) + 1 <= CapMonth
(* Which limit reserveSpend names when there is no room: assertRoom checks the month first. *)
NoRoom(s, b) == IF SumOver(spent, BookIds) + Holds(s) + 1 > CapMonth THEN "month limit" ELSE "book limit"

(***************************************************************************)
(* A run moving on (narration.ts 288-296, the `for` loop). From one save to *)
(* the next speakPassage call nothing waits, so the Stop check, skipping   *)
(* saved paragraphs and joining or entering the next call are one step.    *)
(***************************************************************************)
EndRun(r, kind) == [r EXCEPT !.pc = kind, !.at = 0, !.seen = {}, !.stop = FALSE, !.savedWhenAsked = FALSE]

ToMake(r, from) == {j \in from..Len(Books[r.book]) : Books[r.book][j] \notin r.seen \/ ~On("skip saved")}

MoveOn(r, from) ==
  IF from > Len(Books[r.book]) THEN EndRun(r, "finished")
  ELSE IF r.stop /\ On("stop check") THEN EndRun(r, "stopped")
  ELSE IF ToMake(r, from) = {} THEN EndRun(r, "finished")
  ELSE LET j == Min(ToMake(r, from)) IN
       [r EXCEPT !.at = j,
                 !.pc = IF <<r.book, j>> \in Inflight(r.srv) /\ On("share in-flight") THEN "joined" ELSE "lookup",
                 !.savedWhenAsked = Books[r.book][j] \in stored]

(* After speakPassage returns (or throws) for its paragraph. *)
Resume(r, outcome) ==
  IF outcome \in {"reused", "made"}
  THEN MoveOn([r EXCEPT !.seen = @ \cup {Text(r)}], r.at + 1)   \* saved.add(key); next paragraph
  ELSE EndRun(r, outcome)                                         \* "month limit", "book limit" or "error"

(***************************************************************************)
(* The speakPassage call for paragraph `sec` in server `s` ends. Its maker *)
(* `who` and everyone who joined it there go on in the same step (they     *)
(* await one promise: audio.ts speakPassage).                              *)
(***************************************************************************)
Finish(who, s, sec, outcome) ==
  /\ runs' = [k \in DOMAIN runs |->
                IF who = <<"run", k>> \/ (runs[k].srv = s /\ runs[k].pc = "joined" /\ Section(runs[k]) = sec)
                THEN Resume(runs[k], outcome) ELSE runs[k]]
  /\ listen' = IF who = <<"listen">> \/ (listen.srv = s /\ listen.pc = "joined" /\ Section(listen) = sec)
               THEN Idle ELSE listen

(* The voice is paid: billed at once, recorded in the database only when the audio is saved. *)
Pay(b, t, byRun) ==
  /\ billed' = [billed EXCEPT ![t] = @ + 1]
  /\ money' = [money EXCEPT ![b] = @ + 1]
  /\ sinceCreate' = IF byRun THEN [sinceCreate EXCEPT ![b] = @ + 1] ELSE sinceCreate
  /\ afterStop' = IF byRun /\ stopPressed[b] THEN [afterStop EXCEPT ![b] = @ + 1] ELSE afterStop

Init ==
  /\ server = 1
  /\ runs = <<>>
  /\ listen = Idle
  /\ stored = {}
  /\ spent = [b \in BookIds |-> 0]
  /\ billed = [t \in Texts |-> 0]
  /\ money = [b \in BookIds |-> 0]
  /\ est = [b \in BookIds |-> 0]
  /\ sinceCreate = [b \in BookIds |-> 0]
  /\ stopPressed = [b \in BookIds |-> FALSE]
  /\ afterStop = [b \in BookIds |-> 0]
  /\ saveFails = 0

(***************************************************************************)
(* You (or a reader you invited) tick the cost box, or not, and press      *)
(* Create: route.ts POST, then narration.ts startNarration. After its      *)
(* awaits (the book 251, the voices 254), looking at the runs and adding  *)
(* one is a single step (no await between them, narration.ts 255-275).     *)
(***************************************************************************)
YouPressCreate(who, b, confirm) ==
  /\ who = "owner" \/ ~On("owner only")
  /\ confirm \/ ~On("confirm")
  /\ LET mine  == {k \in DOMAIN runs : runs[k].srv = server /\ runs[k].inMap}
         going == {k \in mine : runs[k].book = b /\ Running(runs[k])}
         other == {k \in mine : Running(runs[k])}
         new   == [srv |-> server, book |-> b, pc |-> "loading", at |-> 0, seen |-> {}, stop |-> FALSE,
                   inMap |-> TRUE, savedWhenAsked |-> FALSE, by |-> who, confirmed |-> confirm]
         \* jobs().set(key, job): the run this replaces leaves the list; one still going goes on, unseen.
         left  == [k \in DOMAIN runs |-> IF k \in mine /\ runs[k].book = b THEN [runs[k] EXCEPT !.inMap = FALSE] ELSE runs[k]]
         kept  == SelectSeq(left, LAMBDA r : r.inMap \/ Running(r))
     IN  /\ ~(going # {} /\ On("same run carries on"))     \* it carries on: nothing new (no change)
         /\ ~(other # {} /\ On("one run per reader"))      \* "A narration is already going on" (no change)
         /\ Len(kept) < 4                                 \* a bound on runs left going unseen (only when a guard is broken)
         /\ runs' = Append(kept, new)
         /\ est' = [est EXCEPT ![b] = Cardinality({i \in 1..Len(Books[b]) : Books[b][i] \notin stored})]
         /\ sinceCreate' = [sinceCreate EXCEPT ![b] = 0]
         /\ stopPressed' = [stopPressed EXCEPT ![b] = FALSE]
         /\ afterStop' = [afterStop EXCEPT ![b] = 0]
         /\ UNCHANGED <<server, listen, stored, spent, billed, money, saveFails>>

(* You press Stop: narration/route.ts DELETE -> narration.ts 313-317 sets stopRequested on the run in this server's list. *)
YouPressStop(b) ==
  \E k \in DOMAIN runs :
    /\ runs[k].srv = server /\ runs[k].book = b /\ runs[k].inMap /\ Running(runs[k]) /\ ~runs[k].stop
    /\ runs' = [runs EXCEPT ![k].stop = TRUE]
    /\ stopPressed' = [stopPressed EXCEPT ![b] = TRUE]
    /\ UNCHANGED <<server, listen, stored, spent, billed, money, est, sinceCreate, afterStop, saveFails>>

(* narration.ts 286-287: paragraphsOf, then savedKeys (what is saved now), then the loop. *)
RunReadsSaved(k) ==
  /\ k \in DOMAIN runs
  /\ runs[k].pc = "loading"
  /\ runs' = [runs EXCEPT ![k] = MoveOn([runs[k] EXCEPT !.seen = stored], 1)]
  /\ UNCHANGED <<server, listen, stored, spent, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

(* audio.ts 267-270: passageFor, then storedTrack. Saved: served again, free. *)
RunLooksUp(k) ==
  LET r == runs[k] IN
  /\ k \in DOMAIN runs
  /\ r.pc = "lookup"
  /\ IF Text(r) \in stored /\ On("stored check")
     THEN Finish(<<"run", k>>, r.srv, Section(r), "reused")
     ELSE /\ runs' = [runs EXCEPT ![k].pc = "reserve"]
          /\ UNCHANGED listen
  /\ UNCHANGED <<server, stored, spent, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

(* audio.ts 272-274: reserveSpend (check and hold under its lock), then model.speak sends the paid request. *)
RunPays(k) ==
  LET r == runs[k] IN
  /\ k \in DOMAIN runs
  /\ r.pc = "reserve"
  /\ IF Room(r.srv, r.book) \/ ~On("limits")
     THEN /\ runs' = [runs EXCEPT ![k].pc = "calling"]
          /\ Pay(r.book, Text(r), TRUE)
          /\ UNCHANGED listen
     ELSE /\ Finish(<<"run", k>>, r.srv, Section(r), NoRoom(r.srv, r.book))
          /\ UNCHANGED <<billed, money, sinceCreate, afterStop>>
  /\ UNCHANGED <<server, stored, spent, est, stopPressed, saveFails>>

(* audio.ts 275-303: the voice answers; storage.put, the audio_tracks insert, release(); the run goes on (narration.ts 294). *)
RunSaves(k) ==
  LET r == runs[k] IN
  /\ k \in DOMAIN runs
  /\ r.pc = "calling"
  /\ stored' = stored \cup {Text(r)}
  /\ spent' = [spent EXCEPT ![r.book] = @ + 1]
  /\ Finish(<<"run", k>>, r.srv, Section(r), "made")
  /\ UNCHANGED <<server, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

(* audio.ts 278-300: paid for, but storage.put or the insert throws; no row, so nothing records the cost; narration.ts 300 ends the run. *)
RunSaveFails(k) ==
  LET r == runs[k] IN
  /\ k \in DOMAIN runs
  /\ r.pc = "calling"
  /\ saveFails < MaxSaveFails
  /\ saveFails' = saveFails + 1
  /\ Finish(<<"run", k>>, r.srv, Section(r), "error")
  /\ UNCHANGED <<server, stored, spent, billed, money, est, sinceCreate, stopPressed, afterStop>>

(* The Listen bar asks for paragraph i (audio/route.ts 65 -> speakPassage, with the same voice model as the run: speech/index.ts 31). *)
YouPressListen(i) ==
  /\ listen.pc = "idle"
  /\ listen' = [srv |-> server, book |-> Listened, at |-> i,
                pc |-> IF <<Listened, i>> \in Inflight(server) /\ On("share in-flight") THEN "joined" ELSE "lookup",
                savedWhenAsked |-> Books[Listened][i] \in stored]
  /\ UNCHANGED <<server, runs, stored, spent, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

ListenLooksUp ==
  /\ listen.pc = "lookup"
  /\ IF Text(listen) \in stored /\ On("stored check")
     THEN Finish(<<"listen">>, listen.srv, Section(listen), "reused")
     ELSE /\ listen' = [listen EXCEPT !.pc = "reserve"]
          /\ UNCHANGED runs
  /\ UNCHANGED <<server, stored, spent, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

ListenPays ==
  /\ listen.pc = "reserve"
  /\ IF Room(listen.srv, listen.book) \/ ~On("limits")
     THEN /\ listen' = [listen EXCEPT !.pc = "calling"]
          /\ Pay(listen.book, Text(listen), FALSE)
          /\ UNCHANGED runs
     ELSE /\ Finish(<<"listen">>, listen.srv, Section(listen), NoRoom(listen.srv, listen.book))
          /\ UNCHANGED <<billed, money, sinceCreate, afterStop>>
  /\ UNCHANGED <<server, stored, spent, est, stopPressed, saveFails>>

ListenSaves ==
  /\ listen.pc = "calling"
  /\ stored' = stored \cup {Text(listen)}
  /\ spent' = [spent EXCEPT ![listen.book] = @ + 1]
  /\ Finish(<<"listen">>, listen.srv, Section(listen), "made")
  /\ UNCHANGED <<server, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

ListenSaveFails ==
  /\ listen.pc = "calling"
  /\ saveFails < MaxSaveFails
  /\ saveFails' = saveFails + 1
  /\ Finish(<<"listen">>, listen.srv, Section(listen), "error")
  /\ UNCHANGED <<server, stored, spent, billed, money, est, sinceCreate, stopPressed, afterStop>>

(***************************************************************************)
(* The site restarts (a deploy). Memory is lost: the runs, the in-flight   *)
(* list, the spending holds. A paid request on its way is billed but never *)
(* saved. On SIGTERM `next start` closes the server, which waits for open  *)
(* requests (the Listen bar's), then exits (next/dist/server/lib/          *)
(* start-server.js, cleanup); the background run is not a request and gets *)
(* no such wait. With OldServerLingers the old server keeps running beside *)
(* the new one until TheOldServerStops; requests go to the new one.        *)
(***************************************************************************)
TheSiteRestarts ==
  /\ server <= MaxRestarts
  /\ OldServerLingers \/ listen.pc = "idle"
  /\ server' = server + 1
  /\ runs' = IF OldServerLingers THEN runs ELSE <<>>
  /\ UNCHANGED <<listen, stored, spent, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

TheOldServerStops ==
  /\ OldServerLingers
  /\ \E k \in DOMAIN runs : runs[k].srv < server
  /\ ~(listen.srv < server /\ listen.pc # "idle")
  /\ runs' = SelectSeq(runs, LAMBDA r : r.srv = server)
  /\ UNCHANGED <<server, listen, stored, spent, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

Next ==
  \/ \E who \in {"owner", "reader"}, b \in BookIds, confirm \in BOOLEAN : YouPressCreate(who, b, confirm)
  \/ \E b \in BookIds : YouPressStop(b)
  \/ \E k \in Slots : RunReadsSaved(k)
  \/ \E k \in Slots : RunLooksUp(k)
  \/ \E k \in Slots : RunPays(k)
  \/ \E k \in Slots : RunSaves(k)
  \/ \E k \in Slots : RunSaveFails(k)
  \/ \E i \in ListenParas : YouPressListen(i)
  \/ ListenLooksUp \/ ListenPays \/ ListenSaves \/ ListenSaveFails
  \/ TheSiteRestarts \/ TheOldServerStops

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* The rules.                                                              *)
(***************************************************************************)
\* Only the library's owner can start a run.
OnlyTheOwnerStarts == \A k \in DOMAIN runs : runs[k].by = "owner"

\* A run starts only after the cost box was ticked.
OnlyAfterYouConfirm == \A k \in DOMAIN runs : runs[k].confirmed

\* At most one run goes on at a time.
OneRunAtATime == Cardinality({k \in DOMAIN runs : Running(runs[k])}) <= 1

\* After you press Stop, at most one more paragraph is paid for: the one being made.
StopPaysAtMostOneMore == \A b \in BookIds : afterStop[b] <= 1

\* A paragraph already saved in the voice when the run (or the Listen bar) comes to it is never paid for again.
SavedNeverPaidAgain ==
  /\ \A k \in DOMAIN runs : runs[k].pc = "calling" => ~runs[k].savedWhenAsked
  /\ listen.pc = "calling" => ~listen.savedWhenAsked

\* After you press Create, narration pays for no more paragraphs than the cost box stated.
NoMoreThanYouConfirmed == \A b \in BookIds : sinceCreate[b] <= est[b]

\* No paragraph's text is paid for twice in the voice.
PaidOnce == \A t \in Texts : billed[t] <= 1

\* What the voice bills never passes the book's limit or the month's limit.
WithinLimits == /\ \A b \in BookIds : money[b] <= CapBook
                /\ SumOver(money, BookIds) <= CapMonth

(***************************************************************************)
(* Bounds, given to TLC by the configs.                                    *)
(***************************************************************************)
\* Narration.cfg, NarrationFindings.cfg, NarrationOverlap.cfg: a book whose third paragraph repeats the first's
\* text (real books do: Frankenstein repeats a few short paragraphs), and a one-paragraph book.
CheckBooks == [b \in {"Lamps", "Boats"} |-> IF b = "Lamps" THEN <<"lamp 1", "lamp 2", "lamp 1">> ELSE <<"boat 1">>]
\* NarrationFlow.cfg (the chart, narration-flow.mmd): one book of two paragraphs.
FlowBooks == [b \in {"Lamps"} |-> <<"lamp 1", "lamp 2">>]
\* NarrationNoKnownCauses.cfg: the same books with no repeated text.
DistinctBooks == [b \in {"Lamps", "Boats"} |-> IF b = "Lamps" THEN <<"lamp 1", "lamp 2", "lamp 3">> ELSE <<"boat 1">>]
=============================================================================
