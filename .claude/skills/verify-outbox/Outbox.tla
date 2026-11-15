------------------------------- MODULE Outbox -------------------------------
(***************************************************************************)
(* Neolibrary's offline note outbox, as the code has it at the sync commit  *)
(* named in SKILL.md (that file maps each operator below to its code):      *)
(*   lib/outbox.ts               the queue in IndexedDB; flushOutbox sends it *)
(*   app/(reader)/books/[id]/read/useNotes.ts   the reader's side: create,   *)
(*                               saveNote, removeNote, Undo, when it flushes  *)
(*   lib/library/annotations.ts  the library stores a note id and a change id *)
(*                               once (createAnnotationOnce, addVersion)      *)
(* Reader A works in tab t1. A second tab (t2) may be open on the same      *)
(* browser, and another reader (B) may sign in on it. Each action is one    *)
(* indivisible step in the code: one IndexedDB transaction, one request as  *)
(* the library handles it, or the JavaScript between two awaits.            *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    MaxActions,   \* how many changes reader A makes in one run (write, edit, remove, Undo)
    SavedNote,    \* TRUE: the run includes a note the library already has (s), which A may edit, remove and bring back
    SecondTab,    \* whose reader page a second tab may show: "none", "A", or "B" (another reader)
    SignIns,      \* "none": A stays signed in; "A": A may sign out and in again; "AB": B may sign in too
    OldItem       \* TRUE: the outbox may start with an edit of A's to s saved before owners were recorded (before 2026-11-10)

ASSUME /\ SecondTab \in {"none", "A", "B"}
       /\ SignIns \in {"none", "A", "AB"}
       /\ SecondTab = "B" => SignIns = "AB"
       /\ OldItem => SavedNote

VARIABLES
    net,          \* "up" or "down"
    session,      \* who the browser is signed in as: "A", "B" or "nobody" (one cookie for every tab)
    page,         \* page[t]: whose reader page tab t shows, fixed when it loaded (props.readerId): "A", "B" or "closed"
    box,          \* the outbox store in IndexedDB: a function from item id (keyPath "id") to item
    fl,           \* fl[t]: the flushOutbox call running in tab t
    ui,           \* a reader action in tab t1 that is waiting between two awaits (saveNote, removeNote, Undo)
    offer,        \* the "Note removed · Undo" offer in tab t1
    srv,          \* the library's current version of each note: [state, words]
    stored,       \* the ids the library holds: note ids (createAnnotationOnce) and change ids (addVersion)
    want,         \* ghost: what reader A last did to each note
    made,         \* how many changes A has made (bounded by MaxActions)
    okIds,        \* ghost: ids the library answered ok to in a flush
    flushDropped, \* ghost: ids a flush removed from the outbox
    refusedIds,   \* ghost: ids a flush marked refused (and the reader has not removed since)
    flags         \* ghost: things a rule says must never happen, set when one does

vars == <<net, session, page, box, fl, ui, offer, srv, stored, want, made, okIds, flushDropped, refusedIds, flags>>
Ghosts == <<okIds, flushDropped, refusedIds>>

Tabs == IF SecondTab = "none" THEN {"t1"} ELSE {"t1", "t2"}
Notes == {"s", "n"}   \* s: a note the library already has; n: the note A writes in this run
Writer == "A"         \* every change in the model is reader A's

(* Item ids. 0: note n's create (its id is the note's id). 1: the old item.  *)
(* 2..: change ids (crypto.randomUUID() in change()), one per change A makes. *)
Ids == 0 .. MaxActions + 1
NewId == made + 2

(* One outbox item (OutboxItem in lib/outbox.ts).                            *)
(*   seq: which change of the reader's it carries; for a create or an edit   *)
(*        it also names the words (the body).                                *)
(*   at:  savedAt, the order flushOutbox sends in.                           *)
Item(id, op, note, owner, seq, at) ==
    [id |-> id, op |-> op, note |-> note, owner |-> owner, seq |-> seq, at |-> at, refused |-> FALSE]
NoItem == Item(0, "create", "n", "none", 0, 0)
OldEdit == Item(1, "edit", "s", "none", 1, 1)

EmptyBox == [k \in {} |-> NoItem]
Put(b, i) == [k \in DOMAIN b \cup {i.id} |-> IF k = i.id THEN i ELSE b[k]]   \* addToOutbox: store.put({ ...item, owner })
Del(b, k) == [j \in DOMAIN b \ {k} |-> b[j]]                                   \* removeFromOutbox: store.delete(id)
(* removeFromOutbox(item.id) inside flushOutbox (the ghost notes who removed it). *)
FlushDrop(k) == box' = Del(box, k) /\ flushDropped' = flushDropped \cup {k}

(* mine(items, owner) in lib/outbox.ts: an item with no owner counts as the  *)
(* signed-in reader's.                                                       *)
Mine(owner, reader) == owner = "none" \/ owner = reader

(* flushOutbox's list: outboxFor(owner) (one getAll, then mine), then        *)
(* .filter((i) => !i.refused), sorted by savedAt.                            *)
Pick(i) == ~i.refused
Snapshot(reader) == {box[k] : k \in {j \in DOMAIN box : Mine(box[j].owner, reader) /\ Pick(box[j])}}
SortByAt(S) == CHOOSE s \in [1 .. Cardinality(S) -> S] :
                   \A i, j \in 1 .. Cardinality(S) : i < j => s[i].at < s[j].at

(* How flushOutbox reads an answer:                                          *)
(*   res.ok -> sent; status >= 400 && < 500 && not 401, 408, 429 -> refused; *)
(*   anything else -> the loop breaks.                                       *)
ResOk(st) == st \in 200 .. 299
Refuses(st) == st >= 400 /\ st < 500 /\ st \notin {401, 408, 429}

(* useNotes.ts waitingCreate(n): madeOffline has n and outboxFor finds its   *)
(* create. Assumed: madeOffline is fresh (every caller of create() reloads). *)
WaitingCreate == 0 \in DOMAIN box /\ box[0].op = "create" /\ ~box[0].refused

-----------------------------------------------------------------------------
(* The library: one request handled in one step. The real handlers read     *)
(* then insert; the primary key on annotations.id and UNIQUE (annotation_id, *)
(* version) make the loser of two racing requests fail with a 5xx, which the *)
(* model covers with "the library fails" in FlushSends.                      *)
Handle(i, who) ==
    LET x == i.note
        k == i.id
        has == srv[x].state # "none" /\ who = Writer   \* versions(db, who, x) finds it: the note is A's
        keep(st) == [st |-> st, srv |-> srv, stored |-> stored, older |-> FALSE, twice |-> FALSE]
        put(st, v) == [st |-> st, srv |-> [srv EXCEPT ![x] = v], stored |-> stored \cup {k},
                       older |-> (i.op = "edit" /\ i.seq < srv[x].words), twice |-> k \in stored]
        changed == IF i.op = "edit" THEN [srv[x] EXCEPT !.words = i.seq]
                   ELSE IF i.op = "remove" THEN [srv[x] EXCEPT !.state = "gone"]
                   ELSE [srv[x] EXCEPT !.state = "live"]
    IN IF who = "nobody" THEN keep(401)                                         \* Sign in required
       ELSE IF i.op = "create"
       THEN IF k \in stored THEN keep(IF who = Writer THEN 200 ELSE 400)        \* createAnnotationOnce: the id exists
            ELSE IF who = Writer THEN put(201, [state |-> "live", words |-> i.seq])   \* createAnnotation
            ELSE keep(400)                                                      \* ownsBook fails: Book not found.
       ELSE IF k \in stored THEN keep(IF has THEN 200 ELSE 400)                 \* addVersion: the change id is done
       ELSE IF ~has \/ (srv[x].state = "gone" /\ i.op # "restore") THEN keep(404)   \* Annotation not found.
       ELSE IF i.op = "restore" /\ srv[x].state = "live" THEN keep(200)         \* already back: nothing added
       ELSE put(200, changed)

(* A request the reader's page sends itself: create() or change() in        *)
(* useNotes.ts, through api() in reader-helpers.ts. Outcomes:                *)
(*   "queued":   no network: fetch throws TypeError, so the item is put in   *)
(*               the outbox (addToOutbox).                                   *)
(*   "answered": the library answers; an answer that is not ok throws, and   *)
(*               the reader sees "Not saved".                                *)
(*   "lost":     the library handled it but the answer was lost: TypeError,  *)
(*               so the item is put in the outbox as well, under the same id. *)
DirectOutcomes == IF net = "down" THEN {"queued"} ELSE {"answered", "lost"}
DirectOk(i, o) == o # "answered" \/ ResOk(Handle(i, session).st)
Direct(i, o) ==
    LET h == Handle(i, session)
        reached == o \in {"answered", "lost"}
    IN /\ srv' = IF reached THEN h.srv ELSE srv
       /\ stored' = IF reached THEN h.stored ELSE stored
       /\ box' = IF o \in {"queued", "lost"} THEN Put(box, i) ELSE box
       /\ flags' = [flags EXCEPT !.older = @ \/ (reached /\ h.older), !.twice = @ \/ (reached /\ h.twice)]

(* What the reader last did to a note: there or removed (state), which words *)
(* it has (named by the change that wrote them), which change last set its   *)
(* presence (pseq), and the kind of that last action (last).                 *)
Want(state, words, pseq, last) == [state |-> state, words |-> words, pseq |-> pseq, last |-> last]
IdleUI == [act |-> "none", item |-> NoItem, todo |-> {}, seq |-> 0, note |-> "n"]
NoOffer == [kind |-> "none", item |-> NoItem, id |-> 0, queued |-> FALSE, note |-> "n"]
IdleFlush == [pc |-> "idle", todo |-> <<>>, cur |-> NoItem, st |-> 0, as |-> "nobody"]

-----------------------------------------------------------------------------
Init ==
    /\ net = "up"
    /\ session = "A"
    /\ page = [t \in Tabs |-> IF t = "t1" THEN "A" ELSE "closed"]
    /\ box \in IF OldItem THEN {EmptyBox, [k \in {1} |-> OldEdit]} ELSE {EmptyBox}
    /\ fl = [t \in Tabs |-> IdleFlush]
    /\ ui = IdleUI
    /\ offer = NoOffer
    /\ srv = [x \in Notes |-> [state |-> IF x = "s" /\ SavedNote THEN "live" ELSE "none", words |-> 0]]
    /\ stored = {}
    /\ want = [x \in Notes |->
                 IF x = "n" \/ ~SavedNote THEN Want("none", 0, 0, "none")
                 ELSE IF 1 \in DOMAIN box THEN Want("live", 1, 0, "edit") ELSE Want("live", 0, 0, "none")]
    /\ made = 0
    /\ okIds = {}
    /\ flushDropped = {}
    /\ refusedIds = {}
    /\ flags = [older |-> FALSE, twice |-> FALSE, otherSession |-> FALSE, otherPage |-> FALSE,
                resent |-> FALSE, refusedForOther |-> FALSE]

-----------------------------------------------------------------------------
(* Reader A's actions, in tab t1 (useNotes.ts).                              *)

(* create(): POST with an id chosen here; with no network it waits (M12).    *)
YouWriteANote ==
    /\ ui.act = "none" /\ made < MaxActions /\ want["n"].state = "none"
    /\ \E o \in DirectOutcomes :
         LET i == Item(0, "create", "n", Writer, NewId, NewId) IN
         /\ Direct(i, o)
         /\ want' = IF DirectOk(i, o) THEN [want EXCEPT !["n"] = Want("live", NewId, NewId, "write")] ELSE want
    /\ made' = made + 1
    /\ UNCHANGED <<net, session, page, fl, ui, offer, Ghosts>>

(* saveNote(): a note made offline and not sent yet gets new words in the    *)
(* outbox; any other note goes through change(a, "edit").                    *)
YouEditANote(x) ==
    /\ ui.act = "none" /\ made < MaxActions /\ want[x].state = "live"
    /\ IF x = "n" /\ WaitingCreate
       THEN \* waitingCreate() reads the outbox; the put comes after an await (YouFinishEditing)
            /\ ui' = [IdleUI EXCEPT !.act = "rewrite", !.item = box[0], !.seq = NewId]
            /\ UNCHANGED <<srv, stored, box, flags, want>>
       ELSE \E o \in DirectOutcomes :
              LET i == Item(NewId, "edit", x, Writer, NewId, NewId) IN
              /\ Direct(i, o)
              /\ want' = IF DirectOk(i, o) THEN [want EXCEPT ![x] = Want("live", NewId, want[x].pseq, "edit")] ELSE want
              /\ UNCHANGED ui
    /\ made' = made + 1
    /\ UNCHANGED <<net, session, page, fl, offer, Ghosts>>

(* saveNote(): addToOutbox(readerId, { ...waiting, body }), from the copy read above. *)
YouFinishEditing ==
    /\ ui.act = "rewrite"
    /\ box' = Put(box, [ui.item EXCEPT !.seq = ui.seq, !.owner = Writer])
    /\ want' = [want EXCEPT !["n"] = Want("live", ui.seq, ui.seq, "edit")]
    /\ ui' = IdleUI
    /\ UNCHANGED <<net, session, page, fl, offer, srv, stored, made, Ghosts, flags>>

(* removeNote(): a note made offline and never sent leaves the outbox (its    *)
(* create and its edits); any other note goes through change(a, "remove").   *)
YouRemoveANote(x) ==
    /\ ui.act = "none" /\ made < MaxActions /\ want[x].state = "live"
    /\ IF x = "n" /\ WaitingCreate
       THEN \* waitingCreate() and outboxFor() read the outbox; the deletes come one by one (YouFinishRemoving)
            /\ ui' = [IdleUI EXCEPT !.act = "drop", !.item = box[0], !.seq = NewId,
                                    !.todo = {k \in DOMAIN box : k = 0 \/ box[k].note = "n"}]
            /\ UNCHANGED <<srv, stored, box, flags, want, offer>>
       ELSE \E o \in DirectOutcomes :
              LET i == Item(NewId, "remove", x, Writer, NewId, NewId) IN
              /\ Direct(i, o)
              /\ IF DirectOk(i, o)
                 THEN /\ want' = [want EXCEPT ![x] = Want("gone", want[x].words, NewId, "remove")]
                      /\ offer' = [NoOffer EXCEPT !.kind = "restore", !.id = NewId, !.queued = (o # "answered"), !.note = x]
                 ELSE UNCHANGED <<want, offer>>   \* "Not removed": no Undo offer
              /\ UNCHANGED ui
    /\ made' = made + 1
    /\ UNCHANGED <<net, session, page, fl, Ghosts>>

(* removeNote(): one removeFromOutbox per waiting item of the note; the Undo  *)
(* offer will put the create back (addToOutbox(readerId, waiting)).           *)
YouFinishRemoving ==
    /\ ui.act = "drop"
    /\ \E k \in ui.todo :
         /\ box' = Del(box, k)
         /\ refusedIds' = refusedIds \ {k}   \* the reader removed it on purpose
         /\ IF ui.todo = {k}
            THEN /\ want' = [want EXCEPT !["n"] = Want("gone", want["n"].words, ui.seq, "remove")]
                 /\ offer' = [NoOffer EXCEPT !.kind = "readd", !.item = ui.item, !.note = "n"]
                 /\ ui' = IdleUI
            ELSE /\ ui' = [ui EXCEPT !.todo = @ \ {k}]
                 /\ UNCHANGED <<want, offer>>
    /\ UNCHANGED <<net, session, page, fl, srv, stored, made, okIds, flushDropped, flags>>

(* undoRemove() runs the offer's undo, made in removeNote().                 *)
YouPressUndo ==
    /\ ui.act = "none" /\ offer.kind # "none" /\ made < MaxActions
    /\ IF offer.kind = "readd"
       THEN \* Made offline and never sent: addToOutbox(readerId, waiting)
            /\ box' = Put(box, [offer.item EXCEPT !.owner = Writer])
            /\ want' = [want EXCEPT !["n"] = Want("live", offer.item.seq, offer.item.seq, "undo")]
            /\ offer' = NoOffer
            /\ UNCHANGED <<ui, srv, stored, flags>>
       ELSE IF offer.queued /\ offer.id \in DOMAIN box
       THEN \* queued and outboxFor() finds the removal: removeFromOutbox(changeId) comes after an await
            /\ ui' = [IdleUI EXCEPT !.act = "takeBack", !.seq = NewId, !.note = offer.note, !.todo = {offer.id}]
            /\ offer' = NoOffer
            /\ UNCHANGED <<box, want, srv, stored, flags>>
       ELSE \* otherwise: change(a, "restore", { annotation: a })
            \E o \in DirectOutcomes :
              LET x == offer.note
                  i == Item(NewId, "restore", x, Writer, NewId, NewId)
              IN /\ Direct(i, o)
                 /\ IF DirectOk(i, o)
                    THEN /\ want' = [want EXCEPT ![x] = Want("live", want[x].words, NewId, "undo")]
                         /\ offer' = NoOffer
                    ELSE UNCHANGED <<want, offer>>   \* "Not brought back": Undo stays
                 /\ UNCHANGED ui
    /\ made' = made + 1
    /\ UNCHANGED <<net, session, page, fl, Ghosts>>

(* undo(): removeFromOutbox(changeId), taking the waiting removal back.      *)
YouFinishUndo ==
    /\ ui.act = "takeBack"
    /\ \E k \in ui.todo :
         /\ box' = Del(box, k)
         /\ refusedIds' = refusedIds \ {k}
    /\ want' = [want EXCEPT ![ui.note] = Want("live", want[ui.note].words, ui.seq, "undo")]
    /\ ui' = IdleUI
    /\ UNCHANGED <<net, session, page, fl, offer, srv, stored, made, okIds, flushDropped, flags>>

-----------------------------------------------------------------------------
(* The browser and the network.                                              *)
Quiet == <<page, box, fl, ui, offer, srv, stored, want, made, Ghosts, flags>>

NetworkDrops == net = "up" /\ net' = "down" /\ UNCHANGED <<session>> /\ UNCHANGED Quiet
NetworkReturns == net = "down" /\ net' = "up" /\ UNCHANGED <<session>> /\ UNCHANGED Quiet

(* signOutAction(): the cookie goes; no open tab is told or reloaded.         *)
YouSignOut == SignIns # "none" /\ session = "A" /\ session' = "nobody" /\ UNCHANGED <<net>> /\ UNCHANGED Quiet
YouSignIn == session = "nobody" /\ session' = "A" /\ UNCHANGED <<net>> /\ UNCHANGED Quiet
AnotherReaderSignsIn == SignIns = "AB" /\ session = "nobody" /\ session' = "B" /\ UNCHANGED <<net>> /\ UNCHANGED Quiet
AnotherReaderSignsOut == session = "B" /\ session' = "nobody" /\ UNCHANGED <<net>> /\ UNCHANGED Quiet

(* A reader page loads in the second tab for the reader signed in            *)
(* (page.tsx passes readerId={user.id}); closing the tab drops its flush.     *)
ATabOpens ==
    /\ "t2" \in Tabs /\ page["t2"] = "closed" /\ session = SecondTab
    /\ page' = [page EXCEPT !["t2"] = session]
    /\ UNCHANGED <<net, session, box, fl, ui, offer, srv, stored, want, made, Ghosts, flags>>
ATabCloses ==
    /\ "t2" \in Tabs /\ page["t2"] # "closed"
    /\ page' = [page EXCEPT !["t2"] = "closed"]
    /\ fl' = [fl EXCEPT !["t2"] = IdleFlush]
    /\ UNCHANGED <<net, session, box, ui, offer, srv, stored, want, made, Ghosts, flags>>

-----------------------------------------------------------------------------
(* flushOutbox(readerId) in a tab: when the page opens (SYNC_EVENT), on     *)
(* "online", and every 30 s while a note shows as waiting.                   *)

(* outboxFor(owner): one getAll; mine(), not refused, sorted by savedAt.     *)
FlushReads(t) ==
    /\ page[t] # "closed" /\ fl[t].pc = "idle"
    /\ Snapshot(page[t]) # {}
    /\ fl' = [fl EXCEPT ![t] = [IdleFlush EXCEPT !.pc = "send", !.todo = SortByAt(Snapshot(page[t]))]]
    /\ UNCHANGED <<net, session, page, box, ui, offer, srv, stored, want, made, Ghosts, flags>>

(* One fetch for the item at the head of the list, with the browser's cookie. *)
SentFlags(t, i) ==
    [flags EXCEPT !.otherSession = @ \/ session \notin {Writer, "nobody"},
                  !.otherPage = @ \/ (i.owner # "none" /\ i.owner # page[t]),
                  !.resent = @ \/ i.id \in refusedIds]

FlushSends(t) ==
    /\ page[t] # "closed" /\ fl[t].pc = "send"
    /\ LET i == Head(fl[t].todo)
           h == Handle(i, session)
       IN \/ \* no network: fetch throws, the loop breaks
             /\ net = "down"
             /\ fl' = [fl EXCEPT ![t] = IdleFlush]
             /\ UNCHANGED <<srv, stored, flags>>
          \/ \* the library handles it; the answer is on its way
             /\ net = "up"
             /\ srv' = h.srv /\ stored' = h.stored
             /\ fl' = [fl EXCEPT ![t].pc = "answer", ![t].cur = i, ![t].st = h.st, ![t].as = session]
             /\ flags' = [SentFlags(t, i) EXCEPT !.older = @ \/ h.older, !.twice = @ \/ h.twice]
          \/ \* the library fails (5xx, or it loses a race on the primary key): the loop breaks
             /\ net = "up"
             /\ fl' = [fl EXCEPT ![t] = IdleFlush]
             /\ flags' = SentFlags(t, i)
             /\ UNCHANGED <<srv, stored>>
    /\ UNCHANGED <<net, session, page, box, ui, offer, want, made, Ghosts>>

(* The answer comes back and the outbox is written (its own transaction).    *)
FlushGetsAnswer(t) ==
    /\ page[t] # "closed" /\ fl[t].pc = "answer" /\ net = "up"
    /\ LET i == fl[t].cur
           rest == Tail(fl[t].todo)
           next == IF rest = <<>> THEN IdleFlush ELSE [IdleFlush EXCEPT !.pc = "send", !.todo = rest]
       IN IF ResOk(fl[t].st)
          THEN \* sent += 1; removeFromOutbox(item.id)
               /\ FlushDrop(i.id)
               /\ okIds' = okIds \cup {i.id}
               /\ fl' = [fl EXCEPT ![t] = next]
               /\ UNCHANGED <<refusedIds, flags>>
          ELSE IF Refuses(fl[t].st)
          THEN \* refused += 1; addToOutbox(owner, { ...item, refused: { status, reason, at } })
               /\ box' = Put(box, [i EXCEPT !.refused = TRUE, !.owner = page[t]])
               /\ refusedIds' = refusedIds \cup {i.id}
               /\ fl' = [fl EXCEPT ![t] = next]
               /\ flags' = [flags EXCEPT !.refusedForOther = @ \/ fl[t].as # Writer]
               /\ UNCHANGED <<okIds, flushDropped>>
          ELSE \* break: the item stays
               /\ fl' = [fl EXCEPT ![t] = IdleFlush]
               /\ UNCHANGED <<box, Ghosts, flags>>
    /\ UNCHANGED <<net, session, page, ui, offer, srv, stored, want, made>>

(* The network drops while the answer is on its way: fetch throws, the loop breaks. *)
FlushLosesAnswer(t) ==
    /\ page[t] # "closed" /\ fl[t].pc = "answer" /\ net = "down"
    /\ fl' = [fl EXCEPT ![t] = IdleFlush]
    /\ UNCHANGED <<net, session, page, box, ui, offer, srv, stored, want, made, Ghosts, flags>>

-----------------------------------------------------------------------------
Next ==
    \/ YouWriteANote
    \/ \E x \in Notes : YouEditANote(x)
    \/ YouFinishEditing
    \/ \E x \in Notes : YouRemoveANote(x)
    \/ YouFinishRemoving
    \/ YouPressUndo
    \/ YouFinishUndo
    \/ NetworkDrops
    \/ NetworkReturns
    \/ YouSignOut
    \/ YouSignIn
    \/ AnotherReaderSignsIn
    \/ AnotherReaderSignsOut
    \/ ATabOpens
    \/ ATabCloses
    \/ \E t \in Tabs : FlushReads(t)
    \/ \E t \in Tabs : FlushSends(t)
    \/ \E t \in Tabs : FlushGetsAnswer(t)
    \/ \E t \in Tabs : FlushLosesAnswer(t)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* The rules. SKILL.md gives each in one sentence, with the harm if broken.  *)

(* What the reader last did to note x is on the library, or an item that     *)
(* carries it is still on this device under the reader's name (waiting, or   *)
(* kept as refused, which the Notes panel lists under "Could not be saved"). *)
(* Presence (there or removed) and words are checked apart: a restore and an *)
(* older edit can wait as two items.                                          *)
(* The rules name owners directly and never use Mine, which stands for code. *)
Yours(owner) == owner \in {Writer, "none"}
Carried(x, seq) == \E k \in DOMAIN box : box[k].note = x /\ box[k].seq = seq /\ Yours(box[k].owner)
KeptOrSaved(x) ==
    /\ want[x].state = "live" =>
         /\ srv[x].state = "live" \/ Carried(x, want[x].pseq)
         /\ srv[x].words = want[x].words \/ Carried(x, want[x].words)
    /\ want[x].state = "gone" => srv[x].state # "live" \/ Carried(x, want[x].pseq)

NewNoteKept == want["n"].last \in {"write", "edit"} => KeptOrSaved("n")
EditKept == want["s"].last = "edit" => KeptOrSaved("s")
RemovalKept == \A x \in Notes : want[x].last = "remove" => KeptOrSaved(x)
UndoKept == \A x \in Notes : want[x].last = "undo" => KeptOrSaved(x)
NewerWins == ~flags.older
OnlyYourSession == ~flags.otherSession
OnlyYourPage == ~flags.otherPage
StaysYours == \A k \in DOMAIN box : Yours(box[k].owner)
StoredOnce == ~flags.twice
DroppedOnlyWhenSaved == flushDropped \subseteq okIds
RefusedKept == \A k \in refusedIds : k \in DOMAIN box \/ k \in okIds
RefusedSkipped == \A t \in Tabs : \A j \in DOMAIN fl[t].todo : ~fl[t].todo[j].refused
RefusedNotResent == ~flags.resent
RefusedOnlyForYou == ~flags.refusedForOther

ItemType == [id : Ids, op : {"create", "edit", "remove", "restore"}, note : Notes,
             owner : {"A", "B", "none"}, seq : 0 .. MaxActions + 1, at : 0 .. MaxActions + 1, refused : BOOLEAN]
TypeOK ==
    /\ net \in {"up", "down"}
    /\ session \in {"A", "B", "nobody"}
    /\ \A k \in DOMAIN box : k \in Ids /\ box[k] \in ItemType /\ box[k].id = k
    /\ \A t \in Tabs : fl[t].pc \in {"idle", "send", "answer"}
    /\ made \in 0 .. MaxActions
=============================================================================
