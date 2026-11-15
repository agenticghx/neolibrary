------------------------- MODULE RewriteAsYouTurn -------------------------
(***************************************************************************)
(* "Rewrite as you turn": the loop in                                      *)
(* app/(reader)/books/[id]/read/RewrittenPane.tsx (makeMissing, start,     *)
(* stop, the GET effect) with lib/library/rewritten-turn.ts (goAhead,      *)
(* paidFor, mustAskAgain). The turn state lives in Reader.tsx (useState),  *)
(* so it outlives the pane; the pane's refs (turnRef, placeRef, running,   *)
(* latest) live and die with one pane.                                     *)
(*                                                                         *)
(* Written for: a Claude session (or a developer) checking a change to the *)
(* files listed in SKILL.md. Each action names the code it stands for.     *)
(*                                                                         *)
(* Money is in cents. NumPages pages of ParasPerPage paragraphs; each one  *)
(* costs Cost to rewrite once, and nothing after that (a saved rewrite).   *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
    NumPages,      \* pages in the book
    ParasPerPage,  \* paragraphs on each page
    Cost,          \* what one paragraph's rewrite costs (cents)
    AskAt,         \* ASK_AGAIN_USD, in cents: the promise is to ask again after every $1
    RefLag,        \* turnRef catches up with the turn state only when React's effect runs (a later step)
    PaneCanClose,  \* the reader may switch to Original (the pane unmounts) and open it again
    TurnBack,      \* the reader may turn to any page (FALSE: only to the next one; for the chart)
    Mutant         \* "none" describes the code; anything else is a broken variant (see SKILL.md)

ASSUME Mutant \in {"none", "askAtTwoDollars", "noRunningGuard", "ignoreStop"}

Pages == 1..NumPages
Paras(p) == {(p - 1) * ParasPerPage + k : k \in 1..ParasPerPage}
AllParas == UNION {Paras(p) : p \in Pages}
Panes == {1, 2}          \* the pane is opened at most twice (bound)
Slots == {1, 2}          \* at most two loops at once (bound)
None == 0                \* no pane, no page, no paragraph

\* mustAskAgain(sinceOk) as the code computes it.
Threshold == IF Mutant = "askAtTwoDollars" THEN 2 * AskAt ELSE AskAt
MustAsk(since) == since >= Threshold

VARIABLES
    screen,       \* the page on screen (Reader's screen; placeRef follows it in the open pane)
    rewritten,    \* paragraphs with a saved rewrite on the server
    turn,         \* Reader's AsYouTurn state: [on, since] (since = sinceOk, cents)
    open,         \* the pane now open (0: Original, no pane)
    opened,       \* how many panes have been opened
    ref,          \* ref[i]: pane i's turnRef.current
    place,        \* place[i]: pane i's placeRef.current
    latest,       \* latest[i]: pane i's latest.current: [page, left] as the GET returned it
    data,         \* data[i]: what pane i shows: [page, left], left = its paragraphs without a rewrite (page 0: "Finding the page")
    get,          \* the page whose GET /rewritten is on its way (0: none)
    loop,         \* loop[l]: a running makeMissing
    paidSinceOk,  \* ghost: cents the AI was paid since the reader's last go-ahead
    stopped       \* ghost: the reader pressed Stop after the last go-ahead

vars == <<screen, rewritten, turn, open, opened, ref, place, latest, data, get, loop, paidSinceOk, stopped>>

Idle == [pane |-> None, pc |-> "idle", at |-> None, todo |-> {}, since |-> 0, para |-> None,
         paid |-> FALSE, startedAt |-> 0, afterStop |-> FALSE]

NoView == [page |-> None, left |-> {}]

Running(i) == \E l \in Slots : loop[l].pane = i /\ loop[l].pc # "idle"

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
    /\ stopped = FALSE

\* The ref of the open pane, after a step that changed the turn state: without RefLag the
\* effect `turnRef.current = props.turn` is taken to run before anything else.
RefAfter(newTurn) == IF ~RefLag /\ open # None THEN [ref EXCEPT ![open] = newTurn] ELSE ref

\* makeMissing(pieces, at = page, since) in pane i: returns at once if a loop runs there.
\* Its list (todo): the pieces without a rewrite. A new loop takes a free slot.
StartLoop(i, page, todo, since, lp) ==
    IF (Running(i) /\ Mutant # "noRunningGuard") \/ todo = {} \/ ~(\E l \in Slots : lp[l].pc = "idle")
      THEN lp
      ELSE LET l == CHOOSE l \in Slots : lp[l].pc = "idle" IN
           [lp EXCEPT ![l] = [Idle EXCEPT !.pane = i, !.pc = "deciding", !.at = page,
                                          !.todo = todo, !.since = since]]

-----------------------------------------------------------------------------
(* The reader *)

\* Reader: a new place on screen. The open pane renders (its effects copy placeRef and turnRef)
\* and its GET effect asks for the new page.
YouTurnThePage ==
    /\ NothingDeciding
    /\ \E p \in (IF TurnBack THEN Pages \ {screen} ELSE {screen + 1} \cap Pages) :
         /\ screen' = p
         /\ IF open # None
              THEN /\ place' = [place EXCEPT ![open] = p]
                   /\ ref' = [ref EXCEPT ![open] = turn]
                   /\ get' = p
              ELSE UNCHANGED <<place, ref, get>>
    /\ UNCHANGED <<rewritten, turn, open, opened, latest, data, loop, paidSinceOk, stopped>>

\* start(): "Rewrite this page" (when off) or "Keep rewriting" (when it asks): goAhead, then makeMissing(data.pieces, place, 0).
GoAhead(i) ==
    /\ turn' = [on |-> TRUE, since |-> 0]
    /\ ref' = [ref EXCEPT ![i] = [on |-> TRUE, since |-> 0]]
    /\ paidSinceOk' = 0
    /\ stopped' = FALSE
    /\ loop' = StartLoop(i, screen, data[i].left, 0, loop)
    /\ UNCHANGED <<screen, rewritten, open, opened, place, latest, data, get>>

PricedOnScreen(i) == data[i].page = screen /\ data[i].left # {}

\* The button "Rewrite this page in …" with its price, shown when off; disabled while busy.
YouAskForARewrite ==
    /\ NothingDeciding
    /\ open # None
    /\ ~turn.on
    /\ PricedOnScreen(open)
    /\ ~Running(open)
    /\ GoAhead(open)

\* "Keep rewriting? This page costs …" (asking = on && mustAskAgain(sinceOk) && priced && !busy).
YouPressKeepRewriting ==
    /\ NothingDeciding
    /\ open # None
    /\ turn.on /\ MustAsk(turn.since)
    /\ PricedOnScreen(open)
    /\ ~Running(open)
    /\ GoAhead(open)

\* stop(): turnRef.current.on = false, and the turn state too. The Stop button shows once the pane has a page (data) and it is on.
YouPressStop ==
    /\ NothingDeciding
    /\ open # None
    /\ data[open].page # None
    /\ turn.on
    /\ turn' = [turn EXCEPT !.on = FALSE]
    /\ ref' = [ref EXCEPT ![open] = [@ EXCEPT !.on = FALSE]]
    /\ stopped' = TRUE
    /\ UNCHANGED <<screen, rewritten, open, opened, place, latest, data, get, loop, paidSinceOk>>

\* Reader.tsx: mode "original" renders no RewrittenPane. Its loop, if any, goes on with the refs it had.
YouSwitchToOriginal ==
    /\ NothingDeciding
    /\ PaneCanClose
    /\ open # None
    /\ open' = None
    /\ get' = None
    /\ UNCHANGED <<screen, rewritten, turn, opened, ref, place, latest, data, loop, paidSinceOk, stopped>>

\* A new RewrittenPane: useRef(props.turn), useRef(place), running = false; its GET effect asks for the page.
YouOpenSideBySide ==
    /\ NothingDeciding
    /\ PaneCanClose
    /\ open = None /\ opened < 2
    /\ open' = opened + 1
    /\ opened' = opened + 1
    /\ ref' = [ref EXCEPT ![opened + 1] = turn]
    /\ place' = [place EXCEPT ![opened + 1] = screen]
    /\ get' = screen
    /\ UNCHANGED <<screen, rewritten, turn, latest, data, loop, paidSinceOk, stopped>>

-----------------------------------------------------------------------------
(* The code *)

\* The view the server sends for a page: its paragraphs without a saved rewrite.
View(p) == [page |-> p, left |-> Paras(p) \ rewritten]

\* The GET effect's answer: setData, latest.current, then `t = turnRef.current;
\* if (t.on && !mustAskAgain(t.sinceOk)) makeMissing(b.pieces, at, t.sinceOk)`.
TheRewriteViewArrives ==
    /\ NothingDeciding
    /\ open # None /\ get # None
    /\ get' = None
    /\ data' = [data EXCEPT ![open] = View(get)]
    /\ latest' = [latest EXCEPT ![open] = View(get)]
    /\ loop' = IF ref[open].on /\ ~MustAsk(ref[open].since)
                 THEN StartLoop(open, get, View(get).left, ref[open].since, loop)
                 ELSE loop
    /\ UNCHANGED <<screen, rewritten, turn, open, opened, ref, place, paidSinceOk, stopped>>

\* One turn of makeMissing's for-loop: `if (placeRef.current !== at || !turnRef.current.on ||
\* mustAskAgain(sinceOk)) break;` then POST the next paragraph. When the list is done or it
\* breaks: finally (running = false), then go on with latest.current if that is the page now
\* on screen, still on, and not over the threshold.
TheLoopDecides(l) ==
    LET lp == loop[l]
        i == lp.pane
        breaks == \/ place[i] # lp.at
                  \/ (~ref[i].on /\ Mutant # "ignoreStop")
                  \/ MustAsk(lp.since)
                  \/ lp.todo = {}
        now == latest[i]
        ended == [loop EXCEPT ![l] = Idle]
    IN
    /\ lp.pc = "deciding"
    /\ IF breaks
         THEN loop' = IF now.page # None /\ now.page # lp.at /\ now.page = place[i] /\ ref[i].on /\ ~MustAsk(lp.since)
                        THEN StartLoop(i, now.page, now.left, lp.since, ended)
                        ELSE ended
         ELSE \E p \in lp.todo :
                loop' = [loop EXCEPT ![l] = [lp EXCEPT !.pc = "posting", !.para = p,
                                                       !.paid = p \notin rewritten,
                                                       !.startedAt = paidSinceOk,
                                                       !.afterStop = stopped]]
    /\ UNCHANGED <<screen, rewritten, turn, open, opened, ref, place, latest, data, get, paidSinceOk, stopped>>

\* The POST answers with the rewrite. Paid (not reused): sinceOk += cost, setTurn(paidFor); setData.
ThePostAnswers(l) ==
    LET lp == loop[l]
        paid == lp.para \notin rewritten
        newTurn == IF paid THEN [turn EXCEPT !.since = @ + Cost] ELSE turn
    IN
    /\ NothingDeciding
    /\ lp.pc = "posting"
    /\ rewritten' = rewritten \cup {lp.para}
    /\ turn' = newTurn
    /\ ref' = RefAfter(newTurn)
    /\ paidSinceOk' = IF paid THEN paidSinceOk + Cost ELSE paidSinceOk
    /\ loop' = [loop EXCEPT ![l] = [lp EXCEPT !.pc = "deciding", !.todo = @ \ {lp.para},
                                              !.since = IF paid THEN @ + Cost ELSE @,
                                              !.para = None, !.paid = FALSE]]
    /\ data' = [data EXCEPT ![lp.pane].left = @ \ {lp.para}]   \* setData: this piece now has its rewrite
    /\ UNCHANGED <<screen, open, opened, place, latest, get, stopped>>

\* The POST fails (the spending limit, no connection, or a billed failure): catch turns
\* rewriting as you turn off (turnRef and the turn state), and the loop ends.
ThePostFails(l) ==
    LET lp == loop[l]
        i == lp.pane
        newTurn == [turn EXCEPT !.on = FALSE]
    IN
    /\ NothingDeciding
    /\ lp.pc = "posting"
    /\ \E charged \in (IF lp.paid THEN {0, Cost} ELSE {0}) : paidSinceOk' = paidSinceOk + charged
    /\ turn' = newTurn
    /\ ref' = [RefAfter(newTurn) EXCEPT ![i] = [@ EXCEPT !.on = FALSE]]
    /\ loop' = [loop EXCEPT ![l] = Idle]
    /\ UNCHANGED <<screen, rewritten, open, opened, place, latest, data, get, stopped>>

\* React renders the open pane and runs its effect `turnRef.current = props.turn`.
TheScreenCatchesUp ==
    /\ NothingDeciding
    /\ RefLag
    /\ open # None
    /\ ref[open] # turn
    /\ ref' = [ref EXCEPT ![open] = turn]
    /\ UNCHANGED <<screen, rewritten, turn, open, opened, place, latest, data, get, loop, paidSinceOk, stopped>>

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

\* No paragraph is paid for once $1 (AskAt) has been paid since the reader's last go-ahead:
\* it asks "Keep rewriting?" first.
AsksBeforePayingPastOneDollar ==
    \A l \in Slots : loop[l].pc = "posting" /\ loop[l].paid => loop[l].startedAt < AskAt

\* So what is paid since the last go-ahead stays under $1 plus one paragraph.
AtMostOneParagraphPastOneDollar ==
    paidSinceOk < AskAt + Cost

\* The promise read literally: never more than $1 since the last go-ahead.
NeverPastOneDollar ==
    paidSinceOk <= AskAt

\* After Stop, no new paragraph is paid for until the reader's next go-ahead.
StopStopsPaying ==
    \A l \in Slots : loop[l].pc = "posting" /\ loop[l].paid => ~loop[l].afterStop

\* One loop at a time.
OneLoopAtATime ==
    Cardinality({l \in Slots : loop[l].pc # "idle"}) <= 1

TypeOK ==
    /\ screen \in Pages
    /\ rewritten \subseteq AllParas
    /\ open \in {None} \cup Panes
=============================================================================
