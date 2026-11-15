---
name: verify-narration
description: Formal check (a TLA+ model run by the TLC model checker) that whole-book narration never pays the voice (ElevenLabs) more than the owner chose. Use before and after any change to lib/library/narration.ts, to speakPassage, speak, storedTrack or cacheKeyOf in lib/library/audio.ts, to reserveSpend, assertRoom, spending or the spend holds in lib/ai/generate.ts, to app/api/books/[id]/narration/route.ts or app/api/books/[id]/audio/route.ts, to app/(app)/import/WholeBookNarration.tsx, to getSpeechModel in lib/speech/index.ts, to how the server starts or stops (package.json "start", a custom server, signal handling), or when someone asks whether narration can pay twice, run twice, ignore Stop or pass a spending limit.
---

# Verify whole-book narration

Written for: a Claude session that is changing the code below and reads this cold. Samuel (the owner, a scientist)
reads the plain-English parts and the chart; say results to him in those words.

## What is checked

**The promise.** A whole-book narration run starts only when the library's owner ticks the cost box and presses
Create; one runs at a time; it never pays for a paragraph that is already saved; Stop ends it after at most the one
paragraph being made; it pays for no more than the cost the box stated; no paragraph is paid for twice; and what the
voice bills never passes the spending limits.

**What passes today.** Seven of these promises hold within the bounds below (`Narration.cfg` exits 0). One does
not: a paragraph can be paid for twice (PaidOnce). The code breaks it (findings 1-3, replayed against the real
code); `NarrationFindings.cfg` keeps it failing until it is fixed. The voice's bill passing a limit (WithinLimits)
was fixed in M44: a paragraph's hold (its reserved estimate) is now a row in the database, which a restart, a failed
save or a second server no longer loses.

**The harm if broken.** Samuel pays ElevenLabs for more narration than he chose: a paragraph twice, past his limit,
or (in the worst case) a whole book.

**Words used here.**
- *TLA+* is a language for describing a system as states and the steps between them. The description here is a
  *model*: a small copy of the code's logic, not the code itself.
- *TLC* is the program that checks a TLA+ model. It tries every order in which the steps can happen, within the
  bounds in a config (`.cfg`) file, and stops at the first state that breaks a rule.
- A *rule* (TLA+ calls it an *invariant*) is a sentence that must be true in every state. When one breaks, TLC prints
  the *counterexample*: the shortest list of steps that leads there.
- A *guard* is one line of code that protects a rule (for example the Stop check). The model names each one, so you
  can switch it off and watch its rule break.

## Covered code

