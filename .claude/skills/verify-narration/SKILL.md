---
name: verify-narration
description: Formal check (a TLA+ model run by the TLC model checker) that whole-book narration never pays the voice (ElevenLabs) more than the owner chose. Use before and after any change to lib/library/narration.ts, to speakPassage, speak, storedTrack or cacheKeyOf in lib/library/audio.ts, to reserveSpend, assertRoom, spending or the spend holds in lib/ai/generate.ts, to app/api/books/[id]/narration/route.ts or app/api/books/[id]/audio/route.ts, to app/(app)/import/WholeBookNarration.tsx, to getSpeechModel in lib/speech/index.ts, to how the server starts or stops (package.json "start", instrumentation.ts and its SIGTERM listener, the after() in the narration route, a custom server, signal handling, Railway's draining or overlap settings), or when someone asks whether narration can pay twice, run twice, ignore Stop or pass a spending limit.
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
not, on the live site as it is set up today: a paragraph can be paid for twice (PaidOnce), when the site restarts
(a deploy) while that paragraph is being paid for (finding 1). Railway ends the old server at once after telling it
to stop, so the paid audio is lost and Continue pays again. The code to prevent this is in (M44): the run stops after
the paragraph being made and the server waits for it. It works only when Railway gives the server time to finish
(`RAILWAY_DEPLOYMENT_DRAINING_SECONDS`, set to 60 seconds on 2026-11-16, see finding 1); `NarrationGrace.cfg` shows that PaidOnce then holds, and
`NarrationFindings.cfg` keeps the break in view until then. Findings 2 (a failed save) and 3 (two paragraphs with
the same words) were fixed in M44; finding 4 (the old server running on beside the new one) is open and needs a
setting or a migration. The voice's bill passing a limit (WithinLimits) was fixed in M44: a paragraph's hold (its
reserved estimate) is a row in the database, which a restart, a failed save or a second server no longer loses.

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

Sync commit: `7d1213b1` (on main: #393, the narration fixes, as merged). At that commit the model below describes these files. Move the sync commit
forward only after you have confirmed that the model describes the code at the new commit (see "When the code
changes").

| File | What the model takes from it |
|---|---|
| `lib/library/narration.ts` | `startNarration` (248-282), `run` (284-311), `stopNarration` (318-326), `stopNarrationsForShutdown` (337-344), the runs list on `globalThis` (122-124), `narrationSummary`'s cost to make (the cost box) |
| `lib/library/audio.ts` | `speakPassage` and its in-flight list, keyed by owner and text (241, 278-298), `speak` (300-352), the kept paid audio (`kept`, `keep`, 263-264, 395-404), `saveTrack` and its retries (`SAVE_RETRY_MS`, 267, 355-393), `storedTrack`, `cacheKeyOf` (saved means: same owner, voice, model and text, in any book) |
| `lib/ai/generate.ts` | `reserveSpend` and the hold it returns (`release`, `billed`), `withSpendLock` (the Postgres advisory lock), `assertRoom`, `spending`, `heldByCalls` (the hold rows in `failed_spend`, kind `spend-hold`) |
| `app/api/books/[id]/narration/route.ts` | POST: only the owner (60), then `startNarration` (66) and `after(() => done)` (69); DELETE: `stopNarration` (84) |
| `app/api/books/[id]/audio/route.ts` | POST: the Listen bar calls `speakPassage` (65) with the same voice model as the run |
| `instrumentation.ts` | the SIGTERM listener (9): `stopNarrationsOnSigterm` (narration.ts 347-353), which calls `stopNarrationsForShutdown` |
| `lib/speech/index.ts` | `getSpeechModel` (15): the owner's Listen bar and the run get the same voice model |
| `app/(app)/import/WholeBookNarration.tsx` | the cost box: Create sends `confirm: agreed` (183). The model trusts only the server's check of it. |
| Next.js `next start` (`node_modules/next/dist/server/lib/start-server.js`, `cleanup`; `next-server.js`, `close`) | on SIGTERM it stops taking requests, waits for open ones, then for its after() work (the run), then exits |
| Railway (no file: the service's settings) | after a deploy is live, the old one gets SIGTERM, then SIGKILL after `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` (default 0 seconds); `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` keeps it running before SIGTERM (default not stated) |

Files in this folder:

| File | What it is |
|---|---|
| `Narration.tla` | the model: steps, guards, rules, and the books used as bounds |
| `Narration.cfg` | the main check: every rule that holds today (expect exit 0) |
| `NarrationNoKnownCauses.cfg` | the second check: all eight rules with the open findings' cause (restarts) switched off; repeated text and a failed save stay in (expect exit 0) |
| `NarrationGrace.cfg` | all eight rules, with a restart when the host gives the old server time after SIGTERM (finding 1's fix; expect exit 0) |
| `NarrationFindings.cfg` | the one rule the code breaks on Railway as set up today, finding 1 (expect exit 12) |
| `NarrationOverlap.cfg` | every rule, when the old server runs on after a restart, finding 4 (expect exit 12) |
| `NarrationFlow.cfg` | small bounds for the chart |
| `narration-view.mjs` | labels for states and steps in Samuel's words, for the statechart skill |
| `narration-flow.mmd` | the chart drawn from `NarrationFlow.cfg` |
| `findings-replay.test.ts.txt` | vitest replays of the open findings (1 and 4) against the real code, with the fake voice |

## Run it

Run these from the repository's root folder (they need `mise`; the first run downloads Java and TLC). The three
checks must exit 0:

```sh
sh scripts/tlc.sh .claude/skills/verify-narration/Narration.tla
sh scripts/tlc.sh .claude/skills/verify-narration/Narration.tla .claude/skills/verify-narration/NarrationNoKnownCauses.cfg
sh scripts/tlc.sh .claude/skills/verify-narration/Narration.tla .claude/skills/verify-narration/NarrationGrace.cfg
```

Each prints `Model checking completed. No error has been found.` (221,188, 46,194 and 55,424 distinct states; a few
seconds each). Exit 12 means a rule broke; the line `Error: Invariant <Rule> is violated.` names it. Exit 11 is a
deadlock. Exit 150 or more means the model itself is wrong (a TLA+ error, not a finding).

The two configs below keep the open findings in view. They must break the rules in the table and no others:

```sh
sh scripts/tlc.sh .claude/skills/verify-narration/Narration.tla .claude/skills/verify-narration/NarrationFindings.cfg
sh scripts/tlc.sh .claude/skills/verify-narration/Narration.tla .claude/skills/verify-narration/NarrationOverlap.cfg
```

TLC stops at the first broken rule, so read every result with the `/pstack:statechart` skill: give it
`Narration.tla`, the config you ran, and `narration-view.mjs` as the view. It gives each broken rule's shortest path
in Samuel's words, and draws a chart when the states fit. After the first broken rule it explores only part of the
states and can list some rules under "Rules not checked". Settle each such rule with plain TLC on a scratch copy of
the config that lists only the rules not yet broken.

Two constants describe the host. `HostGrace = FALSE` is Railway as set up today: SIGKILL right after SIGTERM, so a
restart loses every paid call on its way. `HostGrace = TRUE` is Railway with `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`
long enough for one paragraph. `AskWhileDraining` says whether you press Create or Listen in the seconds while the
old server finishes (it then takes no requests; the new one does).

| Config | Exit today | Rules that break today | Rules that hold |
|---|---|---|---|
| `Narration.cfg` | 0 | none | OnlyTheOwnerStarts, OnlyAfterYouConfirm, OneRunAtATime, StopPaysAtMostOneMore, SavedNeverPaidAgain, NoMoreThanYouConfirmed, WithinLimits |
| `NarrationNoKnownCauses.cfg` | 0 | none | all eight (with repeated text and a failed save, since M44) |
| `NarrationGrace.cfg` | 0 | none | all eight (finding 1's fix, with the host's grace and nothing pressed meanwhile) |
| `NarrationFindings.cfg` | 12 | PaidOnce (finding 1, with Railway's 0 seconds) | (only PaidOnce is listed) |
| `NarrationOverlap.cfg` | 12 | OneRunAtATime, StopPaysAtMostOneMore, NoMoreThanYouConfirmed, PaidOnce (finding 4) | OnlyTheOwnerStarts, OnlyAfterYouConfirm, SavedNeverPaidAgain, WithinLimits |
| `NarrationFlow.cfg` (the chart only) | 0 | none | all eight |

Also settled on 2026-11-15 (scratch copies, not committed): `Narration.cfg` with PaidOnce added breaks only PaidOnce;
`NarrationGrace.cfg` with `AskWhileDraining = TRUE` breaks OneRunAtATime, StopPaysAtMostOneMore,
NoMoreThanYouConfirmed and PaidOnce (a second run started on the new server while the old one finishes its
paragraph: finding 4's window, a few seconds long); `NarrationOverlap.cfg` with `HostGrace = TRUE` breaks the same
four (the old server gets no signal during the overlap). Each row was settled rule by rule (one scratch config per
rule) on 2026-11-15, M44.

A change is safe for these rules when the three checks exit 0 and the other configs break no rule beyond the
table. `NarrationNoKnownCauses.cfg` matters because a known-broken rule can break again for a new reason, and the
findings configs would not show it: it switches off restarts, so every rule must hold there.
`NarrationFlow.cfg` is too small to show findings 1 to 4; it is for the chart.

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
| `YouPressCreate(who, b, confirm)` | you tick the cost box and press Create | narration/route.ts 60 (owner only), narration.ts 255-281: after the awaits for the book (255) and the voices (258), the look at the runs list and the add are one step (260-279) |
| `RunReadsSaved(k)` | the run reads which paragraphs are saved | narration.ts 291-292 (`paragraphsOf`, `savedKeys`), then the loop up to the first wait (see `MoveOn`) |
| `MoveOn` (part of the step that ends a paragraph) | | narration.ts 293-298: the Stop check (294), skipping saved paragraphs (297), and entering `speakPassage` up to its first wait, `passageFor` (audio.ts 286) |
| `RunJoins(k)`, `ListenJoins` | (not drawn) | audio.ts 288-292: after `passageFor`, the in-flight look by owner and text, and the add, with no wait between |
| `RunLooksUp(k)`, `ListenLooksUp` | the paragraph is not saved yet / is saved already / audio paid for earlier is saved now | audio.ts 311-322: the voices, then the kept audio of these words (315-320, no wait; saved under the paragraph asking now), else `storedTrack` |
| `RunPays(k)`, `ListenPays` | a paragraph is paid for / a limit is reached | audio.ts 323-338: `reserveSpend` (under `withSpendLock`, one Postgres advisory lock for every server: read what is spent and held, check, insert the hold row), then `model.speak` sends the request; the voice bills it then |
| `RunSaves(k)`, `ListenSaves` | the paragraph is saved | audio.ts 343-346: `saveTrack` (344: `storage.put` and the `audio_tracks` insert, tried again after 0.5 s and 2 s), `hold.release()` (345, the hold row is deleted), then narration.ts 299 and on to the next paragraph |
| `RunSaveFails(k)`, `ListenSaveFails` | saving the paid paragraph fails | audio.ts 347-351: every try failed; `keep` keeps the audio and its hold in this server's memory; narration.ts 303-310 ends the run |
| `YouPressStop(b)` | you press Stop | narration/route.ts 84, narration.ts 319-322 (sets `stopRequested` on the run in this server's list) |
| `YouPressListen(i)` | you press Listen on a paragraph | audio/route.ts 65, audio.ts 286 (`passageFor`, then `ListenJoins`) |
| `TheSiteRestarts` | the site restarts | a deploy: the new server takes every request. Without `OldServerLingers` the old one gets SIGTERM at once (see `TheOldServerGetsSigterm`) |
| `TheOldServerGetsSigterm` | the old server is told to stop | `HostGrace = FALSE` (Railway today): SIGKILL at once, memory gone (runs, in-flight list, kept audio, the spending lock's queue), holds kept in the database and counted from then on. `HostGrace = TRUE`: instrumentation.ts 9 (narration.ts 337-353) sets `stopRequested` on every run; `next start` stops taking requests |
| `TheOldServerExits` | the old server stops | `next start`'s cleanup: after open requests and the after() work (the runs) are done, `process.exit` |
| `TheOldServerIsKilled` | the old server is ended mid-paragraph | only with the guard `stop at SIGTERM` off: the run outlasts the draining time and SIGKILL ends it |

The guards, with the rule each one protects (switch one off with `Broken = {"stop check"}` in a scratch copy of a
config; every committed config has `Broken = {}`). Each row was tried on 2026-11-15 with the config named:

| Guard | Code | Rule that breaks without it |
|---|---|---|
| `owner only` | narration/route.ts 60 | OnlyTheOwnerStarts (NoKnownCauses) |
| `confirm` | narration.ts 256 | OnlyAfterYouConfirm (NoKnownCauses) |
| `one run per reader` | narration.ts 263-264 | OneRunAtATime (NoKnownCauses) |
| `same run carries on` | narration.ts 262 | none alone (264 still refuses); with `one run per reader` off too, OneRunAtATime |
| `stop check` | narration.ts 294 | StopPaysAtMostOneMore (NoKnownCauses) |
| `stored check` | audio.ts 321-322 | SavedNeverPaidAgain (NoKnownCauses) |
| `skip saved` | narration.ts 297 | none alone (`storedTrack` catches it); with `stored check` off too, NoMoreThanYouConfirmed |
| `limits` | audio.ts 323 | WithinLimits (NoKnownCauses) |
| `share in-flight` | audio.ts 289-290 | PaidOnce (NoKnownCauses: the Listen bar on the run's own paragraph) |
| `in-flight by text` | audio.ts 288: the key is the owner and `cacheKeyOf` (M44, finding 3) | PaidOnce (NoKnownCauses: the Listen bar on a repeat of the run's paragraph) |
| `keep paid audio` | audio.ts 315-320 and 349 (M44, finding 2) | PaidOnce (NoKnownCauses: a failed save, then Continue) |
| `holds in database` | generate.ts `reserveSpend` (M44): the hold is a row under the advisory lock | WithinLimits (Narration.cfg: the holds of before M44, in one server's memory) |
| `stop at SIGTERM` | instrumentation.ts 9, narration.ts 337-353 (M44, finding 1) | PaidOnce (NarrationGrace) |
| `wait for the run` | narration/route.ts 69, `after(() => done)` (M44, finding 1) | PaidOnce (NarrationGrace) |

## Known findings

Each was replayed against the real code with the fake voice. Findings 1 and 4 still replay
(`findings-replay.test.ts.txt`: both pass, so both are real). Findings 2 and 3 were fixed in M44; their replays
failed on the fixed code and are now real tests (`lib/library/narration.test.ts`, "no paragraph's words are paid for
twice"), which fail on the code before the fix. The part of findings 1, 2 and 4 that passed a limit (WithinLimits)
was fixed in M44 too.

1. **A restart while a paragraph is being paid for.** (PaidOnce; partly fixed in M44: the code is in, and since
   2026-11-16 the setting is too, at 60 seconds)
   1. You press Create; `run` comes to paragraph 1; `speak` finds no saved track, `reserveSpend` holds its estimate,
      `model.speak` sends the request (billed).
   2. The site restarts (a deploy). Railway sends SIGTERM and, with `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` unset,
      SIGKILL at once (its documented default: 0 seconds). No audio and no `audio_tracks` row; the hold row stays,
      so paragraph 1's cost stays counted against the limits.
   3. You press Continue (or the Listen bar asks for paragraph 1). `savedKeys` and `storedTrack` find nothing;
      `model.speak` pays for paragraph 1 again.

   The same happens to a Listen bar request on its way (the model assumed before M44 that `next start` lets it
   finish: true only when the host waits after SIGTERM).

   **The fix (M44).** The narration route hands each run to `after()`; on SIGTERM `next start` stops taking
   requests, waits for open ones and then for its after() work, then exits. A SIGTERM listener
   (instrumentation.ts) stops every run before its next paragraph, so the one being paid for is saved first. Checked
   on a real `next start` (Next 16.4.1, a scratch app whose "paragraph" takes 3 s, built with Turbopack and again
   with webpack): with after(), the process exited 1,985 ms (webpack: 1,989 ms) after SIGTERM, once the paragraph in
   progress was saved; without it, 13 ms (25 ms) after, with the paragraph lost. Test: narration.test.ts "finding 1" (Stop at SIGTERM, then
   Continue on a new server pays for nothing twice); route.test.ts checks the after() hand-off.

   **The setting (2026-11-16).** `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=60` is set on the web service in production
   (Samuel: "go with your recommendation"; read back with `railway variable list --service web --environment
   production --kv`). Not yet watched on a real deploy during a run. A paragraph and its save that take more than
   60 s are still lost as below.

   **What is left.** Without that setting, nothing changes: each deploy during a run costs the paragraph
   being paid for, once more (one paragraph's price, e.g. $0.30 for 1,000 characters at $0.30 per 1,000), plus any
   Listen bar paragraph on its way (one per reader on an EPUB, up to two on a PDF, which looks one page ahead). All
   of it is counted against the limits. **Setting that closes it:** `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` longer
   than the paragraph being made and its save. No value is sure to be long enough: one voice request may take up to
   240 s per try and is tried three times (the ElevenLabs SDK's default timeout; lib/speech/elevenlabs.ts sets
   `maxRetries: 2`), and the save up to three tries 2.5 s apart. How long a paragraph usually takes was not
   measured (no paid voice is called); the Listen bar's comment says a PDF page takes about half a minute
   (lib/player/session.ts). A server with nothing going on still exits at once. With it set, a paragraph can still
   be paid twice if you press Continue or Listen for those words in the seconds while the old server finishes it
   (`AskWhileDraining`, finding 4's window): the Import page asks every second while a run goes on and offers
   Continue as soon as the new server answers, so this is easy to do if you are watching. It can also happen if one
   paragraph outlasts the draining time.

   This finding assumes that the voice bills a request whose answer never arrives. ElevenLabs was not asked or
   tested (Samuel's rule: no paid voice); finding 2 does not need the assumption.
2. **Saving a paid paragraph fails** (`storage.put` or the insert throws). Fixed in M44 while the server lives.
   Before: the run ended with "Stopped by an error", the audio was lost, and Continue paid again. Now: the save is
   tried again after 0.5 s and 2 s; if every try fails, the paid audio is kept in the server's memory with its
   hold (counted against the limits meanwhile), and the next ask for those words (Continue, or the Listen bar)
   saves it without paying. A retried insert that had in fact been written is found by its id. At most 20 are kept;
   the oldest then becomes a `failed_spend` row of its cost (tested in lib/ai/spend-holds.test.ts). **What is left:**
   a restart before the next ask loses the kept audio (its hold stays counted): one paragraph paid twice, per paragraph
   kept, which needs a save failing three times and then a deploy.
3. **Two paragraphs with the same text.** Fixed in M44. The in-flight list was keyed by paragraph (owner, book,
   section, voice, model) while "saved" is by text (`cacheKeyOf`), so the Listen bar on paragraph 3, whose words
   repeat paragraph 1's, paid again while the run was paying for paragraph 1. Now the key is the owner and
   `cacheKeyOf`, taken after `passageFor` with no wait between the look and the add: the Listen bar joins the run's
   call. Nothing is left within one server; across two servers, see finding 4.
4. **If the old server runs on after a restart** (OneRunAtATime, StopPaysAtMostOneMore, NoMoreThanYouConfirmed,
   PaidOnce; WithinLimits fixed in M44). Open. The runs list and the in-flight list live in one server's memory.
   Railway keeps the old deployment running for an overlap time after the new one is live
   (`RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`; the docs say "a slight overlap" and state no default), with no signal, so
   the SIGTERM fix does nothing in that time. Continue on the new server then starts a second run, both pay for the
   same paragraphs, and Stop on the new server cannot reach the old run. Since M44 both see each other's holds
   (rows in the database, under one advisory lock), so together they stop at the limits. Replay (two copies of the
   modules in one process): two runs at once, paragraph 1 billed twice, 3 paragraphs paid after Stop.

   **What is left, and its size:** for as long as the overlap lasts, the old run pays on (about one paragraph per
   few seconds) and Continue or Listen on the new server can pay for the same words again; after the overlap, the
   SIGTERM fix stops the old run after one paragraph (if the draining time is set). **Setting that may shrink it:**
   `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0`, so SIGTERM comes as soon as the new server is live; then only finding 1's
   few-second window is left. Not confirmed: that Railway accepts 0, and what the default is (it may be 0 already). **What would close it** (a migration, not built; a proposal for Samuel):
   - a table `narration_runs` (owner, book, voice, started, heartbeat, stop requested, ended, why), with a unique
     index on the owner for runs not ended. `startNarration` adds a row (a second one for the owner is refused, or
     joined if it is the same book and voice; a row whose heartbeat is minutes old belonged to a server that died,
     and is closed); `run` writes its heartbeat and reads "stop requested" before each paragraph; Stop sets it. This
     makes OneRunAtATime and StopPaysAtMostOneMore hold across servers. Reverse step: drop the table.
   - a column `failed_spend.call_key` (the `cacheKeyOf` of the paid call a hold is for) with an index on owner and
     key. Under the spending lock, `speak` would first look for a hold of the same owner and words younger than a
     few minutes, and wait for that track instead of paying (PaidOnce across servers). A hold older than that is a
     dead server's; its audio is gone, and paying again is finding 1's residual. Reverse step: drop the column.
   Without a migration, a Postgres advisory lock per owner held for the whole run would make OneRunAtATime hold
   across servers (not Stop). A transaction-scoped one cannot work on PGlite (tests and local use have one
   connection: a transaction held for hours blocks every other query). A session-scoped one on a connection
   reserved for the run (postgres.js `reserve()`, outside drizzle) was not tried; on PGlite it would always succeed,
   so only `npm run test:postgres` could test it.

## Real bug or modeling error?

Every counterexample is a list of model steps. Before you call it a bug, replay it against the real code, one step
per model step, in a vitest with the fake voice (`lib/speech/fake`; never ElevenLabs or any paid voice). Start from
`findings-replay.test.ts.txt` (its header says how to run it): its `Voice` counts each request when it is sent and
can hold requests or leave one unanswered, `held()` holds the run at each paragraph before it is paid for (to press
Stop there), and `newServer()` simulates a restart with no time after SIGTERM (Railway today; call
`stopNarrationsForShutdown()` first for a restart with time). Its first tests pass today and protect rules that
hold: "the Stop rule" fails if the Stop check goes, and "one run at a time" (two tabs press Create at once, for one
book and for two) fails if a wait comes between looking at the runs list and adding to it.

- The bug happens in the replay: it is a finding. Report it with the steps in the code's words. Do not weaken the
  rule or the model to make the check pass, and do not change product code unless asked.
- The bug does not happen: assume the model is wrong until you show it is not. Look for a step that the model
  splits but the code runs without a wait (or the other way round), a guard the model lacks, or a value the model
  reads at the wrong moment. Fix the model, rerun, replay again.
- One vitest process shares the in-flight list, the kept audio and the runs list. `forgetNarrationsForTests()`
  clears only the runs list and `forgetPaidAudioForTests()` the other two, so a restart replay without `newServer()`
  wrongly shows "paid once". The holds are rows in the test
  database: a "restart" keeps them, as a real one does.

## When the code changes

1. `git diff <sync commit> -- lib/library/narration.ts lib/library/audio.ts lib/ai/generate.ts lib/speech/index.ts 'app/api/books/[id]/narration/route.ts' 'app/api/books/[id]/audio/route.ts' 'app/(app)/import/WholeBookNarration.tsx' instrumentation.ts package.json`
   (and any new server start or signal handling, a Next.js upgrade that changes `next start`'s shutdown, or a
   change to Railway's draining or overlap settings). Nothing changed: the model still describes the code.
2. For each change, find the step or guard in the tables above. Ask: does it add or remove a wait (`await` on the
   database, the voice, storage or a lock), a check, or a place where state is kept (memory or database)?
3. Change `Narration.tla` to match: a removed check is a guard to delete (or a step that no longer tests it), a new
   wait splits a step in two, a new kind of saved state is a new variable. Keep each comment's line numbers right.
   Never change a rule to make it pass; a new promise is a new rule.
4. Run the five commands above and read each with `/pstack:statechart`. A new broken rule: replay it (above).
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
  paragraph), one voice, the owner's Listen bar on Lamps (one request at a time), one restart, one failed save (after
  its retries), a limit of 2 paragraphs per book and 2 per month. Every paragraph costs the same. A pass covers these
  bounds.
- Bounds (`NarrationNoKnownCauses.cfg`): the same, with no restart. (`NarrationGrace.cfg`): the same, with the host's
  grace and no failed save; a failed save followed by a restart is finding 2's residual.
- One server at a time, unless `OldServerLingers` or (with `HostGrace`) while the old one finishes. The narration
  route and the audio route share one copy of `audio.ts` and `generate.ts` in a server, so the run and the Listen bar
  share the in-flight list and the kept audio (the spend holds are rows in the database, shared by every server since
  M44). This was checked in a production build (Turbopack): both routes load the same chunk through one runtime. It
  came from an earlier build, not from the sync commit; rebuild and look again if the build setup changes. The
  SIGTERM listener in instrumentation.ts reaches the runs through `globalThis`, whichever copy of narration.ts it loads.
- A request sent to the voice is billed even if the server dies before the answer comes.
- On a restart without `HostGrace`, nothing finishes: open requests (the Listen bar's) die too. With `HostGrace`,
  `next start` lets open requests and its after() work finish; the model assumes the draining time is long enough
  for the paragraph being made.
- The cost box's figure is taken when you press Create, not when the page last asked; saved paragraphs only grow in
  between, so this is the stricter reading.
- A kept paragraph's hold is its estimate, which is its real cost: both voices bill the text's length
  (lib/speech/elevenlabs.ts, fake.ts).

## Left out

- A voice call that fails without billing (it ends the run with an error and costs nothing).
- Prices and character counts (every paragraph costs one unit), the month changing, several voices, other readers'
  spending, PDF books (narration is EPUB only), the Listen bar's look-ahead (two requests at once, PDF only),
  restoring a library file (it deletes tracks).
- The retry delays (a failed save in the model is one that failed every try) and the limit of 20 kept paragraphs.
- What the Import page shows (buttons, polling): the server's checks are what the rules rely on.
- The gap between pressing Stop and the server setting `stopRequested` (the DELETE first reads the book): the model's
  Stop is the moment the flag is set.

## The chart

`narration-flow.mmd` shows one book of two paragraphs, a monthly limit of one paragraph and one restart with
Railway's 0 seconds (`NarrationFlow.cfg`; 89 states, every rule holds: the hold left by the restart fills the month's
limit, so paragraph 1 is not paid again in these bounds). Redrawn on 2026-11-15 (M44) with the statechart script. The
view hides "the site restarts" from states where no run is going on (it changes nothing a reader sees), the in-flight
look after `passageFor` (`RunJoins`), and steps that stay in one state (for example the payment made while
"Stopping"). These bounds never reach "Done", the book's limit, an error, the Listen bar or a second server; the other
configs check those.
