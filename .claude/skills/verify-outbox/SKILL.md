---
name: verify-outbox
description: Check a change to Neolibrary's offline note outbox against its promise, with TLC (the TLA+ model checker) on a model of every order of steps. Use for any change to lib/outbox.ts, to useNotes.ts or reader-helpers.ts's api() in app/(reader)/books/[id]/read/, to how the reader page passes readerId or starts a sync (page.tsx, Reader.tsx), to the note routes under app/api/books/[id]/annotations/ and app/api/annotations/, to lib/library/annotations.ts (createAnnotationOnce, addVersion, ownsBook), to sign-out (app/(app)/actions.ts), or to how public/sw.js treats requests that are not GET; and when someone asks whether offline notes can be lost, doubled or sent as the wrong reader.
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
30 s while a note shows as waiting.

## Files in this folder

| File | What it is |
|---|---|
| `Outbox.tla` | The model: the outbox, two tabs, the network, who is signed in, and the library, as the code has them at the sync commit |
| `Outbox.cfg` | Scenario "one reader, two tabs", with the rules the code keeps today |
| `Readers.cfg` | Scenario "two readers, one browser", with the rules the code keeps today |
| `Flow.cfg` | A scenario small enough to draw every state (one tab, one new note); used for `outbox-flow.mmd` |
| `check.sh` | The one command (below) |
| `view.ts` | The words the chart uses for each state and step (for the `/pstack:statechart` skill) |
| `outbox-flow.mmd` | The chart of `Flow.cfg`: how a note written offline moves between states, and where the rules break |
| `replay.ts`, `replay.config.mts` | Each known finding's path, replayed on the real code (the outbox, the routes, the database of the unit tests) |

## Does my change touch the verified code?

Sync commit: **af958c2b** (2026-11-15). At that commit the model was confirmed
to describe these files:

| File | What the model covers (line numbers at the sync commit) |
|---|---|
| `lib/outbox.ts` | `mine` 71, `addToOutbox` 73, `removeFromOutbox` 74, `outboxFor` 76, `isOffline` 82, `flushOutbox` 92 (skips refused 95, `catch { break }` 115, `res.ok` then `removeFromOutbox(item.id)` 118-120, refused test 121, refused `addToOutbox(owner, …)` 125, `else break` 126) |
| `app/(reader)/books/[id]/read/useNotes.ts` | `reload` 67, `withOutbox` and `madeOffline` 95-100, `change` 113, `waitingCreate` 132, `create` 140, the sync effect 157-174 (`online` 164, 30 s timer 166), `saveNote` 176, `removeNote` 195 (re-add Undo 201, queued Undo 204), `undoRemove` 222 |
| `app/(reader)/books/[id]/read/reader-helpers.ts` | `api` 283-287 (a failed fetch throws `TypeError`; an answer that is not ok throws) |
| `app/(reader)/books/[id]/read/Reader.tsx` | `SYNC_EVENT` sent when the page opens, 554 |
| `app/(reader)/books/[id]/read/page.tsx` | `readerId={user.id}` 79: fixed when the page loads |
| `app/api/books/[id]/annotations/route.ts` | POST: with `id`, `createAnnotationOnce` (201 new, 200 already there) 48-49; `AnnotationError` gives 400, 54 |
| `app/api/annotations/[id]/route.ts`, `.../restore/route.ts` | PATCH and DELETE with `changeId`; not found gives 404, other errors 400 |
| `lib/library/annotations.ts` | `ownsBook` 221, `createAnnotationOnce` 277, `addVersion` 355 (change id already done 361-362, not found 366, restore of a note that is there adds nothing 367) |
| `db/migrations/0007_annotations.up.sql` | `id` PRIMARY KEY 7, `UNIQUE (annotation_id, version)` 24: the loser of two racing inserts fails |
| `app/(app)/actions.ts` | `signOutAction` 20: the cookie goes; open tabs are not told |
| `public/sw.js` | 52: requests that are not GET pass straight to the network |

To see whether a change moved any of it:

```sh
git diff --stat af958c2b -- lib/outbox.ts 'app/(reader)/books/[id]/read/useNotes.ts' 'app/(reader)/books/[id]/read/reader-helpers.ts' 'app/(reader)/books/[id]/read/Reader.tsx' 'app/(reader)/books/[id]/read/page.tsx' 'app/api/books/[id]/annotations/route.ts' 'app/api/annotations/[id]' lib/library/annotations.ts db/migrations/0007_annotations.up.sql 'app/(app)/actions.ts' public/sw.js
```