Sync commit: `a5e153d4` (M44, branch m44-fix-spending; holdCost in generate.ts does not touch speech holds; set it to the merge commit on `main` after the merge). At that commit the model below describes these files. Move the sync commit
forward only after you have confirmed that the model describes the code at the new commit (see "When the code
changes").

| File | What the model takes from it |
|---|---|
| `lib/library/narration.ts` | `startNarration` (244-277), `run` (279-306), `stopNarration` (313-321), the runs list on `globalThis` (118-120), `narrationSummary`'s cost to make (the cost box) |
| `lib/library/audio.ts` | `speakPassage` and its in-flight list (236-257), `speak` (259-305), `storedTrack`, `cacheKeyOf` (saved means: same owner, voice, model and text, in any book) |
| `lib/ai/generate.ts` | `reserveSpend` and the hold it returns (`release`, `billed`), `withSpendLock` (the Postgres advisory lock), `assertRoom`, `spending`, `heldByCalls` (the hold rows in `failed_spend`, kind `spend-hold`) |
| `app/api/books/[id]/narration/route.ts` | POST: only the owner (59), then `startNarration` (65); DELETE: `stopNarration` (80) |
| `app/api/books/[id]/audio/route.ts` | POST: the Listen bar calls `speakPassage` (65) with the same voice model as the run |
| `lib/speech/index.ts` | `getSpeechModel` (31): the owner's Listen bar and the run get the same voice model |
| `app/(app)/import/WholeBookNarration.tsx` | the cost box: Create sends `confirm: agreed` (183). The model trusts only the server's check of it. |
| Next.js `next start` (`node_modules/next/dist/server/lib/start-server.js`, `cleanup`) | on a restart it waits for open requests, then exits; a background run is not a request |

Files in this folder:

| File | What it is |
|---|---|
| `Narration.tla` | the model: steps, guards, rules, and the books used as bounds |
| `Narration.cfg` | the main check: every rule that holds today (expect exit 0) |
| `NarrationNoKnownCauses.cfg` | the second check: all eight rules with the known findings' causes switched off (expect exit 0) |
| `NarrationFindings.cfg` | the one rule the code breaks today, findings 1-3 (expect exit 12) |
| `NarrationOverlap.cfg` | every rule, when the old server runs on after a restart, finding 4 (expect exit 12) |
| `NarrationFlow.cfg` | small bounds for the chart |
| `narration-view.mjs` | labels for states and steps in Samuel's words, for the statechart skill |
| `narration-flow.mmd` | the chart drawn from `NarrationFlow.cfg` |
| `findings-replay.test.ts.txt` | vitest replays of the findings against the real code, with the fake voice |

## Run it

Run these from the repository's root folder (they need `mise`; the first run downloads Java and TLC). The two
checks must exit 0:

```sh
sh scripts/tlc.sh .claude/skills/verify-narration/Narration.tla
sh scripts/tlc.sh .claude/skills/verify-narration/Narration.tla .claude/skills/verify-narration/NarrationNoKnownCauses.cfg
```

The first prints `Model checking completed. No error has been found.` (76,606 distinct states, about 4 seconds).
The second prints the same line (11,623 distinct states). Exit 12 means a rule broke; the line
`Error: Invariant <Rule> is violated.` names it. Exit 11 is a deadlock. Exit 150 or more means the model itself is
wrong (a TLA+ error, not a finding).

The two configs below keep the known findings in view. They must break the rules in the table and no others:

```sh
sh scripts/tlc.sh .claude/skills/verify-narration/Narration.tla .claude/skills/verify-narration/NarrationFindings.cfg
sh scripts/tlc.sh .claude/skills/verify-narration/Narration.tla .claude/skills/verify-narration/NarrationOverlap.cfg
```

TLC stops at the first broken rule, so read every result with the `/pstack:statechart` skill: give it
`Narration.tla`, the config you ran, and `narration-view.mjs` as the view. It gives each broken rule's shortest path
in Samuel's words, and draws a chart when the states fit. After the first broken rule it explores only part of the
states and can list some rules under "Rules not checked". Settle each such rule with plain TLC on a scratch copy of
the config that lists only the rules not yet broken.

| Config | Exit today | Rules that break today | Rules that hold |
|---|---|---|---|
| `Narration.cfg` | 0 | none | OnlyTheOwnerStarts, OnlyAfterYouConfirm, OneRunAtATime, StopPaysAtMostOneMore, SavedNeverPaidAgain, NoMoreThanYouConfirmed, WithinLimits |
| `NarrationNoKnownCauses.cfg` | 0 | none | all eight |
| `NarrationFindings.cfg` | 12 | PaidOnce (findings 1, 2, 3) | WithinLimits (since M44) |
| `NarrationOverlap.cfg` | 12 | OneRunAtATime, StopPaysAtMostOneMore, NoMoreThanYouConfirmed, PaidOnce (finding 4) | OnlyTheOwnerStarts, OnlyAfterYouConfirm, SavedNeverPaidAgain, WithinLimits (since M44) |
| `NarrationFlow.cfg` (the chart only) | 0 | none (since M44: the hold left by the restart fills the month's limit of one paragraph, so paragraph 1 is not paid again in these bounds) | all eight |

Each row was settled rule by rule (one scratch config per rule) on 2026-11-15, M44.

A change is safe for these rules when both checks exit 0 and the other configs break no rule beyond the table.
`NarrationNoKnownCauses.cfg` matters because a known-broken rule can break again for a new reason, and the two
findings configs would not show it: it switches off restarts, failed saves and repeated text, so every rule must
hold there. `NarrationFlow.cfg` is too small to show findings 2 to 4; it is for the chart.

To check a change before it is merged (nobody has to be asked): copy this whole folder to a scratch folder and edit
the copy. `scripts/tlc.sh` runs TLC in the model's folder and reads the config by its file name only, so the model
and its configs must sit in one folder. Change the copy only as "When the code changes" says. If the change breaks a
rule, report it with the counterexample and the replay; do not change the committed model, the rules or the sync
commit for it.

## The rules

| Rule (in `Narration.tla`) | In plain words | Harm if broken |
|---|---|---|
| OnlyTheOwnerStarts | Only the library's owner can start a run. | an invited reader spends the owner's ElevenLabs money |
| OnlyAfterYouConfirm | A run starts only after the cost box was ticked. | a whole book is paid for without the owner agreeing to the cost |
| OneRunAtATime | At most one run goes on at a time. | a second run pays on unseen, with no Stop on the page |
| StopPaysAtMostOneMore | After you press Stop, at most one more paragraph is paid for: the one being made. | Stop does not stop the spending |
| SavedNeverPaidAgain | A paragraph already saved in the voice when the run (or the Listen bar) comes to it is never paid for again. | the page's promise "saved paragraphs are never paid for twice" is false |
| NoMoreThanYouConfirmed | After you press Create, narration pays for no more paragraphs than the cost box stated. | the owner pays more than the cost he agreed to |
| PaidOnce | No paragraph's text is paid for twice in the voice. | money paid for audio that is thrown away |
| WithinLimits | What the voice bills never passes the book's limit or the month's limit (VOICE_CAP_PER_BOOK_USD, VOICE_CAP_PER_MONTH_USD). | the hard spending cap (ground rule 8) is not hard |

## The model's steps and the code

One step of the model is one stretch of code with no `await` that waits on the database, the voice or another
request: Node.js runs such a stretch without anything else in between. Where the code has such a wait, the model
has two steps, and anything (Stop, the Listen bar, a restart) may happen between them.

| Step in `Narration.tla` | Label in the chart | Code (lines at the sync commit) |
|---|---|---|
| `YouPressCreate(who, b, confirm)` | you tick the cost box and press Create | narration/route.ts 59 (owner only), narration.ts 251-275: after the awaits for the book (251) and the voices (254), the look at the runs list and the add are one step (255-275) |
| `RunReadsSaved(k)` | the run reads which paragraphs are saved | narration.ts 286-287 (`paragraphsOf`, `savedKeys`), then the loop up to the first wait (see `MoveOn`) |
| `MoveOn` (part of the step that ends a paragraph) | | narration.ts 288-293: the Stop check (289), skipping saved paragraphs (292), and entering `speakPassage` up to `inflight.set` (audio.ts 247-251) happen with no wait |
| `RunLooksUp(k)`, `ListenLooksUp` | the paragraph is not saved yet / is saved already | audio.ts 267-270 (`passageFor`, `storedTrack`) |
| `RunPays(k)`, `ListenPays` | a paragraph is paid for / a limit is reached | audio.ts `speak`: `reserveSpend` (under `withSpendLock`, one Postgres advisory lock for every server: read what is spent and held, check, insert the hold row), then `model.speak` sends the request; the voice bills it then |
| `RunSaves(k)`, `ListenSaves` | the paragraph is saved | audio.ts `speak`: answer, `storage.put`, the `audio_tracks` insert, `hold.release()` (the hold row is deleted), then narration.ts 294 and on to the next paragraph |
| `RunSaveFails(k)`, `ListenSaveFails` | saving the paid paragraph fails | audio.ts `speak` throws after `hold.billed()` turns the hold row into the paid cost (`failed_spend`); narration.ts 298-305 ends the run |
| `YouPressStop(b)` | you press Stop | narration/route.ts 80, narration.ts 314-317 (sets `stopRequested` on the run in this server's list) |
| `YouPressListen(i)` | you press Listen on a paragraph | audio/route.ts 65, audio.ts 247-251 (joins a call already going on for the same paragraph) |
| `TheSiteRestarts` | the site restarts | a deploy: the server's memory (runs list, in-flight list, the spending lock's queue) is gone; the database is kept, and with it the hold of a paragraph being paid for (counted in `spent` from then on, at its estimate) |
| `TheOldServerStops` | the old server stops | only with `OldServerLingers = TRUE` |

The guards, with the rule each one protects (switch one off with `Broken = {"stop check"}` in a scratch copy of a
config; every committed config has `Broken = {}`):

| Guard | Code | Rule that breaks without it |
|---|---|---|
| `owner only` | narration/route.ts 59 | OnlyTheOwnerStarts |
| `confirm` | narration.ts 252 | OnlyAfterYouConfirm |
| `one run per reader` | narration.ts 259-260 | OneRunAtATime |
| `same run carries on` | narration.ts 258 | none alone (260 still refuses); with `one run per reader` off too, OneRunAtATime |
| `stop check` | narration.ts 289 | StopPaysAtMostOneMore |
| `stored check` | audio.ts 269-270 | SavedNeverPaidAgain |
| `skip saved` | narration.ts 292 | none alone (`storedTrack` catches it); with `stored check` off too, NoMoreThanYouConfirmed |
| `limits` | audio.ts 272 | WithinLimits |
| `share in-flight` | audio.ts 248-251 | PaidOnce (the Listen bar on the run's own paragraph) |
| `holds in database` | generate.ts `reserveSpend` (M44): the hold is a row under the advisory lock; `speak` calls `hold.billed` when saving fails | WithinLimits (switched off: the holds of before M44, in one server's memory; tried on 2026-11-15 with `Narration.cfg`: exit 12, a failed save then two Listen payments) |

## Known findings

Each was replayed against the real code with the fake voice (`findings-replay.test.ts.txt`; every replay passes,
so every finding is real). The part of findings 1, 2 and 4 that passed a limit (WithinLimits) was fixed in M44; what
is left is below.

1. **A restart while a paragraph is being paid for.** (PaidOnce; WithinLimits fixed in M44)
   1. You press Create; `run` comes to paragraph 1; `speak` finds no saved track, `reserveSpend` holds its estimate,
      `model.speak` sends the request (billed).
   2. The site restarts (a deploy). `next start` waits for open requests, not for the run, and exits. No audio and
      no `audio_tracks` row; since M44 the hold row stays, so paragraph 1's estimate stays counted against the limits.
   3. You press Continue (or the Listen bar asks for paragraph 1). `savedKeys` and `storedTrack` find nothing; if the
      limits leave room beside the kept hold, `model.speak` pays for paragraph 1 again.

   This finding assumes that the voice bills a request whose answer never arrives. ElevenLabs was not asked or
   tested (Samuel's rule: no paid voice); finding 2 does not need the assumption.

   Replay: 4-paragraph book, paragraph 1 billed twice (the second payment is counted beside the kept hold). Before
   M44, with a book limit of $0.0525, $0.0630 was billed; that is now a real test
   (`lib/library/narration.test.ts`, "a restart while a paragraph is being paid for"), which stops at the limit.
   Deploys are automatic after every merge to `main`, and a run spends most of its time inside the paid call, so
   each deploy during a run very likely costs one paragraph, never past a limit.
2. **Saving a paid paragraph fails** (`storage.put` or the insert throws). The same as finding 1 without a restart:
   the run ends with "Stopped by an error", no audio, and Continue pays again. Since M44 the paid paragraph is
   counted (`hold.billed` writes it to `failed_spend`). Replay: paragraph 1 billed twice, both counted.
3. **Two paragraphs with the same text.** (PaidOnce) The in-flight list is keyed by paragraph (owner, book,
   section, voice, model: audio.ts 247) but "saved" is by text (`cacheKeyOf`).
   1. The run is paying for paragraph 1 (`model.speak` sent).
   2. You press Listen on paragraph 3, whose text is the same (or on the same paragraph in another copy of the book):
      a different in-flight key, and `storedTrack` finds nothing yet, so it pays for the same text again.

   Replay: the text billed twice. The same paragraph is safe: the Listen bar joins the run's call (replayed: paid
   once).
4. **If the old server runs on after a restart** (OneRunAtATime, StopPaysAtMostOneMore, NoMoreThanYouConfirmed,
   PaidOnce; WithinLimits fixed in M44). The runs list and the in-flight list live in one server's memory. If a
   deploy lets the old server finish its work while the new one already takes requests, then Continue starts a second
   run, both pay for the same paragraphs, and Stop on the new server cannot reach the old run. Since M44 both see
   each other's holds (rows in the database, under one advisory lock), so together they stop at the limits. Replay (two copies of the modules in one process): two runs at once, paragraph 1 billed
   twice, 3 paragraphs paid after Stop. Whether the host keeps the old server running, and for how long, is not in
   the repository: this finding holds only if it does.

## Real bug or modeling error?

Every counterexample is a list of model steps. Before you call it a bug, replay it against the real code, one step
per model step, in a vitest with the fake voice (`lib/speech/fake`; never ElevenLabs or any paid voice). Start from
`findings-replay.test.ts.txt` (its header says how to run it): its `Voice` counts each request when it is sent and
can hold requests or leave one unanswered, `held()` holds the run at each paragraph before it is paid for (to press
Stop there), and `newServer()` simulates a restart. Its first tests pass today and protect rules that hold: "the
Stop rule" fails if the Stop check goes, and "one run at a time" (two tabs press Create at once, for one book and
for two) fails if a wait comes between looking at the runs list and adding to it.

- The bug happens in the replay: it is a finding. Report it with the steps in the code's words. Do not weaken the
  rule or the model to make the check pass, and do not change product code unless asked.
- The bug does not happen: assume the model is wrong until you show it is not. Look for a step that the model
  splits but the code runs without a wait (or the other way round), a guard the model lacks, or a value the model
  reads at the wrong moment. Fix the model, rerun, replay again.
- One vitest process shares the in-flight list and the runs list. `forgetNarrationsForTests()` clears only the runs
  list, so a restart replay without `newServer()` wrongly shows "paid once". The holds are rows in the test
  database: a "restart" keeps them, as a real one does.

## When the code changes

1. `git diff <sync commit> -- lib/library/narration.ts lib/library/audio.ts lib/ai/generate.ts lib/speech/index.ts 'app/api/books/[id]/narration/route.ts' 'app/api/books/[id]/audio/route.ts' 'app/(app)/import/WholeBookNarration.tsx' package.json`
   (and any new server start or signal handling). Nothing changed: the model still describes the code.
2. For each change, find the step or guard in the tables above. Ask: does it add or remove a wait (`await` on the
   database, the voice, storage or a lock), a check, or a place where state is kept (memory or database)?
3. Change `Narration.tla` to match: a removed check is a guard to delete (or a step that no longer tests it), a new
   wait splits a step in two, a new kind of saved state is a new variable. Keep each comment's line numbers right.
   Never change a rule to make it pass; a new promise is a new rule.
4. Run the four commands above and read each with `/pstack:statechart`. A new broken rule: replay it (above).
5. If the change was meant to fix a finding: the replay's test for it should now fail; turn it into a real test in
   `lib/library/narration.test.ts`, move the rule to `Narration.cfg`, and update the table and the findings.
6. Redraw the chart if a step's label or the flow changed: `/pstack:statechart` on `Narration.tla` with
   `NarrationFlow.cfg` and `narration-view.mjs`; save the chart it draws here as `narration-flow.mmd`.
7. Update the line numbers in this file and move the sync commit to the commit you checked. Do this only for a
   change that breaks no rule beyond the table; a change that breaks one is a finding (see "Run it").

To see a rule fail on purpose (to check that the check can still fail), put a guard in `Broken` in a scratch copy
of `NarrationNoKnownCauses.cfg`: TLC exits 12 for every guard that the guards table says breaks a rule alone. It
names the first rule it reaches, which can differ from the table when several break.

## Proof that the check catches a bug

On 2026-11-15 the Stop check (narration.ts 289, `if (job.stopRequested) return end(...)`) was deleted in a scratch
change to the real code. A session that had not seen this work followed this file: it mapped the deletion to the
`stop check` guard, switched it off in a scratch copy of the model, and `Narration.cfg` exited 12 with
`Error: Invariant StopPaysAtMostOneMore is violated.` (Create, Stop, then two paragraphs paid). The replay's
"Stop rule" test failed on the changed code (`Stop sent: [ 'Lamp 1', 'Lamp 2', 'Lamp 3' ] ended: finished`) and
passed once the change was undone (`Stop sent: [ 'Lamp 1' ] ended: stopped`).

## Bounds and assumptions

- Bounds (`Narration.cfg`): two books ("Lamps", three paragraphs, the third with the first's text; "Boats", one
  paragraph), one voice, the owner's Listen bar on Lamps (one request at a time), one restart, one failed save, a
  limit of 2 paragraphs per book and 2 per month. Every paragraph costs the same. A pass covers these bounds.
- Bounds (`NarrationNoKnownCauses.cfg`): the same, but Lamps has three different texts, and there is no restart and
  no failed save.
- One server at a time, unless `OldServerLingers`. The narration route and the audio route share one copy of
  `audio.ts` and `generate.ts` in a server, so the run and the Listen bar share the in-flight list (the spend holds
  are rows in the database, shared by every server since M44). This was checked in a production build (Turbopack): both routes load the same chunk through one runtime.
  It came from an earlier build, not from the sync commit; rebuild and look again if the build setup changes.
- A request sent to the voice is billed even if the server dies before the answer comes.
- On a restart, open requests (the Listen bar's) finish first (Next.js closes the server, which waits for them); the
  background run does not get that wait.
- The cost box's figure is taken when you press Create, not when the page last asked; saved paragraphs only grow in
  between, so this is the stricter reading.

## Left out

- A voice call that fails without billing (it ends the run with an error and costs nothing).
- Prices and character counts (every paragraph costs one unit), the month changing, several voices, other readers'
  spending, PDF books (narration is EPUB only), the Listen bar's look-ahead (two requests at once), restoring a
  library file (it deletes tracks).
- What the Import page shows (buttons, polling): the server's checks are what the rules rely on.
- The gap between pressing Stop and the server setting `stopRequested` (the DELETE first reads the book): the model's
  Stop is the moment the flag is set.

## The chart

`narration-flow.mmd` shows one book of two paragraphs, a monthly limit of one paragraph and one restart
(`NarrationFlow.cfg`). It was drawn before M44: its states marked *mayBreak* (the restart, then Continue, then
paragraph 1 paid again) no longer break a rule in these bounds, because the kept hold fills the month's limit (75
states, every rule holds). Redraw it with `/pstack:statechart` when that skill is at hand. The view hides "the site restarts" from
states where no run is going on (it changes nothing a reader sees) and does not draw steps that stay in one state
(for example the payment made while "Stopping"). These bounds never reach "Done", the book's limit, an error, the
Listen bar or a second server; the other configs check those.
