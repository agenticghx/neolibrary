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
  "rewrite as you turn" never starts paying for another paragraph once $1 has been paid since
  the reader last said go ahead, without asking "Keep rewriting?".
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

About 20 seconds on the laptop. It runs every config (`*.cfg`) through `scripts/tlc.sh` (TLC 1.7.4 and Java at
pinned versions; the first run downloads them) and compares each result with the `Expected:`
line at the top of that config; runs the replays in `replay/` with vitest; and says whether the
covered code changed since the sync commit. Its last line is the verdict:

- `verify-spending: all as expected` (exit 0).
- `verify-spending: NOT as expected` (exit 1): a `WRONG` line names the config or replay.
- `verify-spending: as expected, but the covered code changed since the sync commit` (exit 3):
  read "When the covered code changed" below.

There are three kinds of config. `SpendCap.cfg` and `RewriteAsYouTurn.cfg` are **the main
checks**: the code as it is, under the assumptions below; every rule must hold. A
`*-finding-*.cfg` turns on one condition the code does not handle and **must break** the rule it
names: these are the known findings, kept so that a fix shows up. A `*-mutant-*.cfg` is a
**broken variant** of the code (switched by the `Mutant` constant) that must break its rule: it
proves the rule can fail at all. The `*-chart.cfg` configs are small versions for the charts.

## Covered code

Sync commit: `741d19076272362e45bc80a857cc2f3bfcef53a5` (the models were last confirmed to
describe the code at this commit).

| File | What the models cover |
|---|---|
| `lib/ai/generate.ts` | `generate` (findStored, copyShared, the `inflight` map, reserve, call, insert, failed_spend, release), `reserveSpend`, `lockSpend`, `assertRoom`, `spending`, `spendingWithJobs`, `heldByJobs`, `bookGroup`, `estimateCost` |
| `lib/ai/model.ts` | `costUsd`, `estimateTokens`, `PRICES`, `AiError.billed` |
| `lib/ai/claude.ts` | which failures carry `billed` |
| `lib/library/text-edition.ts` | `textEditionSummary` (its cap check) and `startTextEdition` (the job row that holds its estimate) |
| `lib/library/audio.ts`, `pictures.ts`, `voice-notes.ts` | `speak`, `makePicture`, the voice-note transcript: the same reserve, call, write, release steps as `generate` (not modelled one by one) |
| `lib/library/rewritten-turn.ts`, `lib/player/session.ts` | `goAhead`, `paidFor`, `mustAskAgain`, `mustAsk`, `ASK_AGAIN_USD` |
| `app/(reader)/books/[id]/read/RewrittenPane.tsx` | `makeMissing`, `start`, `stop`, the GET effect, `turnRef`, `placeRef`, `running`, `latest` |
| `app/(reader)/books/[id]/read/Reader.tsx` | only that the turn state lives here and that mode "original" renders no `RewrittenPane` (not in check.sh's list: it changes often for other reasons) |

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

- `AsksBeforePayingPastOneDollar`: no paragraph is sent to be paid for once $1 has been paid since
  the last go-ahead ("Rewrite this page" or "Keep rewriting").
- `AtMostOneParagraphPastOneDollar`: so the total since the go-ahead stays under $1 plus one paragraph.
- `NeverPastOneDollar`: the promise read literally (never more than $1). The code does not keep
  it (finding 8): it is checked only in that finding's config.
- `StopStopsPaying`: after Stop, no paragraph is sent to be paid for until the next go-ahead.
- `OneLoopAtATime`: one rewriting loop at a time.

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
| `YouTurnThePage` | Reader's `screen` changes; the pane renders, its effects set `placeRef` and `turnRef`, and the GET effect asks for the page |
| `YouAskForARewrite`, `YouPressKeepRewriting` | `start()`: `goAhead` on `turnRef` and the turn state, then `makeMissing(data.pieces, place, 0)` |
| `YouPressStop` | `stop()`: `turnRef.current.on = false` and `setTurn` |
| `YouSwitchToOriginal`, `YouOpenSideBySide` | Reader renders no pane in "original"; a new pane starts with `useRef(props.turn)`, `running = false` |
| `TheRewriteViewArrives` | the GET effect's `.then`: `setData`, `latest.current`, then `t = turnRef.current; if (t.on && !mustAskAgain(t.sinceOk)) makeMissing(…, t.sinceOk)` |
| `TheLoopDecides` | one turn of `makeMissing`'s `for`: the `break` test, then `aiFetch` POST; or `finally` and the "go on with `latest.current`" test. It runs at once after the step that started it (`NothingDeciding`): in the code it is synchronous with it |
| `ThePostAnswers` | the POST's answer: `sinceOk += cost`, `setTurn(paidFor)`, `setData` |
| `ThePostFails` | `catch`: `turnRef.current.on = false`, `setTurn(on: false)` |
| `TheScreenCatchesUp` | React renders and runs `useEffect(() => { turnRef.current = props.turn; })` (finding 9) |

## What the main checks assume (the bounds)

`SpendCap.cfg`: three requests (requests 1 and 2 identical), one provider, one month, one book
group (a scan and its text edition share one per-book cap), each estimate 2 units, each charge
1 or 2 units, both caps 3 units (room for one call in flight, not two). And, each a finding when
dropped: a call never costs more than its estimate (finding 1); the calls are on one `bookId`
(finding 2); no text edition starts meanwhile (finding 3); saving a paid answer never fails
(finding 4); the server does not restart mid-call (finding 5); one copy of the server runs
(finding 6). The lock is modelled as "one at a time", not first-come-first-served: that allows
more orders than the code, never fewer.

`RewriteAsYouTurn.cfg`: two pages of two paragraphs, 60 cents each, $1 = 100 cents; one reader
in one tab. And, each a finding when dropped: React copies the new total into `turnRef` before
the next server answer is handled (finding 9); the pane is not closed while it rewrites
(finding 10). "Rewrite this page" is modelled only once the turned-to page's view has arrived.

Left out (not modelled): calls on the reader's own key (`isOwnKeyProvider`: by design no cap);
the month boundary; rows brought back from a library file (`imported`); a second provider and
the voice and picture caps (same steps, other numbers); the Anthropic SDK's own retries
(`maxRetries: 2`: an attempt that is billed but returns no usage is not counted anywhere); a
voice note's cost, which comes from the duration the browser reports; `fresh: true` (always
pays, by design); two tabs or devices (each counts its own $1, by design: "each visit starts
off").

## Known findings

Each has a config that breaks its rule and a replay on the real code (`replay/findings.replay.ts`,
`replay/client.replay.ts`) that passes while the bug is there. Steps are in the code's words.

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
8. **By design: the total can pass $1 by one paragraph** (`RewriteAsYouTurn-finding-paid-past-one-dollar`,
   `NeverPastOneDollar`). `makeMissing` tests `mustAskAgain(sinceOk)` before each paragraph, so the
   last one paid can take the total from under $1 to over it.
9. **A stale total starts a loop** (`RewriteAsYouTurn-finding-stale-turn`,
   `AsksBeforePayingPastOneDollar`). 1. you ask for a rewrite; paragraph a1 is sent. 2. you turn
   the page. 3. a1 is paid: `setTurn(paidFor)`; the loop breaks (`placeRef.current !== at`). 4. the
   turned-to page's GET is answered before React renders: the handler reads the old
   `turnRef.current.sinceOk` and calls `makeMissing` with it. 5. the new loop counts from the old
   total and sends a paragraph when $1 or more has been paid. Needs the two answers within one
   render (milliseconds apart): rare.
10. **Closing the pane mid-loop leaves a loop Stop cannot reach** (`RewriteAsYouTurn-finding-pane-closed-stop`
    and `-two-loops`). 1. you ask for a rewrite; a1 is sent. 2. you switch to Original: the pane
    unmounts, its loop keeps its `placeRef`, `turnRef` and `running`. 3. you open Side by side: a
    new pane, `running = false`; its page arrives and its own loop starts. 4. you press Stop: only
    the new pane's `turnRef` is off. 5. a1 is paid; the old loop sends a2. It pays at most the rest
    of its page.

## Broken variants (proof the rules can fail)

| Config | Change to the code it stands for | Rule that breaks |
|---|---|---|
| `SpendCap-mutant-no-lock` | `reserveSpend` without `lockSpend` | `CapNeverPassed` |
| `SpendCap-mutant-release-before-save` | `release()` before `insert generations` | `ChargedMoneyAlwaysCounted` |
| `SpendCap-mutant-release-only-on-success` | `release()` after the insert, not in `finally` | `ReservationReleasedOnce` |
| `SpendCap-mutant-no-failed-spend` | no `insert failedSpend` in `catch` | `EveryChargeRecordedOnce` |
| `RewriteAsYouTurn-mutant-ask-at-two-dollars` (and `-total`) | `mustAskAgain` asks at $2 | `AsksBeforePayingPastOneDollar` (`AtMostOneParagraphPastOneDollar`) |
| `RewriteAsYouTurn-mutant-ignore-stop` | the loop's `break` test without `!turnRef.current.on` | `StopStopsPaying` |
| `RewriteAsYouTurn-mutant-no-running-guard` | `makeMissing` without `if (running.current) return` | `OneLoopAtATime` |

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
   an insert) or `replay/client.replay.ts` (the real `RewrittenPane`, rendered by React in Node,
   every request answered by hand).
