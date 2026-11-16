---
name: verify-spending
description: Formal check that paid AI never passes Neolibrary's spending caps and that "rewrite as you turn" asks again after every $1 — TLA+ models run with TLC, plus replays of each finding on the real code. Use before merging ANY change to lib/ai/generate.ts (generate, reserveSpend, spending, spendingWithJobs, estimateCost, holdCost, capsFromEnv), lib/ai/model.ts (costUsd, estimateTokens, PRICES), lib/ai/claude.ts (billed errors), lib/library/rewritten-turn.ts, lib/player/session.ts (mustAsk, ASK_AGAIN_USD), app/(reader)/books/[id]/read/RewrittenPane.tsx, the cap check in lib/library/text-edition.ts, or the reserveSpend callers in lib/library/audio.ts, pictures.ts and voice-notes.ts; and when asked whether the AI can be paid past a cap, past $1 without asking, or twice.
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

- `verify-spending: all as expected (the N finding configs still break their rules: …)` (exit 0).
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

Sync commit: `7d1213b16d7e9a1a1cfba6ca99a94c7f26b587a9` (the models were last confirmed to
describe the code at this commit, on main: #393 as merged. After a squash-merge, set it to the merge commit on main: the hash changes, and check.sh stops with WRONG when it cannot find the commit).

| File | What the models cover |
|---|---|
| `lib/ai/generate.ts` | `generate` (findStored, copyShared, the `inflight` map, reserve, call, insert, `hold.billed`, `hold.release`), `reserveSpend` and the hold it returns, `withSpendLock` (the Postgres advisory lock, behind `lockSpend`'s in-process queue), `assertRoom`, `spending`, `heldByCalls` (hold rows: `failed_spend`, kind `spend-hold`), `heldByJobs`, `heldNow`, `spendingWithJobs`, `bookGroup`, `estimateCost` (the likely cost, shown), `holdCost` and `HOLD_OVERHEAD_TOKENS` (the most a call can cost, held) |
| `lib/ai/model.ts` | `costUsd`, `estimateTokens`, `PRICES`, `AiError.billed` |
| `lib/ai/claude.ts` | which failures carry `billed`; which usage it reports (every attempt in `usage.iterations`, as `earlier`: finding 1 (a)) |
| `lib/library/text-edition.ts` | `textEditionSummary` (its cap check, shown) and `startTextEdition` (the check again and the job row that holds its estimate, both under `withSpendLock`) |
| `lib/library/audio.ts`, `pictures.ts`, `voice-notes.ts` | `speak`, `makePicture`, the voice-note transcript: the same reserve, call, write, `billed`/`release` steps as `generate` (not modelled one by one; finding 4's fix tested in `lib/ai/spend-holds.test.ts` for `speak` and `makePicture`). Since M44's narration fixes (verify-narration findings 2 and 3), `speak` keeps paid audio whose save fails in the server's memory with its hold unsettled, and the next request for those words saves it and calls `release()`; `billed()` comes only when a kept one is dropped (more than 20 kept). The hold is the estimate, which for speech is the real cost. |
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
- `ReservationReleasedOnce`: a hold row exists only between a call's reserve and its settling; a
  finished call has none, unless it was left behind on purpose (its server stopped mid-call, or the
  database failed while its cost was being written), and then it stays counted at its hold.
- `EveryChargeRecordedOnce`: a finished call has written exactly what it was charged, once, billed
  failures and paid answers that could not be saved included; or, when the database failed while
  writing it, its hold row still counts at least that.
- `PaidOncePerAnswer`: two identical requests from one reader pay for one answer (they share one call,
  or the second finds the first's saved answer). An answer paid for and then lost (its save failed, or its
  server stopped) may be paid for again: the reader never got it.

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
| `CheckSameRequestInFlight` | `inflight.get(key)`; if empty, the job starts and `inflight.set(key, job)` (no `await` between) |
| `LookAgain` | the job's first step: `savedAnswer()` again (`findStored`, then `copyShared`); found: returned as reused, and `generate`'s `finally` deletes the `inflight` entry; else the job calls `reserveSpend` |
| `TakeLockAndReadSpending` | `reserveSpend`: `withSpendLock` (this process's `lockSpend` turn, then a transaction that takes `pg_advisory_xact_lock`), then `spending` and `heldNow` on the transaction (hold rows of every server included). Other calls' `generations` inserts may land meanwhile (not under the lock); their holds stay until their release, which waits for the lock |
| `DecideAndHold` | `assertRoom(spent, held, holdCost(model, req), …)`; passing: insert the hold row (`failed_spend`, kind `spend-hold`); the transaction commits and the lock goes. Refused: `SpendingCapReached`, and `generate`'s `finally` deletes the `inflight` entry |
| `TheAiAnswers` / `TheAiFailsButBills` / `TheAiFailsUnbilled` | `model.generate` returns / throws an `AiError` with `billed` / throws without `billed` |
| `TheAiFallsBackAndAnswers` | `model.generate` returns an answer from the API's fallback model (`fallbacks: "default"`) after the requested model declined: both attempts billed and both reported (`earlier`, summed by `callCostUsd`) |
| `SaveTheAnswer` | `db.insert(generations)` with `costUsd(result…)`, outside the lock (the hold still counts, so the cost is counted twice for a moment: too much, never too little) |
| `SaveFails` | that insert throws |
| `RecordTheLostAnswer` | `hold.billed(…)` in that `catch`: under the lock, one UPDATE turns the hold row into a `failed_spend` row of the answer's real cost, "Paid, but the answer could not be saved" |
| `RecordTheBilledFailure` | `hold.billed(…)` in the `catch` of `model.generate`: the hold row becomes the billed failure's real cost |
| `TheRecordFailsToo`, `ReleaseFails` | that UPDATE, or the DELETE of `hold.release`, throws (`keptHold` logs it): the hold row stays, counted at its hold (holdCost) |
| `ReleaseTheHold` | `hold.release()`: under the lock, the hold row is deleted; then `inflight.delete(key)` |
| `ServerRestarts`, `TheAiFinishesAnOrphanedCall` | a deploy or crash: `spendTails` and `inflight` are gone, open transactions roll back (their advisory locks go); the hold rows stay; the provider still finishes and charges |
| `TextEditionReads`, `TextEditionDecides` | `startTextEdition`: under `withSpendLock`, `spendingWithJobs` on the transaction, the `overLimit` test, the job row insert (its hold, read by `heldByJobs`). (`textEditionSummary` reads the same outside the lock, for the page only.) |
| `TextEditionBilled`, `TextEditionStored`, `TextEditionEnds` | the batch is answered and charged (up to `MAX_TOKENS` a page, while the job holds `pageEstimateUsd`); `storeBatch` writes the pages; `finishIfDone` ends the job |
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
group (request 3 is on the text edition of the scan the others are on), two copies of the server
(request 3 on the second), one restart, database writes after a payment that may fail (twice), a
text edition started meanwhile; each call's likely cost (`estimateCost`) 1 unit, its charge 1 or 2
units, its hold (`holdCost`) 2 units, both caps 3 units (room for one call in flight, not two). And,
each a finding when dropped (finding 1, what is left): no fallback model rescues a refusal
(`CanFallBack = FALSE`), and a text edition is billed no more than its estimate
(`TextEditionMaxCost = TextEditionEstimate`). `holdCost` bounds a call's input tokens by its bytes (a
token is at least one byte) plus `HOLD_OVERHEAD_TOKENS` (2,000) for what the API adds (message framing,
a JSON schema's instructions): an allowance, not measured. `PaidOncePerAnswer` is checked in the main
config since M44 (finding 7: requests 1 and 2 are identical and on one server). The lock is
modelled as "one at a time", not first-come-first-served: that allows more orders than the code,
never fewer. A restart does not touch a text-edition start (it runs in a request, which `next
start` lets finish).

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

Left out (not modelled): two `generations` (or job) writes landing between the SELECTs of one
`spending` read (they run under READ COMMITTED, each SELECT its own snapshot): a hold's settling
waits for the lock, so a call's cost is never missed; a text-edition batch's pages (`storeBatch`,
not under the lock) can be missed for the length of one read, at most one batch's cost, never more
than the job's hold. Calls on the reader's own key (`isOwnKeyProvider`: by design no cap);
the month boundary; rows brought back from a library file (`imported`); a second provider and
the voice and picture caps (same steps, other numbers); the Anthropic SDK's own retries
(`maxRetries: 2`: an attempt that is billed but returns no usage is not counted anywhere); a
voice note's cost, which comes from the duration the browser reports; `fresh: true` (always
pays, by design); two tabs or devices (each counts its own $1, by design: "each visit starts
off"). Not replayed on the real code (tied to it only by the `LOOK` line): the server's
text-edition, audio, picture and voice-note paths beyond the findings above.

## Known findings

Each has a config that breaks its rule and a replay on the real code (`replay/findings.replay.ts`)
that passes while the bug is there. Steps are in the code's words.

1. **Partly fixed in M44: a call can cost more than its estimate.** `generate` now holds `holdCost`,
   the most the call can be billed (see "Fixed"). What is left:
   - (a) **A refusal rescued by the fallback model: recorded since M44, still held once**
     (`SpendCap-finding-fallback-not-counted`, `CapNeverPassed`). `claude.ts` asks for
     `fallbacks: "default"` (not on Haiku). 1. reserve: the hold covers one attempt. 2. the requested
     model declines and the fallback model answers in the same call; both attempts are billed (the
     Claude API docs: "`usage.iterations` is the per-attempt source of truth; top-level `usage` covers
     only the attempt that produced the returned message"). 3. `claude.ts` now reads
     `usage.iterations` and returns the earlier attempts as `earlier`; `generate` writes `callCostUsd`,
     both attempts at their own prices (Samuel, 2026-11-16: "go with your recommendation"; the old
     code is `SpendCap-mutant-top-level-usage-only`). What is left: while the call runs, the hold
     covers one attempt, so a call that falls back near a cap can pass it by the declined attempt's
     cost; the next call's check sees it. Holding two attempts for models that fall back would close
     it, at the price of refusing calls sooner near a cap.
   - (b) **A text edition can cost more than it holds** (`SpendCap-finding-text-edition-above-estimate`,
     `CapNeverPassed`). The job holds `pageEstimateUsd` a page (1,000 output tokens); each page's
     request allows `MAX_TOKENS` (8,000). On Sonnet 5.5 (batch prices): $0.0102 held a page, $0.0452 at
     most; a 300-page book $3.06 held, $13.56 at most, against the $5 per-book cap. Holding the worst
     case would refuse every scan of more than about 110 pages under that cap, so it is left to Samuel.
Findings 2 to 6 were fixed in M44 (see "Fixed" below). Their numbers are kept, so that the
numbers in older notes still point at the right finding.

7. **Partly fixed in M44: two identical requests can both pay.** On one server the job now looks for a
   saved answer again (see "Fixed"). What is left (`SpendCap-finding-paid-twice-two-servers`,
   `PaidOncePerAnswer`): two copies of the server. 1. request 1, on the first, holds; the AI is working.
   2. request 2, on the second, looks twice (nothing saved yet) and finds nothing in its own `inflight`
   map. 3. it holds and pays too. It needs two copies of the web server at once (Railway replicas, or a
   deploy whose old and new copies overlap); closing it needs the in-flight claim in the database (a
   row per cache key, or an advisory lock on it).

## Broken variants (proof the rules can fail)

| Config | Change to the code it stands for | Rule that breaks |
|---|---|---|
| `SpendCap-mutant-no-lock` | `reserveSpend` without `withSpendLock` | `CapNeverPassed` |
| `SpendCap-mutant-no-second-look` | the job goes from `inflight.set` straight to `reserveSpend`, as before M44 (finding 7 comes back) | `PaidOncePerAnswer` |
| `SpendCap-mutant-hold-the-likely-cost` | `generate` holds `estimateCost` (the likely cost) instead of `holdCost`, as before M44 (finding 1 comes back) | `CapNeverPassed` |
| `SpendCap-mutant-top-level-usage-only` | `claude.ts` reports only the top-level usage, as before M44 (a declined attempt before a fallback rescue is never written) | `EveryChargeRecordedOnce` |
| `SpendCap-mutant-release-before-save` | `hold.release()` before `insert generations` | `ChargedMoneyAlwaysCounted` |
| `SpendCap-mutant-release-only-on-success` | `hold.release()` only after a saved answer | `ReservationReleasedOnce` |
| `SpendCap-mutant-no-failed-spend` | `hold.release()` instead of `hold.billed()` for a billed failure | `EveryChargeRecordedOnce` |
| `SpendCap-mutant-holds-in-memory-book-group`, `-restart`, `-two-servers` | the holds and the lock in each server's memory, as before M44 (findings 2, 5, 6 come back) | `CapNeverPassed` |
| `SpendCap-mutant-text-edition-outside-lock` | `startTextEdition` checks and inserts its job without `withSpendLock` (finding 3 comes back) | `CapNeverPassed` |
| `SpendCap-mutant-lost-answer-not-recorded` | when saving a paid answer fails, `hold.release()` instead of `hold.billed()` (finding 4 comes back) | `CapNeverPassed` |
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

M44 (2026-11-15, then undone): with the product files of M44 put back to their state before it
(`git stash push -- lib/ai/generate.ts lib/library/{audio,pictures,voice-notes,text-edition,costs}.ts`),
all 8 tests of `lib/ai/spend-holds.test.ts` failed (findings 2, 5, 6: "the second call reached the AI:
it was not refused"; finding 4: no `failed_spend` row), and `lib/library/narration.test.ts`'s restart
test failed (`expected 0.063 to be less than or equal to 0.0525`). With the `pg_advisory_xact_lock`
line deleted from `withSpendLock`, `npm run test:postgres`'s "the spending lock" test failed three runs
out of three (`expected … to have a length of 1 but got 5`: five holds passed a cap with room for one).
Finding 1: with `generate` holding `estimateCost(model, req)` again, the test "a call that may use all of
maxTokens holds that much…" failed ("the second call reached the AI: it was not refused … got 2"); with
`Mutant = "holdTheLikelyCost"` in `SpendCap.cfg`, the main check broke `ChargedMoneyAlwaysCounted`.
Finding 7: with `lib/ai/generate.ts` as it was before the second look, the test "a second request whose
first look was answered late…" failed ("request 2 reached the AI: the answer was paid for twice … got 2");
with `Mutant = "noSecondLook"` in `SpendCap.cfg`, the main check broke `PaidOncePerAnswer`.

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

In M44 (2026-11-15), one design fixes findings 2 to 6: a hold is a row in the database (`failed_spend`,
kind `spend-hold`, its `cost_usd` the estimate), written and removed under a Postgres advisory lock
(`withSpendLock`), so every copy of the server and every book of a group sees it, and a restart keeps it.
No migration: the table already counted toward `spending`.

- **1. A call's cost above its estimate (for `generate`)**: the hold is `holdCost`, all of `maxTokens` as
  output and the request's bytes as input tokens, all priced at the cache-write rate. `estimateCost` stays
  the price a reader is shown. Test: `lib/ai/spend-holds.test.ts`, "a call that may use all of maxTokens
  holds that much". A 398-character paragraph's plain rewrite: likely $0.0159, held $0.0611 on Sonnet 5.5
  ($0.0319 and $0.1222 on Opus 5.5). What is left: (a) and (b) under "Known findings". `speak`,
  `makePicture` and the voice note hold the price they compute before the call (per character, per
  picture, per second of audio); M44 did not change them.
- **2. A scan and its text edition**: the hold row carries its `bookId`; `heldByCalls` sums the whole
  `bookGroup`. Test: `lib/ai/spend-holds.test.ts`, "finding 2".
- **3. A text edition's start**: `startTextEdition` reads what is spent and held again, and writes its job
  row, under `withSpendLock`. Tests: "finding 3" (the summary now sees the hold, so the start is refused),
  and `SpendCap-mutant-text-edition-outside-lock` for the lock itself.
- **4. A paid answer that cannot be saved**: `hold.billed()` turns the hold into a `failed_spend` row of the
  real cost ("Paid, but the answer could not be saved: …"), in `generate`, `makePicture` and the voice note.
  `speak` instead keeps the paid audio with its hold (still counted in full) until the next request for those words
  saves it (verify-narration finding 2); a kept one dropped from memory becomes the `failed_spend` row, and a restart
  leaves its hold counted for ever, as in finding 5. If a write fails too, the hold stays, counted in full. Tests:
  "finding 4" for `generate` and `makePicture`; for `speak`, "the voice's cost stays counted when the track cannot be
  saved" and "kept audio that this server can no longer keep becomes a failed_spend row" (the voice note's path is
  the same code as `generate`'s, not tested apart).
- **5. A restart mid-call**: the hold row stays. Test: "finding 5". What is left: it stays counted at its hold
  (the worst case) for ever (the month's cap: until the month ends; the book's cap: always), since the provider may
  have billed it and nothing on the server can tell. The costs page shows the sum of such rows ("Also held
  against the cap … cut off when the server restarted"). To settle one by hand: check the provider's usage
  page; if the call was not billed, delete its row (`delete from failed_spend where kind = 'spend-hold' and
  created_at < now() - interval '1 hour'` deletes every hold older than any call takes); if it was, leave
  it. `next start` lets open requests finish on a deploy, so these come mostly from crashes and from
  background work (whole-book narration).
- **6. Two copies of the server**: one advisory lock and one table for all. Tests: "finding 6" (two copies
  of the module on one PGlite) and `lib/db/postgres.test.ts`, "the spending lock" (five copies of the
  module over two pools of five connections on a real Postgres, twenty reserves, room for one).
- **7. Two identical requests (on one server)**: in `generate`, the job looks for a saved answer again
  (`findStored`, then `copyShared`) after it is in the `inflight` map and before it holds. An identical
  request that finished after the first look saved its answer before it left the map, so it is found.
  Test: `lib/ai/spend-holds.test.ts`, "a second request whose first look was answered late…". What is left:
  two copies of the server (under "Known findings"). Cost: one more database read for each paid call.

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
