---
name: verify-outbox
description: Check a change to Neolibrary's offline note outbox against its promise, with TLC (the TLA+ model checker) on a model of every order of steps. Use for any change to lib/outbox.ts, lib/reader/note-sender.ts, lib/reader-header.ts, or useNotes.ts in app/(reader)/books/[id]/read/, to how the reader page passes readerId or starts a sync (page.tsx, Reader.tsx), to the note routes under app/api/books/[id]/annotations/ and app/api/annotations/, to lib/library/annotations.ts (createAnnotationOnce, addVersion, ownsBook), to sign-out (app/(app)/actions.ts), or to how public/sw.js treats requests that are not GET; and when someone asks whether offline notes can be lost, doubled or sent as the wrong reader.
---

# Verify the offline note outbox

Written for: a Claude session that is changing one of the files below and
has never seen this check. Samuel (the owner, a scientist, not a software
engineer) reads its results only through you, so tell him what it found in
plain words.

## What is verified

**The rule.** A note, edit, removal or Undo a reader makes while the network
is down or flaky is saved on the library in the end, in the order made,
under that reader, sent by that reader's own session; a change the library
refuses is kept and shown, never sent again; sending twice never makes two
notes.

**The harm if it breaks.** A reader's words vanish or come back wrong without
a word (a note written on the train is never saved, a removed note returns,
an older edit replaces a newer one), or one reader's notes travel under
another reader's sign-in.

The outbox is a small store in the browser (IndexedDB, the browser's own
database) where a change waits when `fetch` fails. `flushOutbox` sends what
waits when the reader page opens, when the browser fires `online`, and every
30 s while a note shows as waiting; and at once when a change is put behind
an earlier change of the same note that still waits.

## Files in this folder

| File | What it is |
|---|---|
| `Outbox.tla` | The model: the outbox, two tabs, the network, who is signed in, removals made on another device, and the library, as the code has them at the sync commit |
| `Outbox.cfg` | Scenario "one reader, two tabs", with the rules the code keeps today |
| `Readers.cfg` | Scenario "two readers, one browser", with the rules the code keeps today |
| `Flow.cfg` | A scenario small enough to draw every state (one tab, one new note); used for `outbox-flow.mmd`. Every rule holds in it (194 states, 2026-11-15) |
| `check.sh` | The one command (below) |
| `view.ts` | The words the chart uses for each state and step (for the `/pstack:statechart` skill) |
| `outbox-flow.mmd` | The chart of `Flow.cfg` as the code was at af958c2b, before the fixes: it still shows the old steps (rewriting a waiting note) and where F1 and F2 broke. Not redrawn since: the `/pstack:statechart` skill was not available to the fixing session. Redraw it before relying on it |
| `replay.ts`, `replay.config.mts` | Each finding still recorded, replayed on the real code (the outbox, `note-sender.ts`, the routes, the database of the unit tests) |

The fixed findings are tested where `npm test` runs them: `lib/reader/note-sender.test.ts` (F1-F7, on the real
code, in the pretend browser of `lib/reader/outbox-test-kit.ts`, which `replay.ts` shares) and
`lib/library/annotations.test.ts` (F8).

## Does my change touch the verified code?

Sync commit: **109aea88** (2026-11-15, branch `m44-fix-outbox`; if the branch is squash-merged, the merge commit
on main replaces it: put its hash here). At that commit the model was confirmed to describe these files:

