------------------------- MODULE RewriteAsYouTurn -------------------------
(***************************************************************************)
(* "Rewrite as you turn": the loop in                                      *)
(* app/(reader)/books/[id]/read/RewrittenPane.tsx (makeMissing, start,     *)
(* stop, goOn, the GET effect) with lib/library/rewritten-turn.ts          *)
(* (turnStore, goAhead, paidFor, mayPay). The as-you-turn state is one     *)
(* turnStore, kept by Reader.tsx (useState), so it outlives the pane and   *)
(* every change to it is seen at once; the pane's refs (placeRef, latest,  *)
(* open) live and die with one pane.                                       *)
(*                                                                         *)
(* Written for: a Claude session (or a developer) checking a change to the *)
(* files listed in SKILL.md. Each action names the code it stands for.     *)
(*                                                                         *)
(* Money is in cents. NumPages pages of ParasPerPage paragraphs; each one  *)
(* costs Price(p) to rewrite once (its estimate: the model takes the cost  *)
(* to be the estimate), and nothing after that (a saved rewrite).          *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
    NumPages,      \* pages in the book
    ParasPerPage,  \* paragraphs on each page
    Cost,          \* what one paragraph's rewrite costs (cents)
    BigPara,       \* one paragraph that costs BigCost instead (0: none)
    BigCost,       \* its cost (cents), e.g. more than $1 alone
    AskAt,         \* ASK_AGAIN_USD, in cents: never more than $1 since the go-ahead without asking
    RefLag,        \* React renders late: an effect that copies props runs only in a later step
    PaneCanClose,  \* the reader may switch to Original (the pane unmounts) and open it again
    TurnBack,      \* the reader may turn to any page (FALSE: only to the next one; for the chart)
    Mutant         \* "none" describes the code; anything else is a broken variant (see SKILL.md)

ASSUME Mutant \in {"none", "askAtTwoDollars", "noRunningGuard", "ignoreStop",
                   "askWhenPaid", "paneRef", "runningPerPane", "noOpenCheck", "noWake"}

Pages == 1..NumPages
Paras(p) == {(p - 1) * ParasPerPage + k : k \in 1..ParasPerPage}
AllParas == UNION {Paras(p) : p \in Pages}
Panes == {1, 2}          \* the pane is opened at most twice (bound)
Slots == {1, 2}          \* at most two loops at once (bound)
None == 0                \* no pane, no page, no paragraph

Price(p) == IF p = BigPara THEN BigCost ELSE Cost
Min(S) == CHOOSE x \in S : \A y \in S : x <= y   \* the code goes through a page's paragraphs in order

\* mayPay(sinceOk, estimate, justAsked) as the code computes it: pay without asking only if the
\* total since the go-ahead stays within $1, or for the first paragraph of the loop that the
\* reader's own press started.
Threshold == IF Mutant = "askAtTwoDollars" THEN 2 * AskAt ELSE AskAt
MayPay(since, price, justAsked) ==
    IF Mutant = "askWhenPaid"      \* the code before the fix: it looked only at what was paid
      THEN since < Threshold
      ELSE justAsked \/ since + price <= Threshold

VARIABLES
    screen,       \* the page on screen (Reader's screen; placeRef follows it in the open pane)
    rewritten,    \* paragraphs with a saved rewrite on the server
    turn,         \* the turnStore's AsYouTurn: [on, since] (since = sinceOk, cents)
    open,         \* the pane now open (0: Original, no pane)
    opened,       \* how many panes have been opened
    ref,          \* ref[i]: pane i's own copy of the turn (only Mutant "paneRef": the code before the fix)
    place,        \* place[i]: pane i's placeRef.current
    latest,       \* latest[i]: pane i's latest.current: [page, left] as the GET returned it
    data,         \* data[i]: what pane i shows: [page, left], left = its paragraphs without a rewrite (page 0: "Finding the page")
    get,          \* the page whose GET /rewritten is on its way (0: none)
    loop,         \* loop[l]: a running makeMissing
    paidSinceOk,  \* ghost: cents the AI was paid for paragraphs sent since the reader's last go-ahead
    paidParas,    \* ghost: the paragraphs paid for since the last go-ahead
    shown,        \* ghost: the paragraphs whose price was on screen when the reader last said go ahead
    stopped       \* ghost: the reader pressed Stop after the last go-ahead

vars == <<screen, rewritten, turn, open, opened, ref, place, latest, data, get, loop,
          paidSinceOk, paidParas, shown, stopped>>

Idle == [pane |-> None, pc |-> "idle", at |-> None, todo |-> {}, since |-> 0, para |-> None,
         asked |-> FALSE, paid |-> FALSE, startedAt |-> 0, afterStop |-> FALSE, onScreen |-> TRUE,
         wasShown |-> FALSE, thisOk |-> TRUE]

NoView == [page |-> None, left |-> {}]

Running(i) == \E l \in Slots : loop[l].pane = i /\ loop[l].pc # "idle"

\* What pane i's code reads as the turn: the store (the fix), or its own ref (before the fix).
Seen(i) == IF Mutant = "paneRef" THEN ref[i] ELSE turn

\* A loop that is "deciding" runs on at once: in the code the check and the next POST follow
\* synchronously after start(), after the GET's answer, and after the previous POST's answer,
\* so no click, render or other answer can come between. Every other step waits for it.
NothingDeciding == \A l \in Slots : loop[l].pc # "deciding"

Init ==
    /\ screen = 1
    /\ rewritten = {}
    /\ turn = [on |-> FALSE, since |-> 0]
    /\ open = 1 /\ opened = 1
    /\ ref = [i \in Panes |-> [on |-> FALSE, since |-> 0]]
    /\ place = [i \in Panes |-> 1]
    /\ latest = [i \in Panes |-> NoView]
    /\ data = [i \in Panes |-> NoView]
    /\ get = 1
    /\ loop = [l \in Slots |-> Idle]
    /\ paidSinceOk = 0
    /\ paidParas = {}
    /\ shown = {}
    /\ stopped = FALSE

\* Before the fix (Mutant "paneRef") the open pane's ref caught up only when React's effect ran;
\* without RefLag that is taken to happen before anything else.
RefAfter(newTurn) == IF ~RefLag /\ open # None THEN [ref EXCEPT ![open] = newTurn] ELSE ref

\* makeMissing(pieces, at = page, justAsked) in pane i: returns at once if a loop runs (the store's
\* `running`: in any pane; before the fix, Mutant "runningPerPane": in this pane only).
\* Its list (todo): the pieces without a rewrite. A new loop takes a free slot.
StartLoop(i, page, todo, since, asked, lp) ==
    LET busy == CASE Mutant = "noRunningGuard" -> FALSE
                  [] Mutant = "runningPerPane" -> \E l \in Slots : lp[l].pane = i /\ lp[l].pc # "idle"
                  [] OTHER -> \E l \in Slots : lp[l].pc # "idle"
    IN
    IF busy \/ todo = {} \/ ~(\E l \in Slots : lp[l].pc = "idle")
      THEN lp
      ELSE LET l == CHOOSE l \in Slots : lp[l].pc = "idle" IN
           [lp EXCEPT ![l] = [Idle EXCEPT !.pane = i, !.pc = "deciding", !.at = page,
                                          !.todo = todo, !.since = since, !.asked = asked]]

-----------------------------------------------------------------------------
(* The reader *)

\* Reader: a new place on screen. The open pane renders (its effect copies placeRef; before
\* the fix also turnRef) and its GET effect asks for the new page.
YouTurnThePage ==
    /\ NothingDeciding
    /\ \E p \in (IF TurnBack THEN Pages \ {screen} ELSE {screen + 1} \cap Pages) :
         /\ screen' = p
         /\ IF open # None
              THEN /\ place' = [place EXCEPT ![open] = p]
                   /\ ref' = [ref EXCEPT ![open] = turn]
                   /\ get' = p
              ELSE UNCHANGED <<place, ref, get>>
    /\ UNCHANGED <<rewritten, turn, open, opened, latest, data, loop, paidSinceOk, paidParas, shown, stopped>>

\* start(): "Rewrite this page" (when off) or "Keep rewriting" (when it asks): turns.change(goAhead),
\* then makeMissing(data.pieces, place, true).
GoAhead(i) ==
    /\ turn' = [on |-> TRUE, since |-> 0]
    /\ ref' = [ref EXCEPT ![i] = [on |-> TRUE, since |-> 0]]
    /\ paidSinceOk' = 0
    /\ paidParas' = {}
    /\ shown' = data[i].left
    /\ stopped' = FALSE
    \* A paragraph already on its way was allowed by the go-ahead before: the ghost counts it there.
    /\ loop' = StartLoop(i, screen, data[i].left, 0, TRUE, [l \in Slots |-> [loop[l] EXCEPT !.thisOk = FALSE]])
    /\ UNCHANGED <<screen, rewritten, open, opened, place, latest, data, get>>

PricedOnScreen(i) == data[i].page = screen /\ data[i].left # {}

\* The render's `asking`: on, this pane not busy, a priced paragraph left, and the first of them may
\* not be paid without asking. "Keep rewriting? This page costs …" with its button.
Asking(i) ==
    /\ turn.on
    /\ ~Running(i)
    /\ PricedOnScreen(i)
    /\ IF Mutant = "askWhenPaid"
         THEN turn.since >= Threshold
         ELSE ~MayPay(turn.since, Price(Min(data[i].left)), FALSE)

\* The button "Rewrite this page in …" with its price, shown when off; disabled while busy.
YouAskForARewrite ==
    /\ NothingDeciding
    /\ open # None
    /\ ~turn.on
    /\ PricedOnScreen(open)
    /\ ~Running(open)
    /\ GoAhead(open)

YouPressKeepRewriting ==
    /\ NothingDeciding
    /\ open # None
    /\ Asking(open)
    /\ GoAhead(open)

\* stop(): turns.change(on = false). The Stop button shows once the pane has a page (data) and it is on.
YouPressStop ==
    /\ NothingDeciding
    /\ open # None
    /\ data[open].page # None
    /\ turn.on
    /\ turn' = [turn EXCEPT !.on = FALSE]
    /\ ref' = [ref EXCEPT ![open] = [@ EXCEPT !.on = FALSE]]
    /\ stopped' = TRUE
    /\ UNCHANGED <<screen, rewritten, open, opened, place, latest, data, get, loop, paidSinceOk, paidParas, shown>>

\* Reader.tsx: mode "original" renders no RewrittenPane. Its cleanup sets open.current = false
\* and leaves turns.wake; a loop it started stops before its next paragraph.
YouSwitchToOriginal ==
    /\ NothingDeciding
    /\ PaneCanClose
    /\ open # None
    /\ open' = None
    /\ get' = None
    /\ UNCHANGED <<screen, rewritten, turn, opened, ref, place, latest, data, loop, paidSinceOk, paidParas, shown, stopped>>

\* A new RewrittenPane: useRef(place), open.current = true, turns.wake = its goOn; its GET effect asks for the page.
YouOpenSideBySide ==
    /\ NothingDeciding
    /\ PaneCanClose
    /\ open = None /\ opened < 2
    /\ open' = opened + 1
    /\ opened' = opened + 1
    /\ ref' = [ref EXCEPT ![opened + 1] = turn]
    /\ place' = [place EXCEPT ![opened + 1] = screen]
    /\ get' = screen
    /\ UNCHANGED <<screen, rewritten, turn, latest, data, loop, paidSinceOk, paidParas, shown, stopped>>

-----------------------------------------------------------------------------
(* The code *)

\* The view the server sends for a page: its paragraphs without a saved rewrite.
View(p) == [page |-> p, left |-> Paras(p) \ rewritten]

\* The GET effect's answer: setData, latest.current, then `if (turns.get().on)
\* makeMissing(b.pieces, at, false)`. Before the fix (Mutant "paneRef"): `t = turnRef.current;
\* if (t.on && !mustAskAgain(t.sinceOk)) makeMissing(b.pieces, at, t.sinceOk)`.
TheRewriteViewArrives ==
    /\ NothingDeciding
    /\ open # None /\ get # None
    /\ get' = None
    /\ data' = [data EXCEPT ![open] = View(get)]
    /\ latest' = [latest EXCEPT ![open] = View(get)]
    /\ loop' = IF Seen(open).on /\ (Mutant # "paneRef" \/ Seen(open).since < Threshold)
                 THEN StartLoop(open, get, View(get).left, Seen(open).since, FALSE, loop)
                 ELSE loop
    /\ UNCHANGED <<screen, rewritten, turn, open, opened, ref, place, paidSinceOk, paidParas, shown, stopped>>

\* What the loop counts as paid since the go-ahead: the store (the fix), or its own sum (before).
LoopSince(lp) == IF Mutant = "paneRef" THEN lp.since ELSE turn.since

\* One turn of makeMissing's for-loop: `if (!open.current || placeRef.current !== at ||
\* !turns.get().on || !mayPay(turns.get().sinceOk, estimate, justAsked && i === 0)) break;` then
\* POST the next paragraph, in order. When the list is done or it breaks: finally (running =
\* false), then turns.wake: the pane open now (goOn) goes on with its latest.current if that is the
\* page on screen, it is on, and it is not the page this same pane's loop just ended on.
TheLoopDecides(l) ==
    LET lp == loop[l]
        i == lp.pane
        next == Min(lp.todo)
        breaks == \/ lp.todo = {}
                  \/ (open # i /\ Mutant # "noOpenCheck")
                  \/ place[i] # lp.at
                  \/ (~Seen(i).on /\ Mutant # "ignoreStop")
                  \/ ~MayPay(LoopSince(lp), Price(next), lp.asked)
        ended == [loop EXCEPT ![l] = Idle]
        o == open
        now == latest[o]
        goOn == IF Mutant = "paneRef"
                  THEN \* before the fix: this pane goes on, with its own count
                       now.page # None /\ now.page # lp.at /\ now.page = place[i] /\ o = i
                       /\ ref[i].on /\ lp.since < Threshold
                  ELSE /\ o # None /\ (Mutant # "noWake" \/ o = i)
                       /\ now.page # None /\ now.page = place[o] /\ turn.on
                       /\ ~(o = i /\ now.page = lp.at)
    IN
    /\ lp.pc = "deciding"
    /\ IF breaks
         THEN loop' = IF goOn THEN StartLoop(o, now.page, now.left, LoopSince(lp), FALSE, ended) ELSE ended
         ELSE loop' = [loop EXCEPT ![l] = [lp EXCEPT !.pc = "posting", !.para = next,
                                                     !.paid = next \notin rewritten,
                                                     !.asked = FALSE,
                                                     !.startedAt = paidSinceOk,
                                                     !.afterStop = stopped,
                                                     !.wasShown = next \in shown,
                                                     !.thisOk = TRUE,
                                                     !.onScreen = (lp.at = screen /\ i = open)]]
    /\ UNCHANGED <<screen, rewritten, turn, open, opened, ref, place, latest, data, get, paidSinceOk, paidParas, shown, stopped>>

\* The POST answers with the rewrite. Paid (not reused): turns.change(paidFor), at once; setData.
ThePostAnswers(l) ==
    LET lp == loop[l]
        paid == lp.para \notin rewritten
        newTurn == IF paid THEN [turn EXCEPT !.since = @ + Price(lp.para)] ELSE turn
    IN
    /\ NothingDeciding
    /\ lp.pc = "posting"
    /\ rewritten' = rewritten \cup {lp.para}
    /\ turn' = newTurn
    /\ ref' = RefAfter(newTurn)
    /\ paidSinceOk' = IF paid /\ lp.thisOk THEN paidSinceOk + Price(lp.para) ELSE paidSinceOk
    /\ paidParas' = IF paid /\ lp.thisOk THEN paidParas \cup {lp.para} ELSE paidParas
    /\ loop' = [loop EXCEPT ![l] = [lp EXCEPT !.pc = "deciding", !.todo = @ \ {lp.para},
                                              !.since = IF paid THEN @ + Price(lp.para) ELSE @,
                                              !.para = None, !.paid = FALSE]]
    /\ data' = [data EXCEPT ![lp.pane].left = @ \ {lp.para}]   \* setData: this piece now has its rewrite
    /\ UNCHANGED <<screen, open, opened, place, latest, get, shown, stopped>>

\* The POST fails (the spending limit, no connection, or a billed failure): catch turns
\* rewriting as you turn off (turns.change), and the loop ends.
ThePostFails(l) ==
    LET lp == loop[l]
        i == lp.pane
        newTurn == [turn EXCEPT !.on = FALSE]
    IN
    /\ NothingDeciding
    /\ lp.pc = "posting"
    /\ \E charged \in (IF lp.paid /\ lp.thisOk THEN {0, Price(lp.para)} ELSE {0}) :
         /\ paidSinceOk' = paidSinceOk + charged
         /\ paidParas' = IF charged > 0 THEN paidParas \cup {lp.para} ELSE paidParas
    /\ turn' = newTurn
    /\ ref' = [RefAfter(newTurn) EXCEPT ![i] = [@ EXCEPT !.on = FALSE]]
    /\ loop' = [loop EXCEPT ![l] = Idle]
    /\ UNCHANGED <<screen, rewritten, open, opened, place, latest, data, get, shown, stopped>>

\* Before the fix only (Mutant "paneRef"): React renders the open pane and runs its effect
\* `turnRef.current = props.turn`. The fixed pane has no such copy.
TheScreenCatchesUp ==
    /\ NothingDeciding
    /\ Mutant = "paneRef" /\ RefLag
    /\ open # None
    /\ ref[open] # turn
    /\ ref' = [ref EXCEPT ![open] = turn]
    /\ UNCHANGED <<screen, rewritten, turn, open, opened, place, latest, data, get, loop, paidSinceOk, paidParas, shown, stopped>>

\* With TurnBack = FALSE (the chart) the reader stops at the last page: an end, not a deadlock.
YouReachTheLastPage ==
    /\ ~TurnBack /\ screen = NumPages /\ NothingDeciding
    /\ UNCHANGED vars

Next ==
    \/ \E l \in Slots : TheLoopDecides(l)
    \/ YouTurnThePage
    \/ YouAskForARewrite
    \/ YouPressKeepRewriting
    \/ YouPressStop
    \/ YouSwitchToOriginal
    \/ YouOpenSideBySide
    \/ TheRewriteViewArrives
    \/ TheScreenCatchesUp
    \/ \E l \in Slots : ThePostAnswers(l) \/ ThePostFails(l)
    \/ YouReachTheLastPage

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* The rules *)

\* A paragraph is sent to be paid for only if what was paid since the go-ahead plus its price
\* stays within $1, or it is the first paid since a go-ahead whose price, on screen, included it.
\* (startedAt and wasShown are taken when it is sent: a later go-ahead does not make it wrong.)
AsksBeforePayingPastOneDollar ==
    \A l \in Slots : loop[l].pc = "posting" /\ loop[l].paid =>
        \/ loop[l].startedAt + Price(loop[l].para) <= AskAt
        \/ (loop[l].startedAt = 0 /\ loop[l].wasShown)

\* The promise read literally: never more than $1 since the last go-ahead. (With a paragraph that
\* alone costs more than $1 this cannot hold; see the next rule.)
NeverPastOneDollar ==
    paidSinceOk <= AskAt

\* Past $1 since the go-ahead only by one paragraph, whose price was on screen when the reader said go ahead.
PastOneDollarOnlyAsShown ==
    paidSinceOk <= AskAt \/ (\E p \in shown : paidParas = {p})

\* After Stop, no new paragraph is paid for until the reader's next go-ahead.
StopStopsPaying ==
    \A l \in Slots : loop[l].pc = "posting" /\ loop[l].paid => ~loop[l].afterStop

\* One loop at a time (across panes: a closed pane's loop counts).
OneLoopAtATime ==
    Cardinality({l \in Slots : loop[l].pc # "idle"}) <= 1

\* A paragraph is sent to be paid for only while its page is on screen in the open pane.
PaysOnlyForThePageOnScreen ==
    \A l \in Slots : loop[l].pc = "posting" /\ loop[l].paid => loop[l].onScreen

\* Never stuck: when nothing runs and nothing is on its way, rewriting as you turn is on, and the
\* page on screen has paragraphs left to write, the pane asks "Keep rewriting?" (otherwise the
\* reader reads "Rewriting each page as you turn to it." while nothing happens).
NeverStuck ==
    (/\ NothingDeciding
     /\ \A l \in Slots : loop[l].pc = "idle"
     /\ open # None /\ get = None
     /\ turn.on
     /\ PricedOnScreen(open))
    => Asking(open)

TypeOK ==
    /\ screen \in Pages
    /\ rewritten \subseteq AllParas
    /\ open \in {None} \cup Panes
=============================================================================