If it lists a file, read the diff against the table under "Where each part of
the model is in the code". A change outside the lines above (a new kind of
note, a style) usually needs nothing. A change to what is sent, when, by
whom, or what happens to the outbox item afterwards needs the model updated
first (see "When a change is intended").

**Moving the sync commit.** Change `af958c2b` above to a newer commit only
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
verify-outbox: as recorded: 2 scenarios hold every listed rule; 9 known findings still break
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
   `replay.ts` modelled on the ones there (`page()` makes `useNotes.ts`'s
   calls in its order; `ways` decides how each fetch ends: `"answer"`,
   `"offline"`, `"lose"` or `"hold"`), and run

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
   as `YouEditANote` and `YouFinishEditing` are split.
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
| `Mine`, `Pick`, `Snapshot`, `SortByAt` | `mine`, the `!i.refused` filter, `outboxFor`'s sort by `savedAt` |
| `FlushReads(t)` | `flushOutbox(owner)` reading its list once (`outboxFor` then the filter), in tab `t` |
| `FlushSends(t)` | one `fetch` of the loop, with the browser's one cookie (`session`); no network or a 5xx ends the loop |
| `FlushGetsAnswer(t)` | `res.ok` then `removeFromOutbox(item.id)`; refused then `addToOutbox(owner, { ...item, refused })`; anything else `break` |
| `FlushLosesAnswer(t)` | the library acted but `fetch` throws: `catch { break }` |
| `ResOk`, `Refuses` | `res.ok`; the test on line 121 (4xx except 401, 408, 429) |
| `Handle(i, who)` | the routes and `annotations.ts`: 401 no session, `createAnnotationOnce` 201/200, `ownsBook` 400, `addVersion` (done 200, not found 404, restore of a note that is there 200) |
| `Direct(i, o)`, `DirectOutcomes` | `create` and `change` through `api()`: `"queued"` (no network, `addToOutbox`), `"answered"`, `"lost"` (the library acted, the answer was lost, `addToOutbox` under the same id) |
| `WaitingCreate` | `waitingCreate` (`madeOffline` and `outboxFor`) |
| `YouWriteANote` | `create` |
| `YouEditANote`, `YouFinishEditing` | `saveNote`: read the waiting create, then put the new words into it after an `await`; otherwise `change(a, "edit")` |
| `YouRemoveANote`, `YouFinishRemoving` | `removeNote`: a waiting create and its edits leave the outbox one `removeFromOutbox` at a time; otherwise `change(a, "remove")` |
| `YouPressUndo`, `YouFinishUndo` | `undoRemove` running the offer's `undo`: re-add the waiting create; or take a queued removal back out (`removeFromOutbox(changeId)` after `outboxFor`); or `change(a, "restore")` |
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

The code at the sync commit breaks these rules. Each has a test in
`replay.ts` that passes while the bug is there; all ten passed on the real
code at the sync commit. A "lost answer" is a request the library carried out
whose answer never reached the page (the network dropped on the way back), so
`api()` threw `TypeError` and the page treated it as never sent.

**F1, `NewNoteKept` (Outbox scenario).** New words given to a waiting note are
lost when the library already has the note.
1. Online, the reader writes a note: `create()` POSTs it; `createAnnotationOnce` stores it (201), but the answer is lost, so `create()` puts the create in the outbox.
2. The reader edits it: `saveNote()` finds it with `waitingCreate()` and puts the new words into the waiting create.
3. `flushOutbox` sends the create; `createAnnotationOnce` finds the id and answers 200 with the first words.
4. `res.ok`, so `removeFromOutbox(item.id)` deletes the item holding the new words. The library keeps the first words.
The same happens with a note written offline when `saveNote()` runs while a flush is sending it (201 on its way). Replay: reproduced (both tests).

**F2, `RemovalKept` (Outbox scenario).** A note removed while the library
already has it stays on the library.
1. As F1 step 1 (or a flush is sending a note written offline).
2. The reader removes it: `removeNote()` sees `waitingCreate()` and only deletes its items from the outbox; nothing is sent.
3. The library still has the note; it is back on the next `reload()`.
Replay: reproduced (both tests).