| File | What the model covers (line numbers at the sync commit) |
|---|---|
| `lib/outbox.ts` | `mine` 78 (owner-less items only for `ownBook`), `noteHeaders` 82, `addToOutbox` 87, `removeFromOutbox` 88, `outboxFor` 91, `isOffline` 97, `flushOutbox` 110 (reads the item again 117, skips it if gone or refused 118, `catch { break }` 138, `res.ok` then `removeFromOutbox(item.id)` 141-143, refused test 144, refused `addToOutbox(owner, …)` 148, `else break` 149) |
| `lib/reader/note-sender.ts` | `noteRequest` 14 (the reader header; a failed fetch throws `TypeError`, an answer that is not ok throws), `waitsFor` 23, `change` 36 (reads the outbox, `savedAt` after every waiting item 40, behind a waiting change of the note 42 then `soon()` 44, otherwise sent at once), `create` 67, `edit` 79, `forget` 82, `remove` and its Undo 88-91, `flush` 96 |
| `app/(reader)/books/[id]/read/useNotes.ts` | the sender, with `soon` sending `SYNC_EVENT`, 35; `reload` 71; the sync effect 128-146 (`online` 136, 30 s timer 138); `saveNote` 148, `forget` 154, `removeNote` 160, `undoRemove` 174 |
| `app/(reader)/books/[id]/read/Reader.tsx` | `SYNC_EVENT` sent when the page opens, 554 |
| `app/(reader)/books/[id]/read/page.tsx` | `readerId={user.id}` 79: fixed when the page loads; the page opens only the reader's own books (`getBook`, `isOwnBook`) |
| `lib/reader-header.ts` | `READER_HEADER`, `meantForAnother`, `signedInAsAnother` (401) |
| `app/api/books/[id]/annotations/route.ts` | POST: turned away when meant for another reader, 43; with `id`, `createAnnotationOnce` (201 new, 200 already there) 50-51; `AnnotationError` gives 400, 56 |
| `app/api/annotations/[id]/route.ts`, `.../restore/route.ts` | `fail` 8 (not found gives 404, other errors 400); PATCH turned away 26, DELETE turned away 38 (204 at 42); restore POST turned away 12 |
| `lib/library/annotations.ts` | `ownsBook` 179 (checked by `createAnnotation` at 221), `createAnnotationOnce` 277, `addVersion` 355 (change id already done 361, a removal of a note already removed is kept 369, not found 370, restore of a note that is there adds nothing 371) |
| `db/migrations/0007_annotations.up.sql` | `id` PRIMARY KEY 7, `UNIQUE (annotation_id, version)` 24: the loser of two racing inserts fails |
| `app/(app)/actions.ts` | `signOutAction` 20: the cookie goes; open tabs are not told |
| `public/sw.js` | 52: requests that are not GET pass straight to the network |

To see whether a change moved any of it:

```sh
git diff --stat 109aea88 -- lib/outbox.ts lib/reader/note-sender.ts lib/reader-header.ts 'app/(reader)/books/[id]/read/useNotes.ts' 'app/(reader)/books/[id]/read/Reader.tsx' 'app/(reader)/books/[id]/read/page.tsx' 'app/api/books/[id]/annotations/route.ts' 'app/api/annotations/[id]' lib/library/annotations.ts db/migrations/0007_annotations.up.sql 'app/(app)/actions.ts' public/sw.js
```

If it lists a file, read the diff against the table under "Where each part of
the model is in the code". A change outside the lines above (a new kind of
note, a style) usually needs nothing. A change to what is sent, when, by
whom, or what happens to the outbox item afterwards needs the model updated
first (see "When a change is intended").

**Moving the sync commit.** Change `109aea88` above to a newer commit only
after you have read every covered file at that commit, confirmed each row of
both tables still points at the right code (update the line numbers), and run
`check.sh` with the result recorded below. Say in your commit that you did.

## The one command

From anywhere inside the repository:

```sh
sh .claude/skills/verify-outbox/check.sh
```

It needs Java and TLC, which `scripts/tlc.sh` fetches at pinned versions on
first use (mise, Temurin 25, TLC 1.7.4). It takes about half a minute and
ends, when nothing has changed, with:

```
verify-outbox: as recorded: 2 scenarios hold every listed rule; 2 known findings still break
```

and exit 0. What it does: it runs `Outbox.cfg` and `Readers.cfg` and expects
every rule listed there to hold (TLC exit 0), then runs each known finding
alone and expects it still to break (TLC exit 12). Every other result prints a
line in capitals and the command exits 1:

- `BROKEN   <scenario>.cfg: exit 12, rule <Rule> is broken` — your change
  broke a rule the code kept. Read the result (next section).
- `FIXED?   F<n> <Rule> now holds` — a known finding no longer breaks. If
  your change was meant to fix it, confirm with the replay (its test now
  fails, as it should), then move the rule into that scenario's `.cfg`,
  delete its line from `FINDINGS` in `check.sh` and the test from
  `replay.ts`, and update "Known findings" here. If it was not meant to,
  the model or the change is wrong: find out which.
- `ERROR` or an exit of 150 or more — the model itself does not run (a typo,
  an undefined operator, a value of the wrong type). That is a modeling
  error, never a finding.

## Reading a result

