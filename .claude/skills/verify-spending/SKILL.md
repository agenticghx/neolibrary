---
name: verify-spending
description: Formal check that paid AI never passes Neolibrary's spending caps and that "rewrite as you turn" asks again after every $1 — TLA+ models run with TLC, plus replays of each finding on the real code. Use before merging ANY change to lib/ai/generate.ts (generate, reserveSpend, spending, spendingWithJobs, estimateCost, capsFromEnv), lib/ai/model.ts (costUsd, estimateTokens, PRICES), lib/ai/claude.ts (billed errors), lib/library/rewritten-turn.ts, lib/player/session.ts (mustAsk, ASK_AGAIN_USD), app/(reader)/books/[id]/read/RewrittenPane.tsx, the cap check in lib/library/text-edition.ts, or the reserveSpend callers in lib/library/audio.ts, pictures.ts and voice-notes.ts; and when asked whether the AI can be paid past a cap, past $1 without asking, or twice.
---

# verify-spending

Written for: a Claude session (or a developer) that is changing the code below and has never
seen this check. Samuel, the owner, is a scientist, not a software engineer: report to him in
plain English, and define a term the first time you use it.

## What it checks

- **The rule.** Money paid for AI never passes the spending caps (per month, and per book, for
  each provider), even when several paid calls run at once; every reserved estimate is released
  or turned into a written cost, once; a call that was billed but failed still counts; and
  "rewrite as you turn" never pays for a paragraph whose price would take what was paid since
  the reader last said go ahead past $1, without asking "Keep rewriting?" first.