**F3, `UndoKept` (Outbox scenario).** Undo of a removal the library already
took leaves the note removed.
1. The reader removes a saved note: `change(a, "remove")` sends DELETE; the library removes it, but the answer is lost, so the removal waits and Undo's `queued` is true.
2. The reader presses Undo: `outboxFor()` finds the removal, so `undo` only calls `removeFromOutbox(changeId)`; no restore is sent.
3. The library keeps the note removed.
The same happens when the removal was made offline and a flush is sending it as Undo is pressed. Replay: reproduced (both tests).

**F4, `NewerWins` and `EditKept` (Outbox scenario).** An older edit that
waited replaces a newer one.
1. With no network, the reader edits a note: `change(a, "edit")` throws, so the edit waits.
2. The network is back but no flush has sent the edit yet (no `online` event, or the flush has not reached it); the reader edits again: `change()` does not look in the outbox and sends the new words; the library stores them.
3. A flush (the 30 s timer) sends the older edit; its change id is new, so `addVersion` stores it on top.
4. The library shows the older words.
Replay: reproduced.

**F5, `OnlyYourSession` and `RefusedOnlyForYou` (Readers scenario).** A page
left open sends its reader's notes under another reader's sign-in, and they
are then never saved.
1. Reader A's book is open; a note A wrote offline waits under A.
2. A signs out from another tab (`signOutAction`; the open page is not told); reader B signs in on the same browser.
3. A's page flushes (30 s timer or `online`): `flushOutbox(A)` sends A's note with B's cookie.
4. The library answers 400 "Book not found." (`ownsBook` fails for B; an edit or removal gets 404).
5. `flushOutbox` keeps the item as refused, and refused items are skipped, so it is never sent again, even after A signs in.
Replay: reproduced.

**F6, `StaysYours` (Readers scenario).** An item saved before owners were
recorded (before 2026-11-10) can end up under another reader's name.
1. The outbox holds an edit of A's with no `owner`.
2. B is signed in and has a book open: `flushOutbox(B)` picks the item, since `mine` counts an item with no owner as the signed-in reader's.
3. The library answers 404: the note is A's.
4. `addToOutbox(owner, { ...item, refused })` writes `owner: B`. A never sees or sends it again; B's page shows A's words under "Could not be saved".
Replay: reproduced.

**F7, `RefusedNotResent` (Outbox scenario; minor, does no harm).** A refused
change can be sent once more.
1. Two tabs of A's are open; an edit of a note that was since removed waits.
2. Tab 2's `flushOutbox` reads its list, edit included.
3. Tab 1's `flushOutbox` sends the edit; the library answers 404; tab 1 keeps it as refused.
4. Tab 2 sends the same edit from the list it read earlier; it is refused again and nothing changes on the library.
Replay: reproduced.

## Bounds and assumptions

- Reader A makes at most 2 changes per run (`MaxActions`): write, edit,
  remove or Undo, on one new note and one note the library already has.
  Some paths need 3 or more changes; these are not explored.
- Two tabs at most. Only tab 1 makes changes; tab 2 only flushes. Reader B
  makes no notes.
- Every fetch either does not reach the library, is answered, or is carried
  out with its answer lost. The library may also fail (5xx).
- The library handles each request in one step. Its read-then-insert is not
  split: the primary key and `UNIQUE (annotation_id, version)` make the loser
  of a race fail, which the model has as "the library fails".
- `madeOffline` is up to date when `waitingCreate` runs (every caller of
  `create()` reloads after it).
- No two changes share the same `savedAt` millisecond.
- The service worker never answers a request that is not GET (`sw.js` line 52).
- Scenarios: `Outbox.cfg` (one reader, two tabs, signing out and in, an old
  item may wait) and `Readers.cfg` (A's tab, A signs out, B signs in and may
  open a tab). A rule listed in neither config is checked only through
  `check.sh`'s findings.

## Left out

- Dismissing or copying a refused item from "Could not be saved".
- Export and import of notes, the AI notes, and drawings' own storage.
- The library's other writes to a note (another device of the same reader
  editing it at the same time is covered only as "the library already has a
  newer version").
- `useNotes.ts` itself does not run in the replay: `page()` in `replay.ts`
  makes its calls to `lib/outbox.ts` in the same order. A change to
  `useNotes.ts` must be mirrored there too.
- A pass covers the model under these bounds, not the whole app.

## Index

This skill is not yet listed in `.claude/skills/README.md`; add a row there
when the skill is merged (it sits outside this folder).
