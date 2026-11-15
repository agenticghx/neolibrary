----------------------------- MODULE Narration -----------------------------
(***************************************************************************)
(* Whole-book narration in Neolibrary: a paid voice reads every paragraph  *)
(* of an EPUB, and the Listen bar may ask for paragraphs at the same time. *)
(*                                                                         *)
(* Code it describes, as of the sync commit in SKILL.md (SKILL.md has the  *)
(* table of steps and line numbers):                                      *)
(*   lib/library/narration.ts  startNarration, run, stopNarration,         *)
(*                             stopNarrationsForShutdown                   *)
(*   lib/library/audio.ts      speakPassage, speakText, speak (the paid    *)
(*                             call), the in-flight and kept-audio lists   *)
(*   lib/ai/generate.ts        reserveSpend, assertRoom, spending          *)
(*   app/api/books/[id]/narration/route.ts  POST (owner only, after()),    *)
(*                                          DELETE                         *)
(*   app/api/books/[id]/audio/route.ts      POST (the Listen bar)          *)
(*   instrumentation.ts        the SIGTERM listener                        *)
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
  MaxSaveFails,     \* how many times saving a paid paragraph may fail, after its retries (storage.put or the insert)
  OldServerLingers, \* FALSE: the old server gets SIGTERM when the new one is live. TRUE: it first runs on beside
                    \* the new one, with no signal, for a while (Railway's overlap time).
  HostGrace,        \* FALSE: Railway today (RAILWAY_DEPLOYMENT_DRAINING_SECONDS unset: 0 seconds, SIGKILL right after
                    \* SIGTERM). TRUE: the host waits after SIGTERM long enough for the paragraph being made to be saved.
  AskWhileDraining, \* TRUE: you may press Create or Listen while the old server finishes after SIGTERM (it takes no new
                    \* requests; the new one does). FALSE: you press nothing in those seconds.
  Broken            \* guards switched off to watch a rule fail (scratch only); {} in every committed config

(* The guards, each one line of code (SKILL.md has the line numbers). Broken = {} in every committed config. *)
Guards == {"owner only",          \* narration/route.ts: if (!mayNarrateWholeBooks(at.user)) return ownerOnly()
           "confirm",             \* narration.ts startNarration: if (confirm !== true) throw ...
           "same run carries on", \* narration.ts startNarration: if (going?.running) return { started: false, ... }
           "one run per reader",  \* narration.ts startNarration: const other = ...; if (other) throw ...
           "stop check",          \* narration.ts run: if (job.stopRequested) return end("stopped", ...)
           "skip saved",          \* narration.ts run: if (saved.has(key)) continue
           "stored check",        \* audio.ts speak: const stored = await storedTrack(...); if (stored) return ...
           "limits",              \* audio.ts speak: await reserveSpend(...) (assertRoom under the spending lock)
           "share in-flight",     \* audio.ts speakPassage: const running = inflight.get(key); if (running) return ...
           "in-flight by text",   \* audio.ts speakPassage: the in-flight key is the owner and cacheKeyOf (the text), not the paragraph
           "holds in database",   \* generate.ts reserveSpend (M44): the hold is a failed_spend row, under the advisory lock
           "keep paid audio",     \* audio.ts speak: a paid paragraph whose save fails is kept in memory with its hold; the next ask saves it
           "stop at SIGTERM",     \* instrumentation.ts -> narration.ts stopNarrationsForShutdown: every run stops before its next paragraph
           "wait for the run"}    \* narration/route.ts: after(done): next start's shutdown waits for the run (NextNodeServer.close)
On(g) == g \notin Broken

ASSUME Broken \subseteq Guards

VARIABLES
  server,       \* which copy of the server takes requests now: 1, and 2 after a restart
  old,          \* the server before it: "none" (gone), "overlap" (runs on, no signal yet), "draining" (got SIGTERM)
  runs,         \* the narration runs (narration.ts Job), each in the memory of the server that started it
  listen,       \* the owner's Listen bar: its one request for a paragraph (audio route POST -> speakPassage)
  stored,       \* texts whose audio is saved in the voice (audio_tracks rows, found by cacheKeyOf): kept across restarts
  kept,         \* paid audio whose save failed, kept in a server's memory with its hold: [srv, book, text]
  spent,        \* book -> what the database counts against it, in paragraphs: audio_tracks.cost_usd, failed_spend
                \* (a paid paragraph that could not be saved), and holds left by a restart (at their estimate)
  billed,       \* text -> how many times the voice was paid for it
  money,        \* book -> what the voice billed for it, in paragraphs, recorded or not
  est,          \* book -> the paragraphs left to make that the cost box stated at your last Create
  sinceCreate,  \* book -> paragraphs that runs paid for since your last Create
  stopPressed,  \* book -> you pressed Stop since your last Create
  afterStop,    \* book -> paragraphs that runs began paying for after you pressed Stop
  saveFails     \* how many times saving a paid paragraph has failed

vars == <<server, old, runs, listen, stored, kept, spent, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

BookIds == DOMAIN Books
Texts == UNION {{Books[b][i] : i \in 1..Len(Books[b])} : b \in BookIds}

RECURSIVE SumOver(_, _)
SumOver(f, S) == IF S = {} THEN 0 ELSE LET x == CHOOSE x \in S : TRUE IN f[x] + SumOver(f, S \ {x})
Min(S) == CHOOSE x \in S : \A y \in S : x <= y

Ended == {"finished", "stopped", "month limit", "book limit", "error"}
\* Its own speakPassage call is going on (the in-flight list holds it): from the in-flight look (after passageFor) to the save.
Making == {"lookup", "reserve", "calling", "saving"}
Paying == {"calling", "saving"}               \* the voice was paid and the save is not done: the hold is counted
Running(r) == r.pc \notin Ended               \* narration.ts Job.running
Slots == 1..4                                \* room for the runs (YouPressCreate keeps fewer than 4 before adding one)

Section(a) == <<a.book, a.at>>
Text(a) == Books[a.book][a.at]
(* audio.ts speakPassage's in-flight key. Since the fix of finding 3 it is the owner and the text (cacheKeyOf), which is
   also how a saved paragraph is found; before, it was the paragraph (owner|book|section|voice|model). *)
Key(a) == IF On("in-flight by text") THEN [t |-> Text(a), s |-> <<>>] ELSE [t |-> "", s |-> Section(a)]
Idle == [srv |-> 1, book |-> Listened, pc |-> "idle", at |-> 0, savedWhenAsked |-> FALSE]
\* The Listen bar is used on book Listened; with Listened outside the books (NarrationFlow.cfg), it is not used.
ListenParas == IF Listened \in BookIds THEN 1..Len(Books[Listened]) ELSE {}

(* audio.ts `inflight`, one per server: the keys whose speakPassage call is going on there. *)
Inflight(s) ==
  {Key(runs[k]) : k \in {k \in DOMAIN runs : runs[k].srv = s /\ runs[k].pc \in Making}}
    \cup (IF listen.srv = s /\ listen.pc \in Making THEN {Key(listen)} ELSE {})

(* audio.ts `kept`: the paid audio kept in server s's memory for this text, if any. *)
KeptHere(s, t) == {e \in kept : e.srv = s /\ e.text = t}

(* generate.ts reserveSpend: a call reserved and not yet settled holds its estimate (released in the same step
   as its save). A kept paragraph's hold stays until it is saved. The hold is a row in the database (M44): every
   server sees it. Guard "holds in database" broken: the holds of before M44, in each server's memory. *)
HoldsOn(s, b) ==
  Cardinality({k \in DOMAIN runs : (runs[k].srv = s \/ On("holds in database")) /\ runs[k].book = b /\ runs[k].pc \in Paying})
    + (IF (listen.srv = s \/ On("holds in database")) /\ listen.book = b /\ listen.pc \in Paying THEN 1 ELSE 0)
    + Cardinality({e \in kept : (e.srv = s \/ On("holds in database")) /\ e.book = b})
Holds(s) == SumOver([b \in BookIds |-> HoldsOn(s, b)], BookIds)

(* generate.ts reserveSpend -> assertRoom: what is recorded (spending), plus what is held, plus this paragraph. *)
Room(s, b) == /\ spent[b] + HoldsOn(s, b) + 1 <= CapBook
              /\ SumOver(spent, BookIds) + Holds(s) + 1 <= CapMonth
(* Which limit reserveSpend names when there is no room: assertRoom checks the month first. *)
NoRoom(s, b) == IF SumOver(spent, BookIds) + Holds(s) + 1 > CapMonth THEN "month limit" ELSE "book limit"

(***************************************************************************)
(* A run moving on (narration.ts run, the `for` loop). From one save to    *)
(* the next speakPassage call nothing waits, so the Stop check and         *)
(* skipping saved paragraphs are one step; then speakPassage awaits        *)
(* passageFor before its in-flight look (RunJoins).                         *)
(***************************************************************************)
EndRun(r, kind) == [r EXCEPT !.pc = kind, !.at = 0, !.seen = {}, !.stop = FALSE, !.savedWhenAsked = FALSE]

ToMake(r, from) == {j \in from..Len(Books[r.book]) : Books[r.book][j] \notin r.seen \/ ~On("skip saved")}

MoveOn(r, from) ==
  IF from > Len(Books[r.book]) THEN EndRun(r, "finished")
  ELSE IF r.stop /\ On("stop check") THEN EndRun(r, "stopped")
  ELSE IF ToMake(r, from) = {} THEN EndRun(r, "finished")
  ELSE LET j == Min(ToMake(r, from)) IN
       [r EXCEPT !.at = j, !.pc = "passage", !.savedWhenAsked = Books[r.book][j] \in stored]

(* After speakPassage returns (or throws) for its paragraph. *)
Resume(r, outcome) ==
  IF outcome \in {"reused", "made"}
  THEN MoveOn([r EXCEPT !.seen = @ \cup {Text(r)}], r.at + 1)   \* saved.add(key); next paragraph
  ELSE EndRun(r, outcome)                                         \* "month limit", "book limit" or "error"

(***************************************************************************)
(* The speakPassage call with in-flight key `key` in server `s` ends. Its  *)
(* maker `who` and everyone who joined it there go on in the same step     *)
(* (they await one promise: audio.ts speakPassage).                        *)
(***************************************************************************)
Finish(who, s, key, outcome) ==
  /\ runs' = [k \in DOMAIN runs |->
                IF who = <<"run", k>> \/ (runs[k].srv = s /\ runs[k].pc = "joined" /\ Key(runs[k]) = key)
                THEN Resume(runs[k], outcome) ELSE runs[k]]
  /\ listen' = IF who = <<"listen">> \/ (listen.srv = s /\ listen.pc = "joined" /\ Key(listen) = key)
               THEN Idle ELSE listen

(* The voice is paid: billed at once, recorded in the database only when the audio is saved. *)
Pay(b, t, byRun) ==
  /\ billed' = [billed EXCEPT ![t] = @ + 1]
  /\ money' = [money EXCEPT ![b] = @ + 1]
  /\ sinceCreate' = IF byRun THEN [sinceCreate EXCEPT ![b] = @ + 1] ELSE sinceCreate
  /\ afterStop' = IF byRun /\ stopPressed[b] THEN [afterStop EXCEPT ![b] = @ + 1] ELSE afterStop

(* You can ask the server for something (Create, Listen) unless you are told to wait while the old one finishes. *)
MayAsk == old # "draining" \/ AskWhileDraining

Init ==
  /\ server = 1
  /\ old = "none"
  /\ runs = <<>>
  /\ listen = Idle
  /\ stored = {}
  /\ kept = {}
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
(* awaits (the book, the voices), looking at the runs and adding one is a  *)
(* single step (no await between them).                                    *)
(***************************************************************************)
YouPressCreate(who, b, confirm) ==
  /\ MayAsk
  /\ who = "owner" \/ ~On("owner only")
  /\ confirm \/ ~On("confirm")
  /\ LET mine  == {k \in DOMAIN runs : runs[k].srv = server /\ runs[k].inMap}
         going == {k \in mine : runs[k].book = b /\ Running(runs[k])}
         other == {k \in mine : Running(runs[k])}
         new   == [srv |-> server, book |-> b, pc |-> "loading", at |-> 0, seen |-> {}, stop |-> FALSE,
                   inMap |-> TRUE, savedWhenAsked |-> FALSE, by |-> who, confirmed |-> confirm]
         \* jobs().set(key, job): the run this replaces leaves the list; one still going goes on, unseen.
         left  == [k \in DOMAIN runs |-> IF k \in mine /\ runs[k].book = b THEN [runs[k] EXCEPT !.inMap = FALSE] ELSE runs[k]]
         kept2 == SelectSeq(left, LAMBDA r : r.inMap \/ Running(r))
     IN  /\ ~(going # {} /\ On("same run carries on"))     \* it carries on: nothing new (no change)
         /\ ~(other # {} /\ On("one run per reader"))      \* "A narration is already going on" (no change)
         /\ Len(kept2) < 4                                \* a bound on runs left going unseen (only when a guard is broken)
         /\ runs' = Append(kept2, new)
         /\ est' = [est EXCEPT ![b] = Cardinality({i \in 1..Len(Books[b]) : Books[b][i] \notin stored})]
         /\ sinceCreate' = [sinceCreate EXCEPT ![b] = 0]
         /\ stopPressed' = [stopPressed EXCEPT ![b] = FALSE]
         /\ afterStop' = [afterStop EXCEPT ![b] = 0]
         /\ UNCHANGED <<server, old, listen, stored, kept, spent, billed, money, saveFails>>

(* You press Stop: narration/route.ts DELETE -> narration.ts stopNarration sets stopRequested on the run in this server's list. *)
YouPressStop(b) ==
  \E k \in DOMAIN runs :
    /\ runs[k].srv = server /\ runs[k].book = b /\ runs[k].inMap /\ Running(runs[k]) /\ ~runs[k].stop
    /\ runs' = [runs EXCEPT ![k].stop = TRUE]
    /\ stopPressed' = [stopPressed EXCEPT ![b] = TRUE]
    /\ UNCHANGED <<server, old, listen, stored, kept, spent, billed, money, est, sinceCreate, afterStop, saveFails>>

(* narration.ts run: paragraphsOf, then savedKeys (what is saved now), then the loop. *)
RunReadsSaved(k) ==
  /\ k \in DOMAIN runs
  /\ runs[k].pc = "loading"
  /\ runs' = [runs EXCEPT ![k] = MoveOn([runs[k] EXCEPT !.seen = stored], 1)]
  /\ UNCHANGED <<server, old, listen, stored, kept, spent, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

(* audio.ts speakPassage: after passageFor, the in-flight look and the add are one step (no await between them). *)
RunJoins(k) ==
  LET r == runs[k] IN
  /\ k \in DOMAIN runs
  /\ r.pc = "passage"
  /\ runs' = [runs EXCEPT ![k].pc = IF Key(r) \in Inflight(r.srv) /\ On("share in-flight") THEN "joined" ELSE "lookup"]
  /\ UNCHANGED <<server, old, listen, stored, kept, spent, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

(* audio.ts speak: the voices, then (no await) the kept audio of this text, else storedTrack. Kept: saved now
   without paying (its hold goes on). Saved: served again, free. *)
RunLooksUp(k) ==
  LET r == runs[k] IN
  /\ k \in DOMAIN runs
  /\ r.pc = "lookup"
  /\ IF KeptHere(r.srv, Text(r)) # {} /\ On("keep paid audio")
     THEN /\ runs' = [runs EXCEPT ![k].pc = "saving"]
          /\ kept' = kept \ KeptHere(r.srv, Text(r))
          /\ UNCHANGED listen
     ELSE /\ IF Text(r) \in stored /\ On("stored check")
             THEN Finish(<<"run", k>>, r.srv, Key(r), "reused")
             ELSE /\ runs' = [runs EXCEPT ![k].pc = "reserve"]
                  /\ UNCHANGED listen
          /\ UNCHANGED kept
  /\ UNCHANGED <<server, old, stored, spent, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

(* audio.ts speak: reserveSpend (check and hold under its lock), then model.speak sends the paid request. *)
RunPays(k) ==
  LET r == runs[k] IN
  /\ k \in DOMAIN runs
  /\ r.pc = "reserve"
  /\ IF Room(r.srv, r.book) \/ ~On("limits")
     THEN /\ runs' = [runs EXCEPT ![k].pc = "calling"]
          /\ Pay(r.book, Text(r), TRUE)
          /\ UNCHANGED listen
     ELSE /\ Finish(<<"run", k>>, r.srv, Key(r), NoRoom(r.srv, r.book))
          /\ UNCHANGED <<billed, money, sinceCreate, afterStop>>
  /\ UNCHANGED <<server, old, stored, kept, spent, est, stopPressed, saveFails>>

(* audio.ts speak: the voice answers (or the kept audio is taken); storage.put and the audio_tracks insert, retried;
   release() (the hold row is deleted); the run goes on (narration.ts run). *)
RunSaves(k) ==
  LET r == runs[k] IN
  /\ k \in DOMAIN runs
  /\ r.pc \in Paying
  /\ stored' = stored \cup {Text(r)}
  /\ spent' = [spent EXCEPT ![r.book] = @ + 1]
  /\ Finish(<<"run", k>>, r.srv, Key(r), "made")
  /\ UNCHANGED <<server, old, kept, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

(* audio.ts speak: paid for, but storage.put or the insert throws on every try. Guard "keep paid audio": the audio
   and its hold are kept in this server's memory. Without it, hold.billed turns the hold into the paid cost
   (failed_spend, M44; before M44 nothing recorded it). narration.ts ends the run with an error. *)
SaveFails(b, s, t) ==
  /\ saveFails < MaxSaveFails
  /\ saveFails' = saveFails + 1
  /\ IF On("keep paid audio")
     THEN /\ kept' = kept \cup {[srv |-> s, book |-> b, text |-> t]}
          /\ UNCHANGED spent
     ELSE /\ spent' = IF On("holds in database") THEN [spent EXCEPT ![b] = @ + 1] ELSE spent
          /\ UNCHANGED kept

RunSaveFails(k) ==
  LET r == runs[k] IN
  /\ k \in DOMAIN runs
  /\ r.pc \in Paying
  /\ SaveFails(r.book, r.srv, Text(r))
  /\ Finish(<<"run", k>>, r.srv, Key(r), "error")
  /\ UNCHANGED <<server, old, stored, billed, money, est, sinceCreate, stopPressed, afterStop>>

(* The Listen bar asks for paragraph i (audio/route.ts POST -> speakPassage, with the same voice model as the run:
   speech/index.ts). speakPassage first awaits passageFor. *)
YouPressListen(i) ==
  /\ MayAsk
  /\ listen.pc = "idle"
  /\ listen' = [srv |-> server, book |-> Listened, at |-> i, pc |-> "passage",
                savedWhenAsked |-> Books[Listened][i] \in stored]
  /\ UNCHANGED <<server, old, runs, stored, kept, spent, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

ListenJoins ==
  /\ listen.pc = "passage"
  /\ listen' = [listen EXCEPT !.pc = IF Key(listen) \in Inflight(listen.srv) /\ On("share in-flight") THEN "joined" ELSE "lookup"]
  /\ UNCHANGED <<server, old, runs, stored, kept, spent, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

ListenLooksUp ==
  /\ listen.pc = "lookup"
  /\ IF KeptHere(listen.srv, Text(listen)) # {} /\ On("keep paid audio")
     THEN /\ listen' = [listen EXCEPT !.pc = "saving"]
          /\ kept' = kept \ KeptHere(listen.srv, Text(listen))
          /\ UNCHANGED runs
     ELSE /\ IF Text(listen) \in stored /\ On("stored check")
             THEN Finish(<<"listen">>, listen.srv, Key(listen), "reused")
             ELSE /\ listen' = [listen EXCEPT !.pc = "reserve"]
                  /\ UNCHANGED runs
          /\ UNCHANGED kept
  /\ UNCHANGED <<server, old, stored, spent, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

ListenPays ==
  /\ listen.pc = "reserve"
  /\ IF Room(listen.srv, listen.book) \/ ~On("limits")
     THEN /\ listen' = [listen EXCEPT !.pc = "calling"]
          /\ Pay(listen.book, Text(listen), FALSE)
          /\ UNCHANGED runs
     ELSE /\ Finish(<<"listen">>, listen.srv, Key(listen), NoRoom(listen.srv, listen.book))
          /\ UNCHANGED <<billed, money, sinceCreate, afterStop>>
  /\ UNCHANGED <<server, old, stored, kept, spent, est, stopPressed, saveFails>>

ListenSaves ==
  /\ listen.pc \in Paying
  /\ stored' = stored \cup {Text(listen)}
  /\ spent' = [spent EXCEPT ![listen.book] = @ + 1]
  /\ Finish(<<"listen">>, listen.srv, Key(listen), "made")
  /\ UNCHANGED <<server, old, kept, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

ListenSaveFails ==
  /\ listen.pc \in Paying
  /\ SaveFails(listen.book, listen.srv, Text(listen))
  /\ Finish(<<"listen">>, listen.srv, Key(listen), "error")
  /\ UNCHANGED <<server, old, stored, billed, money, est, sinceCreate, stopPressed, afterStop>>

(***************************************************************************)
(* Restarts (a deploy). The new server takes every request from then on.  *)
(* The old server gets SIGTERM, at once or after the overlap time          *)
(* (OldServerLingers). Without HostGrace (Railway today) SIGKILL follows   *)
(* at once: its memory is gone (runs, in-flight list, kept audio), and a   *)
(* paid request on its way, the run's or the Listen bar's, is billed but   *)
(* never saved; its hold stays in the database, counted at its estimate.   *)
(* With HostGrace, `next start` closes the server (no new requests; open   *)
(* ones finish) and then waits for its after() work, which includes the   *)
(* run (guard "wait for the run"); the SIGTERM listener asks every run to  *)
(* stop before its next paragraph (guard "stop at SIGTERM"). The old       *)
(* server exits when that is done.                                         *)
(***************************************************************************)
\* The servers before n are gone: what they held in memory is lost; the holds of their calls stay in the database.
Gone(n) ==
  LET oldPaying(b) == Cardinality({k \in DOMAIN runs : runs[k].srv < n /\ runs[k].book = b /\ runs[k].pc \in Paying})
                        + (IF listen.srv < n /\ listen.book = b /\ listen.pc \in Paying THEN 1 ELSE 0)
                        + Cardinality({e \in kept : e.srv < n /\ e.book = b})
  IN
  /\ runs' = SelectSeq(runs, LAMBDA r : r.srv >= n)
  /\ listen' = IF listen.srv < n /\ listen.pc # "idle" THEN Idle ELSE listen
  /\ kept' = {e \in kept : e.srv >= n}
  /\ spent' = IF On("holds in database") THEN [b \in BookIds |-> spent[b] + oldPaying(b)] ELSE spent
  /\ old' = "none"

\* SIGTERM to the servers before n.
SigTerm(n) ==
  IF HostGrace
  THEN /\ old' = "draining"
       /\ runs' = [k \in DOMAIN runs |-> IF runs[k].srv < n /\ On("stop at SIGTERM") THEN [runs[k] EXCEPT !.stop = TRUE] ELSE runs[k]]
       /\ UNCHANGED <<listen, kept, spent>>
  ELSE Gone(n)

TheSiteRestarts ==
  /\ server <= MaxRestarts
  /\ old = "none"
  /\ server' = server + 1
  /\ IF OldServerLingers
     THEN /\ old' = "overlap"
          /\ UNCHANGED <<runs, listen, kept, spent>>
     ELSE SigTerm(server + 1)
  /\ UNCHANGED <<stored, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

\* The overlap time is over: the old server gets SIGTERM.
TheOldServerGetsSigterm ==
  /\ old = "overlap"
  /\ SigTerm(server)
  /\ UNCHANGED <<server, stored, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

\* With HostGrace: the old server exits once its open requests are done and (guard "wait for the run") its runs ended.
TheOldServerExits ==
  /\ old = "draining"
  /\ ~(listen.srv < server /\ listen.pc # "idle")
  /\ \A k \in DOMAIN runs : runs[k].srv < server /\ On("wait for the run") => ~Running(runs[k])
  /\ Gone(server)
  /\ UNCHANGED <<server, stored, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

\* With HostGrace but no stop at SIGTERM: a run goes on past the draining time, and SIGKILL ends it wherever it is.
TheOldServerIsKilled ==
  /\ old = "draining"
  /\ ~On("stop at SIGTERM")
  /\ Gone(server)
  /\ UNCHANGED <<server, stored, billed, money, est, sinceCreate, stopPressed, afterStop, saveFails>>

Next ==
  \/ \E who \in {"owner", "reader"}, b \in BookIds, confirm \in BOOLEAN : YouPressCreate(who, b, confirm)
  \/ \E b \in BookIds : YouPressStop(b)
  \/ \E k \in Slots : RunReadsSaved(k)
  \/ \E k \in Slots : RunJoins(k)
  \/ \E k \in Slots : RunLooksUp(k)
  \/ \E k \in Slots : RunPays(k)
  \/ \E k \in Slots : RunSaves(k)
  \/ \E k \in Slots : RunSaveFails(k)
  \/ \E i \in ListenParas : YouPressListen(i)
  \/ ListenJoins \/ ListenLooksUp \/ ListenPays \/ ListenSaves \/ ListenSaveFails
  \/ TheSiteRestarts \/ TheOldServerGetsSigterm \/ TheOldServerExits \/ TheOldServerIsKilled

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
\* Most configs: a book whose third paragraph repeats the first's text (real books do: Frankenstein repeats a few
\* short paragraphs), and a one-paragraph book.
CheckBooks == [b \in {"Lamps", "Boats"} |-> IF b = "Lamps" THEN <<"lamp 1", "lamp 2", "lamp 1">> ELSE <<"boat 1">>]
\* NarrationFlow.cfg (the chart, narration-flow.mmd): one book of two paragraphs.
FlowBooks == [b \in {"Lamps"} |-> <<"lamp 1", "lamp 2">>]
=============================================================================