Read every result with the `/pstack:statechart` skill, giving it `Outbox.tla`,
the config of the scenario that broke (`Outbox.cfg`, `Readers.cfg` or
`Flow.cfg`; for a finding, the scenario `check.sh` names) and `view.ts`. It
tells each broken rule as its shortest path in the reader's words, and when
everything holds it draws how the outbox moves between states. Run it from a
scratch folder, never from this one.

Then decide whether the path is a real bug or a modeling error:

1. Map every step of the path to the code with the table under "Where each
   part of the model is in the code". If a step cannot happen in the code
   (an order the code forbids, a value it never sends), the model is wrong:
   fix the model and say in your commit what it got wrong. Never weaken or
   drop a rule to make the check pass.
2. If every step can happen, replay the path on the real code: add a test to
   `replay.ts` modelled on the ones there (`page()` from
   `lib/reader/outbox-test-kit.ts` drives the real `note-sender.ts` as
   `useNotes.ts` does; `browser.ways` decides how each fetch ends: `"answer"`,
   `"offline"`, `"lose"`, `"hold"` or `"slow"`), and run

   ```sh
   npx vitest run --config .claude/skills/verify-outbox/replay.config.mts
   ```

   (about 5 seconds; the app's own `npm test` does not run it). If the test
   shows the harm, it is a real bug: report it as numbered steps in the
   code's words, with the replay result. Do not change product code to fix it
   unless Samuel or your task asks; add it to "Known findings" and to
   `FINDINGS` in `check.sh` instead.

## When a change is intended

1. Find the code you changed in the table below and change the operator that
   mirrors it, in the same commit as the code. Keep one action per indivisible
   step of the code: one IndexedDB transaction, one request as the library
   handles it, or the JavaScript between two `await`s. If your change adds an
   `await` between a read and a write of the outbox, split the action in two,
   as `YouEditANote` and `YouFinishChange` are split.
2. Do not touch the rules (the operators from `Yours` down to `TypeOK`) or
   the ghost variables they read (`want`, `okIds`, `flushDropped`,
   `refusedIds`, `flags`) unless the promise itself changed. A rule must not
   use the operator that mirrors the code it checks (that is why `StaysYours`
   uses `Yours`, not `Mine`).
3. Run `check.sh`. If a rule breaks, read the result as above. If a known
   finding is fixed, follow `FIXED?` above.
4. If the chart's words no longer fit, update `view.ts`, draw `Flow.cfg` again
   with `/pstack:statechart`, and copy its chart over `outbox-flow.mmd`.
5. Move the sync commit only as described above.

## Where each part of the model is in the code

| Model (`Outbox.tla`) | Code |
|---|---|
| `box`, `Put`, `Del` | the IndexedDB store; `addToOutbox` (`put({ ...item, owner })`), `removeFromOutbox` |
| `Mine`, `BookOwner`, `Pick`, `Snapshot`, `SortByAt` | `mine(items, owner, ownBook)` (an item with no owner counts only on the page of its own book, which is its writer's), the `!i.refused` filter, `flushOutbox`'s sort by `savedAt` |
| `FlushReads(t)` | `flushOutbox(owner, ownBook)` reading its list once (`getAll`, `mine`, the filter), in tab `t` |
| `FlushRechecks(t)` | the `get` of each item just before its request: gone or refused, skip it |
| `FlushSends(t)` | one `fetch` of the loop, with the browser's one cookie (`session`) and the header naming the page's reader; no network or a 5xx ends the loop |
| `FlushGetsAnswer(t)` | `res.ok` then `removeFromOutbox(item.id)`; refused then `addToOutbox(owner, { ...item, refused })`; anything else (401 included) `break` |
| `FlushLosesAnswer(t)` | the library acted but `fetch` throws: `catch { break }` |
| `ResOk`, `Refuses` | `res.ok`; the test on line 144 (4xx except 401, 408, 429) |
| `Handle(i, who, meant)` | the routes and `annotations.ts`: 401 no session, 401 meant for another reader (`meantForAnother`), `createAnnotationOnce` 201/200, `ownsBook` 400, `addVersion` (done 200, not found 404, a removal of a removed note kept 200, restore of a note that is there 200) |
| `Direct(i, o)`, `DirectOutcomes` | `create` and `change` through `noteRequest()`: `"queued"` (no network, `addToOutbox`), `"answered"`, `"lost"` (the library acted, the answer was lost, `addToOutbox` under the same id) |
| `Waits(x)` | `waitsFor` in `change`: a change of note `x` waits in the outbox, not refused |
| `YouWriteANote` | `create` |
| `YouEditANote`, `YouRemoveANote`, `YouPressUndo`, then `YouFinishChange` | `edit`, `remove`/`forget`, and Undo's `change(a, "restore")`: `change` reads the outbox; after an `await`, it puts the change behind a waiting one (and calls `soon`), or sends it at once |
| `RemovedElsewhere` | the reader removes the saved note on another device; this browser is not told |
| `YouSignOut`, `YouSignIn`, `AnotherReaderSignsIn`, `AnotherReaderSignsOut` | `signOutAction` and signing in: the cookie changes; open tabs keep the `readerId` they loaded with |
| `ATabOpens`, `ATabCloses` | a reader page loading in a second tab with `readerId={user.id}`; closing it stops its flush |
| `NetworkDrops`, `NetworkReturns` | the network |

Ids: 0 is the new note's create (and its id), 1 an old edit saved before
owners were recorded, 2 and up each later change. `seq` and `at` order the
changes (`savedAt`).

## The rules

| Rule | In plain words |
|---|---|
| `NewNoteKept` | The words a reader last gave a new note are on the library, or wait in the outbox under that reader |
| `EditKept` | The same for an edit of a note the library already had |
| `RemovalKept` | A removed note is removed on the library, or its removal waits |
| `UndoKept` | A note brought back with Undo is there on the library, or its return waits |
| `NewerWins` | The library never puts an older edit over a newer one |
| `OnlyYourSession` | A page sends a reader's changes only with that reader's sign-in |
| `ActedOnlyAsYou` | The library acts on a reader's change (stores it, finds it there, or refuses it) only under that reader's sign-in |
| `OnlyYourPage` | A page sends only the changes of the reader it was loaded for (or ones saved before owners were recorded) |
| `StaysYours` | Every change of the reader's in the outbox stays under that reader's name (or none) |
| `StoredOnce` | Sending a change twice never stores it twice |
| `DroppedOnlyWhenSaved` | A flush deletes an item only after the library said it has it |
| `RefusedKept` | A refused change stays in the outbox until the reader removes it |
| `RefusedSkipped` | A flush never picks a refused change |
| `RefusedNotResent` | A refused change is never sent again |
| `RefusedOnlyForYou` | A change is marked refused only for a refusal given to its own reader |
| `TypeOK` | Every variable holds a value of the expected shape |

## Known findings

A "lost answer" is a request the library carried out whose answer never
reached the page (the network dropped on the way back), so the page treated
it as never sent.

### Fixed (2026-11-15, branch `m44-fix-outbox`)

Each has a test in `lib/reader/note-sender.test.ts` (F8: in
`lib/library/annotations.test.ts`) that failed on the code before the fix and
passes after; its rule is listed in the scenario configs and holds.

- **F1, `NewNoteKept`.** New words given to a note still waiting in the outbox
  were written into the waiting item, which a flush then deleted on the
  library's "already have it" (lost answer, or a flush in flight).
- **F2, `RemovalKept`.** Removing such a note only deleted its items from the
  outbox, though the library had it.
- **F3, `UndoKept`.** Undo of a waiting removal only took it out of the
  outbox, though the library may already have removed the note.
- **F4, `NewerWins`, `EditKept`.** `change()` sent a new edit at once, ahead of
  an older edit still waiting, which then landed on top.
  The fix for F1-F4: the reader's actions never rewrite or delete a waiting
  item. Every edit, removal and Undo is its own change; one made while an
  earlier change of the same note waits goes behind it (`waitsFor`, a later
  `savedAt`), and the page flushes at once (`soon`). What a reader sees
  differently: a note written and removed offline now reaches the library and
  is listed under "Removed notes"; a change queued behind one that is later
  refused is itself shown under "Could not be saved", not as "Not saved" at once.
- **F5, `RefusedOnlyForYou` (and the new `ActedOnlyAsYou`).** A's page left
  open after B signed in sent A's notes with B's sign-in; they were refused
  and kept refused for good. Fix: note requests name their reader
  (`x-neolibrary-reader`); the routes turn away untouched (401) a request
  meant for another reader; the outbox keeps it waiting. Items refused this
  way before the fix stay refused (listed under "Could not be saved").
- **F6, `StaysYours`.** An owner-less item counted as whoever was signed in;
  B's page sent A's item and put B's name on it when refused. Fix: an
  owner-less item counts only on the page of its own book
  (`mine(…, ownBook)`); it waits until its writer opens that book.
- **F8, `UndoKept` (found while fixing, once the model had removals made on
  another device).** A removal refused because the note was already removed
  could be sent again by a second tab after Undo brought the note back,
  removing it again. Fix: `addVersion` keeps a removal of a removed note (sent
  with a change id) as a second removed version under that id, so a resend
  adds nothing.

### Still recorded (`check.sh` expects them to break)

**F5, `OnlyYourSession` (Readers scenario; its harm is removed).** A's page
can still send A's change with B's cookie: no page can read the sign-in at the
moment it sends (the cookie belongs to the browser, shared by every tab). The
library now turns it away untouched and the outbox keeps it waiting
(`ActedOnlyAsYou` and `RefusedOnlyForYou` hold). A full fix needs a sign-in
bound to the page, which is a change to how signing in works.
1. Reader A's book is open; a note A wrote offline waits under A.
2. A signs out from another tab; reader B signs in on the same browser.
3. A's page flushes: `flushOutbox(A)` sends A's note with B's cookie and the header naming A.
4. The route answers 401 "Signed in as another reader."; the item stays, not refused, and is sent once A signs in.
Replay: reproduced (`replay.ts`).

**F7, `RefusedNotResent` (Outbox scenario; does no harm).** A refused change
can still be sent once more.
1. Two tabs of A's are open; an edit of a saved note waits; A removes the note on another device.
2. Both tabs start a flush (the `online` event reaches every tab at once); each reads the edit again and finds it not refused.
3. Tab 1's request reaches the library first: 404; tab 1 keeps it as refused.
4. Tab 2's request, already on its way, arrives: refused again; nothing changes on the library.
Before the fix, any tab whose list was read before the refusal sent it, however
much later; the read just before each request closes that. A resent removal
adds nothing (F8). A lock across tabs (Web Locks) held over the request would
close this too, but on the iPad a background tab frozen while holding it would
stop every other tab's notes from being sent.
Replay: reproduced (`replay.ts`, the second tab's request held on its way).

## Bounds and assumptions

- Reader A makes at most 2 changes per run (`MaxActions`): write, edit,
  remove or Undo, on one new note and one note the library already has.
  Once, on 2026-11-15, `Outbox.cfg` with `MaxActions = 3` was run: with
  `NewNoteKept`, `RemovalKept` and `UndoKept` they held (4,046,200 states,
  97 s); with `EditKept` listed, it broke along F7's path (an old edit,
  refused, resent by a second tab after Undo and a newer edit; that model had
  no read before each request, which narrows the path but does not close it).
- Two tabs at most. Only tab 1 makes changes; tab 2 only flushes. Reader B
  makes no notes.
- `RemovedElsewhere` (constant `Elsewhere`): A may remove the saved note once
  on another device, between two of A's actions here; the rules about A's
  changes on this browser then no longer ask for that note to be there.
- Every note in the model is on a book of A's (`BookOwner`); B's pages are on
  B's own books.
- Every fetch either does not reach the library, is answered, or is carried
  out with its answer lost. The library may also fail (5xx).
- The library handles each request in one step. Its read-then-insert is not
  split: the primary key and `UNIQUE (annotation_id, version)` make the loser
  of a race fail, which the model has as "the library fails".
- No two changes share the same `savedAt` millisecond (`change` makes each
  change's `savedAt` later than every item waiting).
- The service worker never answers a request that is not GET (`sw.js` line 52).
- Scenarios: `Outbox.cfg` (one reader, two tabs, signing out and in, an old
  item may wait, a removal on another device) and `Readers.cfg` (A's tab, A
  signs out, B signs in and may open a tab on a book of B's). A rule listed in
  neither config is checked only through `check.sh`'s findings.

## Left out

- Dismissing or copying a refused item from "Could not be saved".
- Export and import of notes, the AI notes, and drawings' own storage.
- The library's other writes to a note (another device of the same reader
  editing it at the same time is covered only as "the library already has a
  newer version").
- `useNotes.ts` itself (a React hook) does not run in the tests: they drive
  `note-sender.ts`, which holds every step that touches the outbox or the
  network. Keep it that way: put a new such step there, not in the hook.
- A pass covers the model under these bounds, not the whole app.

## Index

This skill is not yet listed in `.claude/skills/README.md`; add a row there
when the skill is merged (it sits outside this folder).