3. If the replay shows the bug, it is real: report it to Samuel as numbered steps in the code's
   words, add its finding config, and do not weaken a rule or the model to make it pass. Do not
   change product code unless asked.
4. If the code makes a step of the path impossible (two steps that are one synchronous block in the
   code, a button that is not on screen then), the model is wrong: fix the action (merge the steps,
   or add the guard the code has), and say so in the commit. Until a replay shows otherwise, treat
   the model as wrong, not the code.

When a replay in `replay/conformance.replay.ts` fails, the code no longer takes a step the models
assume; each test names its action.

## When the covered code changed

`check.sh` prints `LOOK` with the files changed since the sync commit.

1. Read `git diff <sync commit> -- <the files>`.
2. For each change, find the action it touches in the step table. Change that action (or add one)
   so that the model takes the steps the code now takes. Keep the rules as they are, unless Samuel
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

None yet.

## Files

- `SpendCap.tla`, `RewriteAsYouTurn.tla`: the models. `*.cfg`: their configs (main, finding,
  mutant, chart).
- `spend-cap-view.mjs`, `rewrite-as-you-turn-view.mjs`: the words for /pstack:statechart.
- `rewrite-as-you-turn-flow.mmd`, `concurrent-paid-calls.mmd`: the charts.
- `check.sh`: the one command.
- `replay/`: `conformance.replay.ts` (the code takes the models' steps), `findings.replay.ts` and
  `client.replay.ts` (each finding on the real code), `fakes.ts`, `vitest.config.mts`. Their names
  end in `.replay.ts`, so `npm test` does not run them; `check.sh` does. `tsc` skips folders whose
  names start with a dot, so `npm run check` does not type-check them either: after editing one,
  run `check.sh` (vitest reports a wrong import or name when it runs them).