- **The harm if broken.** Samuel pays more than the limit he set (version 2's check 4, "Money").

Two models, written in TLA+ (a language for describing the steps of a system) and checked with
TLC (a model checker: it tries every order in which the steps can happen, within small bounds):

- `SpendCap.tla`: the server side, `generate()` and `reserveSpend` in `lib/ai/generate.ts`.
- `RewriteAsYouTurn.tla`: the reader's side, the loop in `RewrittenPane.tsx`.

A model checker suits this because the bugs that matter are about order: two requests both
passing the check before either records its cost, a page turn racing the loop. Tests try the
orders someone thought of; TLC tries all of them. The arithmetic parts (estimate against real
cost, the $1 threshold) are checked on the real functions by the replays in `replay/`.

## The one command

From the repository's root folder:

```sh
sh .claude/skills/verify-spending/check.sh
```

About 40 seconds on the laptop. It runs every config (`*.cfg`) through `scripts/tlc.sh` (TLC 1.7.4 and Java at
pinned versions; the first run downloads them) and compares each result with the `Expected:`
line at the top of that config; runs the replays in `replay/` with vitest; and says whether the
covered code changed since the sync commit. Its last line is the verdict:

- `verify-spending: all as expected (the 7 finding configs still break their rules: …)` (exit 0).
  "As expected" includes the known findings below: it does not mean spending is safe.
- `verify-spending: NOT as expected` (exit 1): a `WRONG` line names the config or replay.
- `verify-spending: as expected, but the covered code changed since the sync commit` (exit 3):
  read "When the covered code changed" below.

There are three kinds of config. `SpendCap.cfg` and `RewriteAsYouTurn.cfg` are **the main
checks**: the code as it is, under the assumptions below; every rule must hold
(`RewriteAsYouTurn-one-paragraph-over-a-dollar.cfg` is a second main check, with one paragraph
that alone costs $1.20). A
`*-finding-*.cfg` turns on one condition the code does not handle and **must break** the rule it
names: these are the known findings, kept so that a fix shows up. A `*-mutant-*.cfg` is a
**broken variant** of the code (switched by the `Mutant` constant) that must break its rule: it
proves the rule can fail at all. The `*-chart.cfg` configs are small versions for the charts.

## Covered code

Sync commit: `af958c2b7558f6268a51b24cce642f17a193262b` (the models were last confirmed to
describe the code at this commit; on main, as merged in #386).

| File | What the models cover |
|---|---|
| `lib/ai/generate.ts` | `generate` (findStored, copyShared, the `inflight` map, reserve, call, insert, failed_spend, release), `reserveSpend`, `lockSpend`, `assertRoom`, `spending`, `spendingWithJobs`, `heldByJobs`, `bookGroup`, `estimateCost` |
| `lib/ai/model.ts` | `costUsd`, `estimateTokens`, `PRICES`, `AiError.billed` |
| `lib/ai/claude.ts` | which failures carry `billed` |
| `lib/library/text-edition.ts` | `textEditionSummary` (its cap check) and `startTextEdition` (the job row that holds its estimate) |
| `lib/library/audio.ts`, `pictures.ts`, `voice-notes.ts` | `speak`, `makePicture`, the voice-note transcript: the same reserve, call, write, release steps as `generate` (not modelled one by one) |
| `lib/library/rewritten-turn.ts`, `lib/player/session.ts` | `goAhead`, `paidFor`, `mayPay`, `turnStore` (`get`, `change`, `begin`, `end`, `onEnd`), `ASK_AGAIN_USD` |
| `app/(reader)/books/[id]/read/RewrittenPane.tsx` | `makeMissing`, `start`, `stop`, `goOn`, the GET effect, `asking`, `placeRef`, `latest`, `self` |
| `app/(reader)/books/[id]/read/Reader.tsx` | only that the turn store lives here (`useState(turnStore)`) and that mode "original" renders no `RewrittenPane` (not in check.sh's list: it changes often for other reasons) |

The table in "Which code each step stands for" maps every action of the models to its line of
code.

## The rules

`SpendCap.tla`:

- `CapNeverPassed`: what the provider has charged never passes the month's cap or the book's cap.
- `ChargedMoneyAlwaysCounted`: money charged but not yet written to the database is still covered
  by the call's reservation (its hold), so the next check sees it.
- `ReservationReleasedOnce`: the holds equal the estimates of the calls holding one; none leaks,
  none is released twice.
- `EveryChargeRecordedOnce`: a finished call has written exactly what it was charged, once, billed
  failures included.
- `PaidOncePerAnswer`: two identical requests from one reader pay for one answer.

`RewriteAsYouTurn.tla`:

- `AsksBeforePayingPastOneDollar`: a paragraph is sent to be paid for only if what was paid since
  the last go-ahead ("Rewrite this page" or "Keep rewriting") plus its price stays within $1, or
  it is the first paid since a go-ahead whose price, on screen, included it.
- `NeverPastOneDollar`: the promise read literally: never more than $1 since the go-ahead (main
  config; it cannot hold with a paragraph that alone costs more, so the other main config leaves it out).
- `PastOneDollarOnlyAsShown`: past $1 since the go-ahead only by one paragraph, whose price was on
  screen when the reader said go ahead.
- `StopStopsPaying`: after Stop, no paragraph is sent to be paid for until the next go-ahead.
- `OneLoopAtATime`: one rewriting loop at a time, a closed pane's included.
- `PaysOnlyForThePageOnScreen`: a paragraph is sent only while its page is on screen in the open pane.
- `NeverStuck`: when nothing runs or is on its way, it is on, and the page on screen has paragraphs
  left, the pane asks "Keep rewriting?" (not "Rewriting each page as you turn to it." while nothing happens).

The ghost total counts a paragraph in the go-ahead it was sent under: one already on its way when
the reader says go ahead again was allowed by the go-ahead before. (The code is stricter: its
`sinceOk` counts it in the new one.)

## Which code each step stands for

What the models treat as one step is one step in the code: one SQL statement, or synchronous
code between two `await`s.

| Model action | Code |
|---|---|
| `LookForSavedAnswer` | `findStored`, then `copyShared` (the database reads) |
| `CheckSameRequestInFlight` | `inflight.get(key)`; if empty, `inflight.set` and the call queues for `lockSpend` (no `await` between) |
| `TakeLockAndReadSpending` | `reserveSpend`: `lockSpend` starts its turn and `read` (`spendingWithJobs`) runs its SELECTs. Other calls' inserts may land meanwhile; their holds stay until their release, which waits for the lock |
| `DecideAndHold` | `assertRoom(spent, held, …)` with `held` = this process's month hold and this `bookId`'s hold; `addHold` twice; the lock's turn ends. Refused: `SpendingCapReached`, and `generate`'s `finally` deletes the `inflight` entry |
| `TheAiAnswers` / `TheAiFailsButBills` / `TheAiFailsUnbilled` | `model.generate` returns / throws an `AiError` with `billed` / throws without `billed` |
| `SaveTheAnswer` | `db.insert(generations)` with `costUsd(result…)` |
| `SaveFails` | that insert throws something that is not an `AiError` (finding 4) |
| `RecordTheBilledFailure` | `db.insert(failedSpend)` in `catch`, before `finally` |
| `ReleaseTheHold` | `finally { await release() }` (its own `lockSpend` turn, no `await` inside), then `inflight.delete(key)` |
| `ServerRestarts`, `TheAiFinishesAnOrphanedCall` | a deploy or crash: `spendHolds`, `spendTails` and `inflight` are gone; the provider still finishes and charges (finding 5) |
| `TextEditionReads`, `TextEditionDecides` | `textEditionSummary`: `spendingWithJobs` outside `lockSpend`, then the `overLimit` test; `startTextEdition` inserts the job row (its hold, read by `heldByJobs`) |
| `TextEditionBilled`, `TextEditionStored`, `TextEditionEnds` | the batch is answered and charged; `storeBatch` writes the pages; `finishIfDone` ends the job |
| `YouTurnThePage` | Reader's `screen` changes; the pane renders, its effect sets `placeRef`, and the GET effect asks for the page |
| `YouAskForARewrite`, `YouPressKeepRewriting` | `start()`: `turns.change(goAhead)`, then `makeMissing(data.pieces, place, true)`. Keep rewriting is on screen when `asking` (on, not busy, and `!mayPay(sinceOk, the first priced paragraph's estimate, false)`) |
| `YouPressStop` | `stop()`: `turns.change(on: false)` |
| `YouSwitchToOriginal`, `YouOpenSideBySide` | Reader renders no pane in "original": the cleanup sets `self.current = false` and removes its `goOn`; a new pane registers its own `goOn` with `turns.onEnd` |
| `TheRewriteViewArrives` | the GET effect's `.then`: `setData`, `latest.current`, then `if (turns.get().on) makeMissing(b.pieces, at, false)` |
| `TheLoopDecides` | `makeMissing`'s `turns.begin()` (one loop, in any pane), then one turn of its `for`: the `break` test (`!self.current`, `placeRef.current !== at`, `!t.on`, `!mayPay(t.sinceOk, estimate, justAsked && i === 0)` with `t = turns.get()`), then `aiFetch` POST; or `finally`: `turns.end`, which calls the open pane's `goOn`. It runs at once after the step that started it (`NothingDeciding`): in the code it is synchronous with it |
| `ThePostAnswers` | the POST's answer: `turns.change(paidFor)` (at once, seen by every pane), `setData` |
| `ThePostFails` | `catch`: `turns.change(on: false)` |
| `TheScreenCatchesUp` | only `Mutant = "paneRef"` (the code before the fix of finding 9): React renders and runs `useEffect(() => { turnRef.current = props.turn; })` |

## What the main checks assume (the bounds)

`SpendCap.cfg`: three requests (requests 1 and 2 identical), one provider, one month, one book
group (a scan and its text edition share one per-book cap), each estimate 2 units, each charge
1 or 2 units, both caps 3 units (room for one call in flight, not two). And, each a finding when
dropped: a call never costs more than its estimate (finding 1); the calls are on one `bookId`
(finding 2); no text edition starts meanwhile (finding 3); saving a paid answer never fails
(finding 4); the server does not restart mid-call (finding 5); one copy of the server runs
(finding 6). The lock is modelled as "one at a time", not first-come-first-served: that allows
more orders than the code, never fewer.

`RewriteAsYouTurn.cfg`: two pages of two paragraphs, 40 cents each (so two fit in $1 and a third
does not), $1 = 100 cents; one reader in one tab; the pane may be closed and opened again mid-loop
(`PaneCanClose`, finding 10's condition). `RefLag = TRUE` (React renders late, finding 9's
condition) is set too, but the fixed code keeps no copy that could lag: the model reads `ref` only
under `Mutant = "paneRef"`, so the check of fix 9 is that broken variant breaking, and the test
"the next page's view arrives before React renders the new total" failing on the old pane.
The real pane copies `placeRef` in an effect after React renders; the model moves `place` with the
page at once. `PaysOnlyForThePageOnScreen` rests on that: in the milliseconds between a turn and that
render, a paragraph of the page just left can still be sent (as before the fix).
`RewriteAsYouTurn-one-paragraph-over-a-dollar.cfg`: the same, with the first paragraph of page 2
at $1.20. "Rewrite this page" is modelled only once the turned-to page's view has arrived. The
model takes a paragraph's cost to be its estimate (`piece.estimate`, the price the pane shows): the
loop decides on the estimate, so a paragraph that costs more than its estimate (finding 1) can
still take the total past $1 by that difference.

Left out (not modelled): calls on the reader's own key (`isOwnKeyProvider`: by design no cap);
the month boundary; rows brought back from a library file (`imported`); a second provider and
the voice and picture caps (same steps, other numbers); the Anthropic SDK's own retries
(`maxRetries: 2`: an attempt that is billed but returns no usage is not counted anywhere); a
voice note's cost, which comes from the duration the browser reports; `fresh: true` (always
pays, by design); two tabs or devices (each counts its own $1, by design: "each visit starts
off"). Not replayed on the real code (tied to it only by the `LOOK` line): the server's
text-edition, audio, picture and voice-note paths beyond the findings above.
`PaidOncePerAnswer` is checked only in its finding's config (7): the code does not keep it.

## Known findings

Each has a config that breaks its rule and a replay on the real code (`replay/findings.replay.ts`)
that passes while the bug is there. Steps are in the code's words.

1. **A call can cost more than its estimate** (`SpendCap-finding-cost-above-estimate`,
   `CapNeverPassed`). `estimateCost` counts `min(maxTokens, 2 × estimateTokens(input) + 1000)`
   output tokens; the call may use all of `maxTokens` (thinking included), and input tokens are
   guessed at 4 characters each. 1. reserve: `assertRoom` passes with the estimate. 2.
   `model.generate` answers with more output than estimated. 3. `insert generations` writes the
   real `costUsd`, above the estimate. 4. `spending()` is past the cap. A rewrite of a
   400-character paragraph on Sonnet 5.5 can cost about $0.028 more than its estimate. Text-edition
   pages are estimated at 1,000 output tokens and allowed 8,000.
2. **A scan and its text edition share one per-book cap, but not their holds**
   (`SpendCap-finding-book-group`). 1. a call on the scan reserves (hold on `bookKey(scan)`).
   2. a call on the edition: `spending(…, editionId).book` sums the whole `bookGroup`, but `held.book`
   is `holdOf(bookKey(editionId))` only. 3. it fits; both are paid past `AI_CAP_PER_BOOK_USD`.
3. **A text edition's start does not see calls in flight** (`SpendCap-finding-text-edition-start`).
   1. a paid call on the book holds its estimate. 2. `textEditionSummary` reads `spendingWithJobs`
   (the database only), outside `lockSpend`: `overLimit` is null. 3. `startTextEdition` inserts the
   job. 4. call plus job are past the cap. (Two starts on two books at once are not locked against
   each other either; not checked separately.)
4. **A paid answer that cannot be saved is never counted** (`SpendCap-finding-save-fails`).
   1. `model.generate` answers (charged). 2. `insert generations` throws (not an `AiError`).
   3. `catch` writes no `failed_spend`. 4. `finally` releases: the charge is in no table. The same
   shape, read but not replayed: `speak` (`storage.put` or the insert after `model.speak`),
   `makePicture` (`storage.put` after `generator.generate`), the voice note (`createAnnotation` or
   `storage.put` after `transcribe`).
5. **A restart mid-call loses the hold and the charge** (`SpendCap-finding-restart`). 1. a call
   reserves; the AI is working. 2. the server restarts: `spendHolds` is empty, and the call's
   insert never runs; the provider still charges. 3. the next call reads $0 and no hold: it fits.
6. **Two copies of the server do not see each other's holds** (`SpendCap-finding-two-servers`).
   `generate.ts` says so itself. Each copy's `assertRoom` sees only its own holds.
7. **Two identical requests can both pay** (`SpendCap-finding-paid-twice`, `PaidOncePerAnswer`).
   1. request 1 reserves; the AI is working. 2. request 2's `findStored` runs (nothing saved yet),
   but its answer reaches the code late (in production the database has a pool of 5 connections;
   the tests' PGlite answers in order, so ordinary tests never see this). 3. request 1 saves,
   releases, `inflight.delete`. 4. request 2: `inflight.get` is empty: it reserves and pays again.

## Broken variants (proof the rules can fail)

| Config | Change to the code it stands for | Rule that breaks |
|---|---|---|
| `SpendCap-mutant-no-lock` | `reserveSpend` without `lockSpend` | `CapNeverPassed` |
| `SpendCap-mutant-release-before-save` | `release()` before `insert generations` | `ChargedMoneyAlwaysCounted` |
| `SpendCap-mutant-release-only-on-success` | `release()` after the insert, not in `finally` | `ReservationReleasedOnce` |
| `SpendCap-mutant-no-failed-spend` | no `insert failedSpend` in `catch` | `EveryChargeRecordedOnce` |
| `RewriteAsYouTurn-mutant-ask-at-two-dollars` | `mayPay` allows $2 | `AsksBeforePayingPastOneDollar` |
| `RewriteAsYouTurn-mutant-ignore-stop` | the loop's `break` test without `!t.on` | `StopStopsPaying` |
| `RewriteAsYouTurn-mutant-no-running-guard` | `makeMissing` without `turns.begin()` | `OneLoopAtATime` |
| `RewriteAsYouTurn-mutant-ask-when-paid` | finding 8 unfixed: the loop and `asking` test `mustAskAgain(sinceOk)` (what was paid), not the next price | `NeverPastOneDollar` |
| `RewriteAsYouTurn-mutant-pane-ref` | finding 9 unfixed: each pane's own `turnRef`, copied by an effect after React renders; the loop counts on its own | `AsksBeforePayingPastOneDollar` |
| `RewriteAsYouTurn-mutant-running-per-pane` | finding 10 unfixed (part): `running` is a ref of the pane | `OneLoopAtATime` |
| `RewriteAsYouTurn-mutant-no-open-check` | finding 10 unfixed (part): the loop does not test `self.current` | `PaysOnlyForThePageOnScreen` |
| `RewriteAsYouTurn-mutant-no-wake` | `goOn` goes on only after its own pane's loop | `NeverStuck` |

Tried on the real code (2026-11-15, then undone). Moving `await release()` above the
`generations` insert made the replay "SaveTheAnswer before ReleaseTheHold" fail; with
`Mutant = "releaseBeforeSave"` in `SpendCap.cfg`, the main check broke `ChargedMoneyAlwaysCounted`
and `CapNeverPassed`. Each time `check.sh` exited 1. For the pane (2026-11-15, after the fixes of
findings 8-10), each removed alone made `RewrittenPane.test.ts` fail: `mayPay` back to "ask once
$1 is paid" (3 tests), the loop without `!self.current` (2), `turns.begin()` always true (2),
`goOn` only after its own pane's loop (1), no exception for the first paragraph after a press (1);
the old pane with only fix 8 failed the finding 9 test (`expected [ 'b1' ] to deeply equal []`).

## Reading a result

Read every result with the /pstack:statechart skill. Give it the spec, the config, and the view
module for that spec from this folder (`spend-cap-view.mjs` or `rewrite-as-you-turn-view.mjs`):
it tells a broken rule as its shortest path, one step per line, in a reader's words, and draws the
chart when the rules hold. The charts kept here, made from the `*-chart.cfg` configs:

- `rewrite-as-you-turn-flow.mmd`: the reader's flow. It does not draw steps that keep the reader
  in the same state (turning a page or a page arriving while nothing changes, Stop while a
  paragraph is being written) or the stop at the last page.
- `concurrent-paid-calls.mmd`: two different paid requests at once, one region each. It does not
  draw the two look-ups that keep a request "Asked" or the final "all finished" step.

## Real bug or modelling error?

When a config's result differs from its `Expected:` line:

1. Read the path with /pstack:statechart and map each step to its code with the table above.
2. Replay it on the real code, one test step per model step: add a test to
   `replay/findings.replay.ts` (server; `replay/fakes.ts` has a provider whose calls wait for the
   test, `until`, `firstReadArrivesLate` for a late database answer, `onInsert` to act just before
   an insert) or `app/(reader)/books/[id]/read/RewrittenPane.test.ts` (the real `RewrittenPane`,
   rendered by React in Node, every request answered by hand; it runs under `npm test` too).
3. If the replay shows the bug, it is real: report it to Samuel as numbered steps in the code's
   words, add its finding config, and do not weaken a rule or the model to make it pass. Do not
   change product code unless asked.
4. If the code makes a step of the path impossible (two steps that are one synchronous block in the
   code, a button that is not on screen then), the model is wrong: fix the action (merge the steps,
   or add the guard the code has), and say so in the commit. Until a replay shows otherwise, treat
   the model as wrong, not the code.

When a replay in `replay/conformance.replay.ts`, or a test in `RewrittenPane.test.ts`, fails, the
code no longer takes a step the models assume; each test names its action or finding.

## When the covered code changed

`check.sh` prints `LOOK` with the files changed since the sync commit.

1. Read `git diff <sync commit> -- <the files>`.
2. For each change, find the action it touches in the step table. Change that action (or add one)
   so that the model takes the steps the code now takes. If the change is one of the "Broken
   variants" below, set `Mutant` in the main config to that variant to see which rule breaks, and
   do not commit that setting. Keep the rules as they are, unless Samuel
   changed the promise itself (then change the rule, or a number such as `AskAt`, and say so).
3. Run `check.sh`. A main config that now breaks a rule is a finding: replay it, report it.
4. Update the replays to the new code; a finding's replay that now fails means the bug is gone.
   For a fixed finding: make the main config include its condition (for example
   `SaveCanFail = TRUE` in `SpendCap.cfg`), delete the finding's config and replay, and list it
   under "Fixed" below.
5. If labels or the flow changed, draw the charts again with /pstack:statechart from the
   `*-chart.cfg` configs and replace the two `.mmd` files.
6. Only when `check.sh` ends `all as expected` against the new code, set the sync commit above to
   the commit you checked (`git rev-parse HEAD`).

## Fixed

8. **The total could pass $1 by one paragraph** (was `RewriteAsYouTurn-finding-paid-past-one-dollar`).
   The loop tested `mustAskAgain(sinceOk)` (what was paid) before each paragraph, so 60c + 60c =
   $1.20 was paid before it asked. Now `mayPay(sinceOk, estimate, justAsked)` asks before a
   paragraph whose estimated price would take the total past $1; the first paragraph after the
   reader's own press goes ahead at the price shown (so one that alone costs more than $1 can be
   written). `NeverPastOneDollar` is in the main config; `-mutant-ask-when-paid` is the old code.
9. **A stale total could start a loop** (was `-finding-stale-turn`). The pane kept its own
   `turnRef`, copied from the reader's state by an effect after React rendered, so a page answered
   in between started a loop from the old total. Now the total is in one `turnStore` kept by
   Reader.tsx and changed at once (`turns.change`); the pane reads it with `useSyncExternalStore`.
   There is no copy left to lag, so the main config's `RefLag = TRUE` checks nothing here: the
   evidence is `-mutant-pane-ref` (the old code) breaking `AsksBeforePayingPastOneDollar`, and the
   pane test of finding 9 failing on the old pane with only fix 8 applied.
10. **Closing the pane mid-loop left a loop Stop could not reach** (was `-finding-pane-closed-stop`
    and `-two-loops`). Now Stop changes the one store every loop reads; the store holds the "one
    loop" flag (`begin`/`end`), so a reopened pane waits for the closed pane's paragraph; the
    closed pane's loop stops before its next paragraph (`self.current`); and when it ends, the
    open pane goes on with its page (`goOn`, via `turns.onEnd`). `PaneCanClose = TRUE` in the main
    config; `-mutant-running-per-pane`, `-no-open-check` and `-no-wake` remove one part each.

## Files

- `SpendCap.tla`, `RewriteAsYouTurn.tla`: the models. `*.cfg`: their configs (main, finding,
  mutant, chart).
- `spend-cap-view.mjs`, `rewrite-as-you-turn-view.mjs`: the words for /pstack:statechart.
- `rewrite-as-you-turn-flow.mmd`, `concurrent-paid-calls.mmd`: the charts.
- `check.sh`: the one command.
- `replay/`: `conformance.replay.ts` (the code takes the models' steps), `findings.replay.ts`
  (each server finding on the real code), `fakes.ts`, `vitest.config.mts`. Their names
  end in `.replay.ts`, so `npm test` does not run them; `check.sh` does. Its vitest config also
  runs `app/(reader)/books/[id]/read/RewrittenPane.test.ts` (the pane, findings 8-10 fixed), which
  `npm test` runs as well. `tsc` skips folders whose
  names start with a dot, so `npm run check` does not type-check them either: after editing one,
  run `check.sh` (vitest reports a wrong import or name when it runs them).
