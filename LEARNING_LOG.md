# Learning log: M14 (Home is the library)

Written for Samuel and for the next Claude session. One iteration per
attempt judged by a signal: a test run, a CI run, a review, a measurement,
a look at a screenshot, or Samuel's verdict. Plain English; numbers are
quoted from the tool output named, with the commit they ran on.

Outcomes: **success** (the hypothesis held), **failure** (it did not),
**partial**, **flake** (failure not caused by the change; evidence given),
**dead end** (abandoned; why).

## Index

| # | When (UTC) | Step | Hypothesis or goal | Signal | Outcome | Lesson (short) |
|---|---|---|---|---|---|---|
| 1 | 2026-10-05 19:55 | Baseline | `main` is green on the Mac | `npm run check`; full browser suite | success | start from green |
| 2 | 2026-10-05 20:10 | 1 | Labels by availability, no "owned", suites stay green | `npm run check`; full browser suite on f530c5d | success | a required prop turns a forgotten call site into a type error |
| 3 | 2026-10-05 20:25 | 1 | The step-1 change is ready (review) | three reviewer agents | partial | reviews found test gaps the plan's own mutation list missed |
| 4 | 2026-10-05 20:35 | 1 | Each rule has a test that fails when it breaks | 6 unit mutations + 1 browser mutation with a control run | success | mutate every branch of a rule, not only the ones the plan lists |
| 5 | 2026-10-05 20:45 | 1 | The reviewed commit stays green | full browser run on 281bf04 | success | rerun the whole suite after review fixes |
| 6 | 2026-10-05 20:36 | 1 | CI on draft PR #73 checks 9bbf122 | CI run 37369213583 | flake | read a job's step count before reading its result |
| 7 | 2026-10-05 ~20:55 | 1 | Only the planned reference images differ on CI | CI rerun of 37369213583 | success | an unchanged image can still pass the 0.2% limit |
| 8 | 2026-10-05 21:04 | 1 CI | CI checks 61db041 | run 37371609736 | flake | GitHub Actions major outage: all jobs cancelled, 0 steps |
| 9 | 2026-10-05 ~20:50 | 2 | The shell passes accessibility in every look | looks projects (97 tests) | failure then success | 4.50:1 is not a pass: axe rounds against you |
| 10 | 2026-10-05 ~21:00 | 2 | shell.spec passes and measures what it claims | `--project shell` | failure then success | switching colour scheme on an open page measures mid-transition colours |
| 11 | 2026-10-05 21:05 | 2 | Step 2 green from a fresh database; its checks catch breaks | full suite on 18ee79d; 4 browser mutations | success | a needed refresh is proved by removing it |
| 12 | 2026-10-05 ~21:15 | 2 review | Step 2 is ready (review) | three reviewer agents | partial | a laptop-height screenshot shows what a scrolling test hides |
| 13 | 2026-10-05 21:31 | 2 | The review fixes keep the suite green | full suite on ba46d87, 9c4b434, c1cf25c | failure, flake, then success | a focusable wrapper changes where Safari puts focus on click |
| 14 | 2026-10-05 21:49 | 2 | Each review fix has a test that fails without it | 6 fresh-database mutations | success (one mutation was empty) | a mutation can be a no-op: check it changes behaviour |
| 15 | 2026-10-05 22:05 | 1 merge | #73 merges with the checked commit | CI run 37371609736; `git diff 61db041 origin/main` | success | squash-merge then rebase the next branch with `--onto` |
| 16 | 2026-10-05 ~22:15 | 3 | Home's data layer and page work and every rule has a failing test | home.test (5) + 7 unit mutations; `--project home` | failure then success | a test name taken from another page's links can be wrong here |
| 17 | 2026-10-05 22:28 | 3 | Home looks like the mockup | screenshots; a measurement in the browser | failure then success | measure a layout bug before guessing at it |
| 18 | 2026-10-05 22:36 | 3 | Step 3 green from a fresh database; Home's checks catch breaks | full suite on 7732a13; 4 browser mutations | success | |
| 19 | 2026-10-06 00:05 | 3 review | Step 3 is ready (review) | three reviewers; 12 unit + 4 browser mutations; 2 full runs | partial | a shared variable in zsh is one word; check a mutation printed test counts |
| 20 | 2026-10-06 00:25 | 4 | Each filter shows exactly its titles; each rule has a failing test | shelf.test; home.spec (from the export); 7 mutations; 2 reviewers | success | an expected list computed from data can be empty: guard it, or test where the data exists |
| 21 | 2026-10-06 00:35 | 3 CI | #75 passes on CI | run 37392862541 | flake (rerun) | a name containing another control's label breaks getByLabel |
| 22 | 2026-10-06 01:00 | CI flakes | Why WebKit read-along tests fail on CI | 4 CI failures; a trace; worker count | partial (cause narrowed) | a late word at a page break is drawing time, not the network |
| 23 | 2026-10-06 01:30 | 4 rebase; `main` CI | Step 4 on `main` is the tree that passed; `main` is green after #75 | `git diff --stat`; `npm run check`; run 37397581699 | success; flake on `main` | build output left by another branch breaks type checking |
| 24 | 2026-10-06 02:07 | 4 CI, merge | #76 passes CI and merges as checked | run 37399604844 (2 attempts); `git diff --stat 55376be origin/main` | flake, then success | the same word late three times is a cause, not chance |
| 25 | 2026-10-06 ~02:00 | CI flakes | The late word at the PDF page break is WebKit drawing the page | per-frame recordings decoded from two CI traces (read-only agent) | partial (cause located) | the check that failed read a hidden attribute; the visible highlight was on time |
| 26 | 2026-10-06 02:40 | 5 review fixes | Every step-5 review finding can be fixed without changing Hidden Machinery, each guarded by a test that fails without it | 13-analyst locate workflow + critic; 404 unit tests; 29 unit mutations; 3 browser runs | success (browser mutations and second review running) | read the critic even when the fixes are in: it found two of my own mistakes |
| 27 | 2026-10-06 02:52 | 5 browser mutations | Browser mutations can run on a database snapshot taken after `home` | B1 on the snapshot | failure (method), redone with a control | a snapshot needs its login state; never skip the control run |
| 28 | 2026-10-06 03:10 | 5 browser mutations | Each step-5 UI fix has a browser test that fails without it | 2 control runs + 29 browser mutations on a snapshot | success | read where each mutation fails, not just that it fails |
| 29 | 2026-10-06 03:35 | 5 second review | The committed fixes (85ede30) are ready | 5 lens reviewers, 2 skeptics per finding, a critic | failure (29 findings, none refuted), fixed in two rounds | a fix can create the bug it guards against elsewhere: check every other caller |
| 30 | 2026-10-06 03:41 | 5 round-2 mutations | Each second-review fix has a test that fails without it | 2 controls + 12 browser and 9 unit mutations | success, one survivor explained | a guard you cannot make fail in a test is a claim, not a check: say so |
| 31 | 2026-10-06 03:56 | 5 round 3 | The critic's additions hold, each with a failing-without-it test | 13 unit + 3 browser mutations; chain 200 passed | success | |
| 32 | 2026-10-06 04:13 | 5 whole suite | Step 5 passes the whole suite from a fresh database | 2 whole runs | flake, then success | a timing check that fails once is one sample: run it again before deciding |
| 33 | 2026-10-06 07:57 | 5 CI (#77) | Only the planned images differ; Hidden Machinery's page does not | run 37431776866 | success (images refreshed) | an image passing within tolerance is not proof it is unchanged |
| 34 | 2026-10-06 08:16 | 5 merged; 3b | #77 merges as checked; 3b (account button on Home, sidebar edge) works | run 37433148408; `git diff --stat`; shell chain | success | |
| 35 | 2026-10-06 08:36 | 3b CI (#78) | Only the phone images differ (the strip is gone) | run 37435892671 | success (images refreshed) | |
| 36 | 2026-10-06 08:49 | 3b CI (#78) | #78 passes CI | run 37437423658 and its trace | failure (a real bug older than M14), job re-run, then success | "not caused by this PR" is not "a flake" |
| 37 | 2026-10-06 09:15 | fix: reading time | Leaving right after a timed save keeps the sitting's last seconds | stats chain; the old code as a mutation | success | make a race happen on purpose: hold the request |

## Lessons so far

Rules learned in this milestone, each with the iterations that taught it
and how to apply it. A lesson seen twice moves to the top.

- **Read the clock before writing a time** (Iterations 28-34; seen twice
  in one session). Times guessed while waiting were hours off. Apply:
  `date -u` before each entry, or take the time from the output that
  carries it (a file's mtime, `gh run view --json updatedAt`).
- **A browser mutation needs a control run on the same setup** (Iteration
  27): a database copy without its saved login made every run fail, which
  reads as "caught".
- **Ask "which bug passes every test?", then mutate it** (Iterations 3, 4,
  12, 14; seen twice). Step 1's and step 2's reviewers each found bugs no
  test caught. Apply: for each rule, break each branch once; when a
  mutation passes, check it changed behaviour at all (Iteration 14's empty
  `min-height` mutation).
- **Look at a laptop-height screenshot of every fixed panel** (Iteration
  12). A test that clicks scrolls first, so "out of view" passes. Use
  `toBeInViewport` for things that must stay visible.
- **Never leave a large wrapper focusable** (Iteration 13): Safari focuses
  the nearest focusable ancestor on click, which broke a "focus fell back
  to the page" check elsewhere.
- **Change the colour scheme before loading a page when measuring
  contrast** (Iteration 10): mid-transition colours fail.
  The plan's three mutation checks all passed, yet a reviewer found three
  more bugs no test caught (a broken `isAvailable`, the uploaded-audiobook
  path in the data and on the shelf). Apply: for each rule, break each
  branch once, not only the cases the plan names.
- **Turn "every caller must…" into a required parameter** (Iteration 2).
  The compiler then lists every call site. Apply to the Home grid and
  spines in step 3 (they draw covers too).
- **A browser mutation can run in about two minutes**: build the mutated
  app, serve it on the database a full run left, run one test with
  `--no-deps`, then a control run on the restored code (Iteration 4,
  scratchpad `m7.sh`).

## Iterations

### Iteration 1 · 2026-10-05 19:55 · Baseline · success

**Hypothesis.** `main` (deb0924, plus only docs in 0a43836) is green on the
Mac before any M14 code changes, apart from the known CI-only WebKit
failure (`readalong.spec.ts:727`, build plan §11).
**Action.** On branch `m14-b1-availability` at 0a43836 (docs only on top of
`main`): `npm run check`; then `rm -rf .data/e2e .data/e2e-files && npx
playwright test --ignore-snapshots`.
**Evaluation.** The two summary lines.
**Result.** `npm run check`: lint and types clean, `Test Files 60 passed |
1 skipped (61)`, `Tests 342 passed | 2 skipped (344)`, exit 0. Browser
suite: `Running 219 tests using 9 workers` → `219 passed (6.2m)`, exit 0.
**Interpretation.** A green start on the Mac: any later failure comes from
M14 changes (or a collision), not from `main`. The known WebKit failure
at `readalong.spec.ts:727` did not occur here; it is CI-only so far.
**Lesson.** None new; this is the reference point.
**Next experiment.** Step 1 (`m14-b1-availability`).

### Iteration 2 · 2026-10-05 20:10 · Step 1 · success

**Hypothesis.** Labelling titles by availability (D1, narration counts) and
removing "owned" keeps every suite green; only the four reference images
for the changed pages differ (CI only).
**Action.** `lib/library/availability.ts`; Cover takes a required
`available` (a forgotten call site is now a type error, advisor's idea);
Path view, shelf, book page, `/design`, reader guard; tests reworded
(commit f530c5d).
**Evaluation.** `npm run check`; `rm -rf .data/e2e .data/e2e-files && npx
playwright test --ignore-snapshots`; the wording grep.
**Result.** `Tests 353 passed | 2 skipped (355)` (11 new); browser `219
passed (6.2m)`, exit 0; `grep -rniE "not owned|books you own|unowned|\bowned\b"
app components lib e2e --exclude-dir=__screenshots__` prints nothing.
**Interpretation.** Behaviour holds on the Mac. Reference images were not
compared (`--ignore-snapshots`); four sets will fail on CI as planned.
**Lesson.** Make "every caller must do X" a required parameter so the
compiler lists the callers, instead of a warning in a plan.
**Next experiment.** Reviews (Iteration 3).

### Iteration 3 · 2026-10-05 20:25 · Step 1 review · partial

**Hypothesis.** f530c5d is ready to push.
**Action.** Three read-only reviewer agents: correctness and regressions;
wording, UI and contrast; "could each test fail?". Findings checked by
reading the code or by a mutation run (a direct check stood in for a
skeptic agent where one was possible).
**Result.** Confirmed and fixed (281bf04): a broken `isAvailable` (read AND
listen) passed every test; the uploaded-audiobook path in `getPathView`,
`getBook` and the shelf was untested; no test read the shelf label;
"Your shelf" small heading over "Your library"; available titles in a
Path's folded list had no label; Cover imported server code (database,
ElevenLabs) through `availability.ts`; `docs/design.md` used old names.
Not changed, with reasons: reference images stale (refreshed from CI, §8);
screen readers hear "not available yet" in the link name and the caption
(both required by the plan's tests; harmless); `getBook` does one extra
query for pages that ignore the label (one query, not per row); the label
ignores the voice spending cap (D1 says key set = narration on); "Listen
only" titles have nowhere to play (D2, not in M14). Contrast of all new
labels: lowest 6.86:1 (sepia, sunken panel).
**Lesson.** The plan's mutation list covered the rules it named; a
reviewer asking "which bug passes every test?" found three more.
**Next experiment.** Mutation-check the new tests (Iteration 4).

### Iteration 4 · 2026-10-05 20:35 · Step 1 mutations · success

**Hypothesis.** Each availability rule has a test that fails when the rule
breaks.
**Action.** A script (scratchpad `mutate.py`) applies one change, runs the
named Vitest files, restores the file. On 281bf04's code.
**Result.** All caught: M1 `audiobookBookIds` ignores `status` → 2 failed
(availability.test, paths.test); M2 narration counts for a PDF → 1 failed
("never counts narration for a PDF"); M3 Cover shows the image for a
title-only book → 1 failed; M4 `isAvailable` = read AND listen → 2 failed
(Cover "can only be read", paths.test); M5 `getPathView` ignores uploaded
audiobooks → 1 failed; M6 `getBook` ignores them → 1 failed. M7 (shelf page
ignores uploaded audiobooks): built the mutated app, served it on the
database the full run left, ran only `readalong.spec.ts:1123` with
`--no-deps` (scratchpad `m7.sh`) → `1 failed` at line 1154 ("Read and
listen" not found on the PDF's shelf item); control on the restored code →
`1 passed (25.2s)`.
**Lesson.** See Iteration 3.
**Next experiment.** Draft PR; CI; refresh the reference images from CI.

### Iteration 5 · 2026-10-05 20:45 · Step 1 · success

**Hypothesis.** The review fixes (281bf04) keep every suite green,
including the new browser checks (shelf and book-page labels, a PDF with
an audiobook says Read and listen).
**Action.** `npm run check` (before commit); `rm -rf .data/e2e
.data/e2e-files && npx playwright test --ignore-snapshots` on 281bf04.
**Result.** `npm run lint`, `tsc` clean; browser `219 passed (6.2m)`, exit 0.
**Interpretation.** Ready for a draft PR. CI will still fail four
reference-image sets (`book-not-available`, `path`, `shelf-empty`,
`design`), which the Mac run does not compare.
**Lesson.** None new.
**Next experiment.** Push as a draft; read CI.

### Iteration 6 · 2026-10-05 20:36 · Step 1 CI · flake

**Hypothesis.** CI on PR #73 (9bbf122) passes everything except the four
reference-image sets.
**Action.** Pushed, opened draft PR #73.
**Evaluation.** `gh pr checks 73`; `gh run view 37369213583 --json jobs`.
**Result.** Three jobs "fail" after 15m1s, but each is `cancelled` with
`steps=0`: they never got a runner. Only the ledger check ran (pass).
githubstatus.com at 20:36 UTC: "Partially Degraded Service", Actions
`degraded_performance`, "Incident with Actions: investigating".
**Interpretation.** Not a test result: no code was tested on CI. A flake of
the service, with evidence.
**Lesson.** A red check is not a test failure until its log shows steps;
check `steps` (or the log) before reading anything into it.
**Next experiment.** `gh run rerun 37369213583 --failed`; wait.

### Iteration 7 · 2026-10-05 ~20:55 (estimated: no clock read; corrected from 21:10, written before 21:04) · Step 1 CI · success (images refreshed)

**Hypothesis.** On CI only the reference images of the changed pages fail.
**Action.** `gh run rerun 37369213583 --failed` after the outage; read the
browser job log; `gh run download 37369213583 -n playwright-report`.
**Result.** Browser job ran (13 steps): `10 failed`, `122 did not run`,
`87 passed (3.0m)`. All 10 failures are `visual.spec.ts` "looks as
approved": `path` (4 looks), `shelf-empty` (4), `book-not-available`
(phone light and dark). Looked at each `*-actual.png`: the Path page with
"Not available yet" under every cover, "Your library" under "LIBRARY", the
book page's "Not available yet. Add the book file…". Copied the 10 into
`e2e/__screenshots__`. `design` passed: its covers are below the fold.
**Interpretation.** As planned. The 122 tests that did not run sit behind
the screenshot projects; they run on the next push.
**Lesson.** `book-not-available` on desktop passed although its text
changed: a one-line text change can stay under the 0.2% pixel limit, so
the old reference image stays. Step 2 refreshes every signed-in image.
**Next experiment.** Push; all checks green; mark ready; merge.

### Iteration 8 · 2026-10-05 21:04 · Step 1 CI · flake

**Hypothesis.** CI on 61db041 (refreshed images) passes.
**Evaluation.** `gh run view 37371609736 --json jobs`; githubstatus.com.
**Result.** All four jobs `cancelled`, `steps=0`. githubstatus at 21:04
UTC: "Partial System Outage", Actions `major_outage`, "Actions is
experiencing degraded availability."
**Interpretation.** No signal about the code. A background task waits for
Actions to report "operational", then re-runs the jobs.
**Lesson.** Same as Iteration 6. Meanwhile, keep working locally on the
next step without pushing it (pushing a stacked branch would let the
auto-merge Action merge step 1's files with it, as #69 did).
**Next experiment.** Step 2 locally (branch `m14-b2-shell`, not pushed).

### Iteration 9 · 2026-10-05 ~20:50 (estimated) · Step 2 · failure, then success

**Hypothesis.** The new sidebar, tabs and account menu pass the WCAG
checks in every look.
**Action.** Shell built (`components/shell/`, `app/(app)/layout.tsx`);
`npx playwright test --project desktop-light --project desktop-dark
--project phone-light --project phone-dark --ignore-snapshots`.
**Result.** First run: every signed-in page failed in `desktop-light` only.
Computed: `--ink-500` on `--paper-sunken` (light) = 4.50:1. Changed the
sidebar's group labels and "N of M" to `--ink-700` (6.96:1). Rerun: `97
passed (13.3s)`.
**Lesson.** A ratio of exactly 4.5 fails in practice; aim for a margin.
The phone and dark looks passed because their colours differ.
**Next experiment.** shell.spec.ts.

### Iteration 10 · 2026-10-05 ~21:00 (estimated) · Step 2 · failure, then success

**Hypothesis.** `e2e/shell.spec.ts` passes on the shell.
**Action.** `rm -rf .data/e2e .data/e2e-files && npx playwright test
--project shell --ignore-snapshots` (runs setup → looks → flows → uploads
→ shell).
**Result.** Run 1: `2 failed`. (a) The Path link's name was "Hidden
Machinery 0 of 29" (the count is inside the link), so an exact name never
matched; the count now reads "0 of 29 pillars started" to a screen reader
and the test matches it. (b) axe found contrast failures with colours
like `#556064`, half way between light and dark: the test had switched
the colour scheme on an open page and measured during the CSS
transition. The test now loads the page fresh in each scheme. Run 2: `1
failed`, the same (b) before the fix landed; run 3: `127 passed (23.6s)`.
A screenshot showed a collection another test in the same file had made:
the file now runs its tests in order (`test.describe.configure({ mode:
"default" })`).
**Lesson.** Change the colour scheme before loading a page, never on an
open one, when measuring contrast.
**Next experiment.** Full suite; mutation checks.

### Iteration 11 · 2026-10-05 21:05 · Step 2 · success

**Hypothesis.** Step 2 (d5eec0f, 80e26b0, 18ee79d) is green from a fresh
database, and each new check fails when its fix is broken.
**Action.** `npm run check` parts; full browser suite on 18ee79d; four
browser mutations with scratchpad `mut-e2e.sh` (patch, build, serve on the
database the full run left, run `--project shell --no-deps -g …`,
restore).
**Result.** Vitest `Tests 360 passed | 2 skipped (362)`; browser `224
passed (6.3m)`, exit 0. Mutations: M8 no padding under the tabs → `1
failed` at shell.spec:102 (last line below the tab bar's top); M9
Finished links to `?show=finish` → `1 failed` at :34 (URL); M10 menu not
closed on a new page → `1 failed` at :128; M11 no `revalidatePath("/",
"layout")` after making a collection → `1 failed` at :65 (the new
collection never appears in the sidebar). All files restored (`git diff`
clean).
**Interpretation.** M11 proves the layout refresh is needed, not just
harmless: without it the sidebar keeps the old list.
**Lesson.** Prove a "defensive" line by removing it and watching a test
fail; otherwise it may be dead code or a missing test.
**Next experiment.** Reviews of step 2.

### Iteration 12 · 2026-10-05 ~21:15 (estimated) · Step 2 review · partial

**Hypothesis.** Step 2 (18ee79d) is ready.
**Action.** Three read-only reviewer agents (correctness; UI, accessibility
and the mockup; "could each test fail?"). Findings checked by reading the
code and by mutation (Iteration 14).
**Result.** Confirmed and fixed (ba46d87, 9c4b434, c1cf25c): the sidebar's
account foot was below the fold at 1280 x 800 (tests passed because
Playwright scrolls to what it clicks); New collection did nothing in an
empty library (both the UI and the correctness reviewer); importing a
library file left the sidebar stale; two unnamed search landmarks; no
skip link; account menu: Escape lost focus, rows 21 px tall, Sign out's
underline nearly invisible; no room for an iPhone's home bar; a Path's
name wrapped beside its count; "shelf" wording on uploads and search.
Test gaps closed: Invite for non-admins, the sidebar gaining a Path and an
imported collection, /paths contents, exact "N of M", one current tab,
tap outside, repeated query keys through /shelf, a pillar note's link,
two Paths sharing a book. Not changed, with reasons: the phone top strip
(Samuel's call, asked in the PR and the M14 verdict); `viewport-fit:
cover` (needs a real iPhone to check; the reader would change too); React
`cache()` for the duplicate queries (small); the search box border at
1.2-1.7:1 (as drawn in the mockup; icon and placeholder mark it).
**Lesson.** Look at a laptop-height screenshot of every fixed panel: a test
that clicks scrolls first and hides "out of view".
**Next experiment.** Full suite on the fixes.

### Iteration 13 · 2026-10-05 21:31 · Step 2 · failure, flake, then success

**Hypothesis.** The review fixes keep the whole suite green.
**Action.** Full suite from a fresh database on ba46d87, then 9c4b434, then
c1cf25c.
**Result.** ba46d87: `1 failed` (shell.spec "tap outside": the open menu
covers the heading the test clicked; the test now taps the page margin).
9c4b434: `1 failed`, `readalong.spec.ts:605` (Chromium) "the audio fell
810 ms behind the clock (stalled)"; repeated alone on a cold server it
failed 5 of 5 differently ("was" lit 111 ms late, limit 100): timing on a
loaded or cold machine. Step 2 changed nothing on the reader's audio path
(`git diff` shows one link in Reader.tsx). Judged a flake. Next run
(9c4b434 again): `1 failed`, `readalong.spec.ts:300` in WebKit, focus on
"content" instead of "audiobook": a real regression. The skip link's
wrapper had `tabindex=-1`, so Safari (which does not focus clicked
buttons) focused it on every click, and the audiobook section's "focus
fell back to the page" check failed. Fixed (c1cf25c): the wrapper is
focusable only for the skip; `233 passed (6.3m)`, exit 0.
**Lesson.** Never leave a large wrapper focusable: in Safari a click inside
it moves focus there. Focus checks like `activeElement === document.body`
in other parts of the app depend on it.
**Next experiment.** Mutation checks for the review fixes.

### Iteration 14 · 2026-10-05 21:49 · Step 2 mutations · success

**Hypothesis.** Each review fix has a test that fails without it.
**Action.** Scratchpad `mut-chain.sh`: patch, run the project and its
dependencies from a fresh database (Playwright builds), restore.
**Result.** M13 New collection only with books → flows.spec:100 fails; M16
Invite for every reader → flows.spec "Invite" `toHaveCount(0)` fails
(received 1); M14 import without refresh → uploads.spec:203 fails (first
try used `-g`, which skipped the tests that add books and failed at :169
for that reason; rerun without `-g`); M15 Escape without focusing the
button → shell.spec:152 fails; M12 (remove `min-height: 0` from the
links) → nothing failed: an empty mutation, because `overflow-y: auto`
already lets a flex item shrink. M12c (the old, non-shrinking links) →
flows.spec:107 fails: Sign out unreachable. The skip-link wrapper's
regression is guarded by readalong.spec:300 in WebKit (Iteration 13).
**Lesson.** A mutation that changes nothing proves nothing: when a
mutation passes, first check it changed behaviour, then decide whether
the test or the mutation is wrong. Filtering with `-g` can remove the
setup a test depends on.
**Next experiment.** Push step 2 once #73 merges.

### Iteration 15 · 2026-10-05 22:05 · Step 1 merged · success

**Hypothesis.** #73 can merge: all checks green on the commit CI checked.
**Evaluation.** `gh pr checks 73`; run 37371609736 jobs with `steps`.
**Result.** All four checks pass (browser tests 13 steps). Merged
(squash) as 94d31c8; `git diff 61db041 origin/main` prints nothing, so
`main` holds exactly the checked tree. Step 2 rebased with `git rebase
--onto origin/main m14-b1-availability m14-b2-shell`: two conflicts, both
in `LEARNING_LOG.md` (resolved by keeping the complete copy); the rebased
tip differs from the old one only by step 1's 10 refreshed images.
**Lesson.** After a squash-merge, `--onto` replays only the next step's
commits; compare old and new tips with `git diff --stat` to prove nothing
was dropped.

### Iteration 16 · 2026-10-05 ~22:15 (estimated) · Step 3 · failure, then success

**Hypothesis.** Home's data layer (`lib/library/home.ts`) and page work,
and each rule has a test that fails without it.
**Action.** `home.test.ts` (5 tests); seven unit mutations (oldest note,
finished or title-only in Continue, deleted not-yet titles, bookmarks fold
the corner, any annotation kind shown, a ready audiobook ignored); the
page, grid, spines, View switch, Continue card, Home import; `npx
playwright test --project home`.
**Result.** Unit: first run `1 failed` (a bookmark needs a real place in a
real book; moved beside the imported Jekyll), then `5 passed`; all seven
mutations caught. Browser: `1 failed` twice, both test errors: "Not
available yet" matched 126 elements (now the `summary` is clicked), and
the grid's links are named by their contents, not "Chip War (not
available yet)" as on a Path. Then `187 passed (1.8m)`.
**Lesson.** A name a test takes from one page (the Path's cover links)
may not hold on another (the grid's text links): read the markup.

### Iteration 17 · 2026-10-05 22:28 · Step 3 look · failure, then success

**Hypothesis.** Home matches the mockup at desktop and phone width.
**Action.** Looked at `home-full-*` screenshots.
**Result.** Discourse on the Method drew a cover two cells wide over its
neighbour. Measured in the browser (a small Playwright script on the
test server): figure 405 px wide in a 173 px cell; "Trap Book" 175 in 173.
Cause: the item's grid column was sized by its content, so a title on one
line widened it. Fixed with `grid-template-columns: minmax(0, 1fr)`; a new
check in home.spec measures every cover against its cell. Also: phone
buttons now stack ("Listen from here" wrapped); the sidebar panel runs the
full page height in full-page captures.
**Lesson.** Measure a layout bug in the browser before changing CSS; then
turn the measurement into a test (lesson 2 of the plan).

### Iteration 18 · 2026-10-05 22:36 · Step 3 · success

**Hypothesis.** Step 3 (88a57b1, a2ec6d1, 7732a13) is green from a fresh
database, and its browser checks fail without their fixes.
**Evaluation.** Full suite on 7732a13; scratchpad `mut-chain.sh`.
**Result.** `246 passed (6.4m)`, exit 0. Mutations: H8 the saved view not
restored → home.spec:118 fails (desktop and phone); H9 the inactive view
not `hidden` → :102; H10 the item column sized by content → :70 (the
overflow measurement); H11 `?listen=1` ignored → :51 (no Read aloud bar).
**Next experiment.** Reviews of step 3.

### Iteration 19 · 2026-10-06 00:05 · Step 3 review and fixes · partial (CI decides the flakes)

**Hypothesis.** Step 3 (rebased on `main` after #74 merged) is ready.
**Action.** Three reviewer agents (correctness; UI against the mockup;
"could each test fail?"); fixes in f64068d; mutation checks; two full
suites from a fresh database.
**Result.** Confirmed and fixed: an AI agent's note shown on Continue as
"Your last note" (ground rule 5); the folded corner never drew (one
clip-path clipped both triangles); spine lettering 4.11:1 (light) and
3.62:1 (dark) over the fill on green, now a darker fill (`--spine-fill`,
in all five theme blocks, as `lib/tokens.test.ts` requires); marks with no
words for screen readers; Continue card 470 px tall on a phone and
stacked buttons on desktop; the drop hint on phones; every EPUB spine the
same width (EPUBs have no page count: file size now); drops outside
`<main>` opened the file; `?listen=1` stayed in the address; duplicate
queries; no not-available group on /library; 12 test gaps. Unit
mutations H12-H19 each fail a named test (first try printed no counts:
zsh passed two file names as one word); browser H20-H23 each fail
(auth.setup:17, home.spec:68, :46, :128; H20's first patch matched twice
and was refused). Full suites on f64068d: `2 failed` (audio.spec:85,
safari.spec:42), then `1 failed` (readalong.spec:605); a different
real-time audio test each run; `uptime` load average 4.61; safari.spec:42
also fails on `main` b018c34 when run with `--project safari` alone (an
order-dependent test). Judged timing flakes; CI on Linux decides.
**Lesson.** In zsh, `$VAR` holding two paths is one argument: pass them
separately, and treat "exit 1 with no test counts" as "did not run".
**Next experiment.** Push step 3; read CI; refresh images.

### Iteration 20 · 2026-10-06 00:25 · Step 4 (filters) · success

**Hypothesis.** `/library?show=…` shows exactly D5's titles, with counts
that agree, and every rule has a test that fails without it.
**Action.** `listShelf({ show })` (want, finished, books, pdfs,
audiobooks); the page's heading, count and phone chips; a unit test on a
fixture library; a browser test that works out each filter's expected
titles from `/api/export`; mutations; two reviewers.
**Result.** Unit `5 passed`; browser `189 passed (1.9m)` up to `home`.
Mutations: F1 Audiobooks from narration tracks → the unit test fails with
the wrong title (its first run failed for a missing import instead: redone
with the import, so the failure is the assertion); F2 Finished from 0.99;
F3 Want to Read with opened books at 0%; F4 Audiobooks counting uploads
still uploading; F5 heading ignoring the filter (shell.spec:39); F6 chips
hidden on a phone (home.spec:223); F7 Want to Read without its waiting
titles (:216): all caught. Reviews: the browser check for Audiobooks was
empty (no audiobook exists before the read-along project; now checked
there too); wrong empty messages with a collection or search; two counts
that disagreed on Want to Read; two "All" chips; 31 px chips; filters away
from the collections. Fixed (4b64e02). Kept "Your library" as the whole
library's heading (the plan said "All"; recorded in Decisions).
**Lesson.** A mutation that crashes (a missing import) is not the
assertion failing: read the error, not just the red mark. An expected
list worked out from data needs a "not empty" guard, or a test where the
data exists.

### Iteration 21 · 2026-10-06 00:35 · Step 3 CI and step 4 suite · flake, then success

**Hypothesis.** #75 (970a19b, images refreshed) passes CI; step 4 passes
the whole suite locally.
**Result.** CI run 37392862541: lint, types, unit, Postgres pass; browser
`242 passed`, `1 failed`: `readalong.spec.ts:1123` in readalong-safari,
`"most" (word 51) shown 116 ms after it starts` (limit 100). Word 51 is
the first word after the PDF page break (page 1's last word runs straight
into it), so the extra time is WebKit drawing the next PDF page on CI.
Step 3 does not touch page turns or PDF drawing; the test passed on CI
for steps 1 and 2 and in every local run. Judged the known WebKit timing
margin (build plan §11); failed job re-run. Added to the list for the
timing investigation before step 6a. Step 4 locally: first full run
`1 failed` (uploads.spec:113): renaming the library's search area to
"Search and sort" made `getByLabel("Sort")` match two elements (names
match by substring); renamed "Search titles"; then `248 passed (6.5m)`.
**Lesson.** A new accessible name must not contain another control's
label: Playwright (and some screen readers' search) match substrings.

### Iteration 22 · 2026-10-06 01:00 · WebKit read-along on CI · partial (cause narrowed)

**Hypothesis.** The intermittent readalong-safari failures on CI are
caused by M14 changes, or by tests running at once.
**Evaluation.** The four failures so far, a trace, CI's worker count.
**Result.** #68 `:727` "was" lit 117 ms late; #72 `:727` audio stalled
(`playUntil` 45 s); #75 run 1 `:1123` "most" (word 51, first after the
PDF page break) lit 116 ms late; #75 run 2 `:241` a two-part upload never
reached "Done." (2 min). Two of these were on docs-only PRs: `main`'s
code fails the same way. The `:1123` trace: the audiobook's file came in
one 34 ms request, nothing was pending at the page break, so the late
word is WebKit drawing the next PDF page. CI runs `using 1 worker`, and
readalong.spec is `serial`: no test competes for the CPU. So: WebKit on a
small CI machine sometimes needs over 100 ms to light the first word on a
new page, and sometimes stalls (audio or upload) outright.
**Interpretation.** Not M14. Loosening the 100 ms limit would weaken a
test the product depends on. The causes to remove are product work: draw
the next PDF page before the reading reaches it; find what stalls WebKit
(its media pipeline on Linux, or the capped range requests).
**Next experiment.** Before step 6a (build plan §11): pre-render the next
page and measure the page-turn latency on CI; trace a stall with the
audio requests and their ranges.

### Iteration 23 · 2026-10-06 01:30 · Step 4 rebased; `main`'s CI after #75 · success; flake on `main`

**Hypothesis.** Step 4 rebased onto `main` (after #75's squash-merge) is
the tree that passed locally, and `main` is green after the merge.
**Evaluation.** `git diff --stat 456c475 HEAD` after
`git rebase --onto origin/main 970a19b m14-c-filters`; `npm run check` on
ba46766; `main`'s push CI, run 37397581699.
**Result.** The diff printed nothing: the rebased tree equals 456c475,
where the full suite gave `248 passed (6.5m)` (Iteration 21), so the
suite was not re-run. `npm run check` first failed type checking:
`.next/types/validator.ts` named `paths/[slug]/edit/page.js` and
`paths/new/page.js`, pages of the step-5 build left in `.next`; after
`rm -rf .next/types`: `Tests 377 passed | 2 skipped (379)`. `main`'s CI:
lint, types, unit, Postgres pass; browser `1 failed`, `4 did not run`,
`242 passed (14.8m)`: `readalong.spec.ts:1123` (readalong-safari),
`"most" (word 51) shown 112 ms after it starts`.
**Interpretation.** The fifth WebKit read-along failure on CI and the
second at the same word (#75's first run: 116 ms). The page-break delay
is systematic on CI's WebKit, not rare; `main` is red for it, not for
step 4.
**Lesson.** Build output from another branch (`.next/types`) breaks type
checking after switching branches: clear it before `npm run check`.
**Next experiment.** Push step 4 as a draft PR; on a WebKit read-along
failure of the known kind, re-run the failed job. The investigation stays
before step 6a.

### Iteration 24 · 2026-10-06 02:07 · Step 4 CI and merge (#76) · flake, then success

**Hypothesis.** #76 (55376be: step 4 rebased, ledger) passes CI and merges
as the checked commit.
**Evaluation.** CI run 37399604844; `gh run rerun 37399604844 --failed`;
after the merge, `git diff --stat 55376be origin/main`.
**Result.** Attempt 1: lint, types, unit, Postgres, hygiene pass; browser
`1 failed`, `4 did not run`, `243 passed (14.8m)`: `readalong.spec.ts:1123`
(readalong-safari), `"most" (word 51) shown 100 ms after it starts` (the
check needs under 100). Every visual test passed, so step 4 changed no
reference image, as predicted. Attempt 2 (the failed job only): `248 passed
(15.3m)`. Merged with `--match-head-commit`: `main` cb5018b; the diff
printed nothing.
**Interpretation.** Third failure at the same word: 116 ms (#75 run 1),
112 ms (`main`, run 37397581699), 100 ms (#76). A cause that repeats at one
place, not chance.
**Lesson.** When a flake keeps landing on the same assertion, stop
re-running and find what the assertion actually reads (Iteration 25).
**Next experiment.** Rebase step 5 onto `main`; the investigation stays
after step 5 and 3b, as the handoff orders.

### Iteration 25 · 2026-10-06 ~02:00 · WebKit read-along on CI · partial (cause located)

**Hypothesis.** The late word 51 at the PDF page break (`:1123`) is WebKit
drawing the next PDF page.
**Evaluation.** A read-only agent decoded the test's own per-frame
recording (stored in each trace) from `main`'s run 37397581699 and #75's
run 37392862541 (attempt 1), lined up with the trace's events (clock
caveat: about 3 ms).
**Result.** The page's own highlight lit "most" on time, 30.5 ms and 47 ms
after the word starts. What failed is the Listen bar's `data-word`
attribute (React state, `ListenBar.tsx:459`, shown nowhere on screen): two
frames later, because the page's main thread was blocked 49 ms and 62 ms
right after the page turn. In both runs pdf.js logged `Cannot load system
font: Times-Italic` inside the longest gap: page 2 is the first to use
italic (a footnote), and with `useSystemFonts` on, pdf.js first tries 16
local font names, which all fail on CI's Linux. Passing WebKit runs light
words 29-91 ms late (Chromium 9-29 ms); the median over all 117 words is
25.4 ms. The other signatures are separate: `:727` "117 ms" is an EPUB
(one 106 ms gap right after a 640 s seek), `:727` "stall" is WebKit's
media pipeline (range requests cancelled, then 45 s of nothing), and
`:241` is Playwright's `setInputFiles` on the folder picker hanging while
the page already said "Done.".
**Interpretation.** Not M14 code, and not the drawing of the page as such:
a font lookup on first use blocks the thread, and the bar's update waits
behind it. The 100 ms limit stays.
**Lesson.** Before calling a timing failure a flake, find out what the
failing check reads: here a hidden attribute lagged the visible highlight.
**Next experiment.** In the investigation (after step 5 and 3b): load the
next page's fonts and drawing ahead (`lib/reader/pdf-book.ts`), add
`performance.mark`s around the turn and print the phase times before the
assertion (today the timing line prints only when the test passes);
compare five CI runs before and after. `useSystemFonts: false` would also
remove the lookup, but changes how PDFs without their own fonts look: a
choice for Samuel. Files: the session's scratchpad `flake/`
(`main-recording.json`, `pr75a1-recording.json`, `decode.py`).

### Iteration 26 · 2026-10-06 02:40 · Step 5 review fixes · success (browser mutations and a second review still running)

**Hypothesis.** All findings of the two step-5 reviews (handoff §4b) can be
fixed without changing Hidden Machinery, each guarded by a test that fails
without its fix.
**Action.** A read-only workflow: 13 analysts each confirmed a cluster of
findings against the code (file:line, a minimal fix, the guarding test),
then a critic checked coverage and conflicts. Every finding held; one was
wider than reported (focus is lost on every Move down: React re-inserts the
moved row). Fixes in 85ede30 (list in the commit message). Rebased first:
`git rebase --onto origin/main 456c475` in a worktree, ledger conflicts
resolved keeping both sides' entries; `git diff --stat 55d9016 HEAD` showed
only PROGRESS.md and LEARNING_LOG.md.
**Evaluation.** `npm run check`; unit mutations with `scripts/m14/mutate.py`;
`npx playwright test --project own-paths --ignore-snapshots` from a fresh
database; the screenshots.
**Result.** `Tests 404 passed | 2 skipped (406)`. Unit mutations: 29 run, all
caught in the end; three needed a better check first: D9 (CRLF to LF
removed) survived because trimming each line also strips "\r" (a lone "\r"
test now catches it); D11's patch matched twice and was refused; U8 (a loose
id check in getBook) survived until a test asked getBook for 36 hyphens.
Browser: `200 passed (2.1m)` three times. The screenshots showed three
things the tests could not: covers bottom-aligned (a progress bar lifted
one cover 12 px), hover borders where the last click was, and the other
test's "Constructor" Path in the sidebar; fixed (top alignment, mouse moved
away, tests in order). The critic, read after the fixes were in, found two
mistakes of mine: my sentence in `docs/done.md` relaxed Samuel's definition
of done (reverted; pages that need data are listed in `e2e/pages.ts` with
the spec that covers them, so CI still requires their screenshots), and a
keyed list moved the add-section form, taking focus out of "New section"
(now fixed places, guarded by an Enter-then-focus test).
**Interpretation.** The pending-blank status line, the per-section status
and focus, and the reading-list lock cover the review; the upload race
(S4) is in `docs/plan.md` "Later".
**Lesson.** Moving a DOM node takes focus away: keep a form that must keep
focus in a fixed place rather than in a list that reorders. And: React
skips a form action when onSubmit calls preventDefault (react-dom's
`defaultPrevented` branch), so a second click can be ignored without
disabling, and dimming, every button.
**Next experiment.** Browser mutations B1-B28 from a database snapshot
taken after the `home` project (`scratchpad/mut-snap.sh`); a second review
of 85ede30 (five lenses, two skeptics per finding); then the full suite,
the PR, and CI's images.

### Iteration 27 · 2026-10-06 02:52 · Step 5 browser mutations · failure (of the method), redone

**Hypothesis.** Browser mutations run faster on a copy of the database
taken after the `home` project: build the mutated app, serve it on the
copy, run only `own-paths` with `--no-deps`.
**Evaluation.** The first mutation of the batch, B1 (focus after Move and
Remove removed).
**Result.** `2 failed`, and both tests failed at their very first step
(`getByLabel("Name").fill`, 30 s): the pages never loaded signed in. The
saved login (`e2e/.auth/admin.json`) came from a later fresh run than the
database copy, so its session was unknown there. Every mutation would
have "failed", which reads as "caught". Stopped the batch (tree clean, no
backup left), and redid it: the snapshot now holds the login state too,
and the batch starts with control runs (no mutation; they must pass, or
the batch stops).
**Lesson.** A browser mutation is only evidence next to a control run on
the same setup. A test environment copied from one run must carry
everything that run made (database, files, saved logins).
**Next experiment.** The batch with its controls.

### Iteration 28 · 2026-10-06 03:10 (the batch's log; from its file) · Step 5 browser mutations · success

**Hypothesis.** Each step-5 UI fix has a browser test that fails without it.
**Evaluation.** The scratchpad's `mut-browser.sh`: a fresh chain to `home`
(`198 passed (1.9m)`), a snapshot of its database, files and saved login;
then for each mutation: build the broken app, serve it on a copy of the
snapshot, run `own-paths` (or the Hidden Machinery tests in `flows`) with
`--no-deps`; restore the file, check its checksum. Two mutations needing
the earlier projects ran from a fresh database (`scripts/m14/mut-chain.sh`).
**Result.** Controls (no mutation): `2 passed (10.5s)` and `3 passed (1.0s)`.
Mutations B1-B28 (29 runs): every one failed a test, each at the assertion
meant for it (focus after Move, focus on Read, the empty Path's heading
order, the add form's message and focus after the first section, the
attach message, the dimmed button's opacity, the sidebar's and /paths'
words, the hidden text on Add, the visible "How to read it", line breaks,
no letters on your own covers, the status naming the title, the stale tab
with no error page and with its message, the chosen kind, the last Move
down disabled, "Any order", authors in the library list, both directions
of the reading-list flag, both kinds of place on the book page, the cover
letter, Edit path and the edit page refused for Hidden Machinery, /stats'
words, Hidden Machinery's sidebar words); every file restored.
**Lesson.** A failing test is evidence only when it fails where it should:
the log's `> line |` shows which assertion stopped the run.
**Next experiment.** The second review's findings; then the full suite and
the PR.

### Iteration 29 · 2026-10-06 03:35 (the critic's report; from its file) · Step 5 second review · failure (of 85ede30), fixed

**Hypothesis.** The committed fixes (85ede30) are ready for a PR.
**Evaluation.** A workflow: five reviewers (correctness, UI words, access,
"could each test fail?", regressions) read the commit through git only
(the working tree was being mutated); two skeptics tried to refute each
finding; a critic judged them and looked for what all missed.
**Result.** 29 findings, 0 of 58 skeptic verdicts refuted any. The worst:
my own C5 fix (typed titles match by author) made two waiting titles with
one short title possible, while uploads still matched by short title only,
so a dropped file could attach to the wrong title for good. Others: a
shared given name counted as the same author (John Donne / John Keats);
two volumes joined; the forms emptied what was typed when the server
refused it (React resets a form after its action; `ActionForm` already
worked around it); disabled buttons dropped keyboard focus; Hidden
Machinery's N/E were read out with your-Path words; a book twice in one
section; tests that could not fail. The critic added: a surname-only rule
splits "Liu Cixin" / "Cixin Liu"; seeding Hidden Machinery has the same
title-only join; a removed typo stays in the library for ever; a blank
typed author is never filled in. Fixed in c2d5f16 and 420d9c7 (one
shared `sameBook` / `pickBook` for typed titles, uploads and seeding;
the forms on `ActionForm`'s pattern).
**Lesson.** A fix can create the bug it prevents elsewhere: when a rule
changes for one caller (typed titles), check every other caller of the
same idea (uploads, seeding).

### Iteration 30 · 2026-10-06 03:41 (the batch's log; from its file) · Step 5 round-2 mutations · success, one survivor explained

**Evaluation.** `scratchpad/mut-browser2.sh` on the snapshot (controls first)
and `scripts/m14/mutate.py`.
**Result.** Controls `2 passed (11.6s)`, `1 passed (919ms)`. Browser
B30-B41 and B37: 12 of 13 caught at their assertions. B33 (the
same-moment ref removed from the Move guard) survived: React shows the
form as sending before Playwright's second click; B33b (no guard at all)
was caught (`to 3 of 4` instead of `2 of 4`). Unit R1-R9: R5 (no
whole-title preference) survived because the subtitle rule had left one
candidate in the old test; a new test (Poems / Poems: Selected) catches it.
**Lesson.** When a guard cannot be made to fail in a test, say so in the
PR instead of counting it as covered.

### Iteration 31 · 2026-10-06 03:56 (the last chain run; from its file) · Step 5 round 3 · success

**Evaluation.** Unit R10-R21 (`mutate.py`); browser B42-B44 with a control;
`npx playwright test --project own-paths` from a fresh database.
**Result.** All 12 unit mutations caught (people rule both ways, other
scripts, seeding, blank author, the four "keep the book" conditions,
empty sections, ties with fixed ids), after pinning two conditions no
test reached (a typed title in a collection, or with a note). Browser:
control `2 passed (11.9s)`; B42-B44 caught. Chain `200 passed (2.1m)`
(three runs). `npx vitest run`: `417 passed | 2 skipped`.

### Iteration 32 · 2026-10-06 04:13 · Step 5 whole suite · flake, then success

**Hypothesis.** Step 5 (420d9c7 and its docs) passes the whole browser suite
from a fresh database.
**Evaluation.** `rm -rf .data/e2e .data/e2e-files && npx playwright test
--ignore-snapshots`, twice; `npm run check`.
**Result.** First run: `1 failed`, `4 did not run`, `254 passed (7.0m)`:
`readalong.spec.ts:1225` (readalong-safari), "share of opens tinted: 0.00"
(the check that the reader paints the word being read after a resize; its
timing checks at the page break passed: page 2's first word lit 24 ms
after it began). Second run: `259 passed (6.7m)`. `npm run check`:
`Tests 417 passed | 2 skipped (419)`.
**Interpretation.** A WebKit painting-time check in the reader, which
step 5 does not touch, failed once on the Mac; the same code passed the
next run. Another sample for the investigation before step 6a.
**Lesson.** A timing or painting check that fails once is one sample: run
the whole suite again before deciding, and record both runs.

### Iteration 33 · 2026-10-06 07:57 (CI run 37431776866 finished; from GitHub; corrected from 04:40, written without reading the clock) · Step 5 CI (#77) · success (images refreshed)

**Hypothesis.** On CI only the planned reference images differ (`paths`,
`book-not-available`, new `path-new`), and `path` (Hidden Machinery) does
not.
**Evaluation.** CI run 37431776866 on fdb6fc5; its report
(`gh run download 37431776866 -n playwright-report`).
**Result.** Lint, types, unit, Postgres, hygiene pass. Browser: `10 failed`,
`138 did not run`, `111 passed (4.2m)`: `paths` (4 looks), `path-new` (4,
no reference yet), `book-not-available` (the two phone looks). `path`
passed in all four looks: Hidden Machinery's page is unchanged. The
desktop `book-not-available` passed within the 0.2% tolerance although the
page gained "Choose the book file" (pale border on a pale page; its
actual is not saved for a passing test), so its reference keeps the old
picture. Looked at all ten actual images, then copied them in.
**Lesson.** A screenshot that passes within tolerance can still show an
old picture (as Iteration 7 found): say so in the PR.

### Iteration 34 · 2026-10-06 08:16 (#77 merged; from GitHub) · Step 5 merged; step 3b built · success

**Hypothesis.** #77 merges as the checked commit; step 3b (Samuel's choice
B: the account button on Home only; and a soft edge on the sidebar's
scrolling links) passes its tests.
**Evaluation.** CI run 37433148408 on f50d552; `git diff --stat f50d552
origin/main`; for 3b, `npx playwright test --project shell
--ignore-snapshots` from a fresh database, the screenshots, `npm run check`.
**Result.** CI: all four jobs green, browser `259 passed (13.5m)` (no
WebKit flake this run). Merged with `--match-head-commit`: `main` 8cd0b49;
the diff printed nothing. 3b (rebased onto `main` as 7dc453d): shell chain
`155 passed (30.3s)`; the phone screenshot with the menu open matches the
canvas's row B (outlined initial beside the filled Import button, menu
below on the right, no strip); the desktop sidebar shows the soft edge
below "New path" where the list goes on; `npm run check` `Tests 417 passed
| 2 skipped (419)`.
**Next experiment.** The whole suite on 3b; then its PR, where CI will
fail every signed-in reference image (the strip on phones, the edge on
desktop) once, to be refreshed after looking at each.

### Iteration 35 · 2026-10-06 08:36 (CI run 37435892671 finished; from GitHub) · Step 3b CI (#78) · success (images refreshed)

**Hypothesis.** On CI only the signed-in phone images differ (the strip is
gone), and the desktop ones change only by the sidebar's soft edge.
**Evaluation.** CI run 37435892671 on 94fdfb3 and its report; two contact
sheets of the 26 actual images (light, dark), looked at page by page.
**Result.** Lint, types, unit, Postgres, hygiene pass. Browser: `26 failed`,
`140 did not run`, `95 passed (4.5m)`: exactly the 13 signed-in pages in
both phone looks. Every image: no strip, the page's title first, Home's
title row with the filled Import and the outlined initial, tabs at the
foot. Copied all 26 in. The desktop images passed within the 0.2%
tolerance: the soft edge is that faint, so their references keep the old
picture (as with `book-not-available` on desktop, Iteration 33).

### Iteration 36 · 2026-10-06 08:49 (CI run 37437423658 finished; from GitHub) · Step 3b CI (#78) · failure (a real bug, older than M14), job re-run

**Hypothesis.** #78 (1902338, images refreshed) passes CI.
**Evaluation.** CI run 37437423658; the failed test's trace (network log).
**Result.** `1 failed`, `66 did not run`, `194 passed (7.2m)`:
`stats.spec.ts:84`, the sitting's active time `60` where at least `90`
was due. The trace: three saves of the sitting, at 30 s and 60 s (204)
and at 90 s, `net::ERR_ABORTED`, sent as the test was already leaving
for /stats; no save on leaving followed. The reading tracker
(`useReadingTracker.ts`) marks totals as sent when it sends them, so the
save on leaving (keepalive, which survives the page closing) skipped the
same totals, and the timed save was cut off by the navigation. Not step
3b's code: up to 30 s of reading can be lost when a reader leaves right
after a timed save (M10). Re-ran the failed job; the fix goes in its own
PR, with a test that holds the 90-s save in flight and then leaves.
**Lesson.** "Not caused by this PR" is not "a flake": a failure outside
the PR can still be a real bug; read the trace, then fix it on its own.

### Iteration 37 · 2026-10-06 09:15 · Fix: reading time lost on leaving · success

**Hypothesis.** A save on leaving that always goes (keepalive, even with
the same totals as the timed save) keeps the sitting's last seconds when
the timed save is cut off by the leaving.
**Action.** `useReadingTracker.ts`: `if (body === s.sent && !keepalive)
return;`. `stats.spec.ts` holds the timed save at 90 s in flight (Playwright
`page.route`) until the reader has been left, as a slow network would.
**Evaluation.** `npx playwright test --project stats --ignore-snapshots`
from a fresh database; the old line as a mutation (`scripts/m14/mut-chain.sh`).
**Result.** With the fix: `193 passed (1.8m)`. With the old line: `1 failed`
at `stats.spec.ts:101`, the sitting's time stuck below 90 (the same
failure as CI run 37437423658, now on every run). #78 merged after its
re-run (`261 passed (15.7m)`; `main` 35d9e97).
**Lesson.** A race can be made to happen on purpose: hold the request with
`page.route` until the step that cuts it off has run.

### Iteration 38 · 2026-10-06 09:34 · WebKit flakes, step 1 (measure) · success (locally; CI to come)

**Hypothesis.** Timing marks in the reader, and a recorder that reports
before any check runs, can be added without changing one check, and they
show where the time goes at a PDF page turn.
**Action.** `git apply docs/m14-flake/timing-measurement.patch` with the
plan's two edits (no "Phase B"; a `tests` input), and one more: the timing
log creates its folder.
**Evaluation.** `npx playwright test -c playwright.timing.config.ts --list
--repeat-each 3`; two local timing runs (WebKit, Mac); the whole suite
from a fresh database; the plan's proof grep.
**Result.** The list: 1 setup test and 3 timing tests. First timing run:
`1 failed` with `ENOENT: no such file or directory, open
'…/timing/local.jsonl'` (the folder did not exist), hence the third edit.
Second run: `2 passed (32.7s)`. Its timeline has every mark's details
(WebKit keeps them), `afterLate` 1, an italic font load (`font g_d0_sf4
italic: load() held the page 2 ms`), and no word 80 ms late or more (a
Mac, not CI). Whole suite: `261 passed (6.7m)`. The proof grep printed
nothing.
**Lesson.** A measurement must not be able to fail the test it measures:
anything it writes, it writes where it has made sure it can.

### Iteration 39 · 2026-10-06 09:55 (CI run 37444264710, attempt 1, finished; from GitHub) · Flake step 1 CI (#80) · flake, measured for the first time

**Hypothesis.** When `:1123` fails on CI, step 1's recorder prints a
timeline that names the cause before the check fails.
**Evaluation.** The browser job's log of CI run 37444264710 (attempt 1).
**Result.** `1 failed`, `4 did not run`, `256 passed (16.0m)`: the known
flake, `readalong-safari` `:1123`, `bar: "most" (word 51) shown 118 ms after
it starts`. The timeline, in ms after the voice began "most": lit at
28 (the book showed it in the next frame: `litFrame` 27.4, on time);
at 45 `font g_d0_sf4 italic: load() held the page 38 ms; FAILED at 83`;
React wrote the bar's `data-word` at 92; the next frame, at 118, showed it.
That is S1 of the plan in one run: the bar's word waits for React, and
React waits behind a failed system-font lookup. Steps 2 and 3 remove those
two waits. The Chromium run of the same test: every word under 40 ms. Re-ran
the failed job.
**Lesson.** Measure before fixing: one measured failure showed both causes
the plan inferred from traces, in the order it predicted.

### Iteration 40 · 2026-10-06 09:56 (the last proof log; from its file) · Flake step 5 (folder picks that cannot hang) · success

**Hypothesis.** If Playwright misses the browser's `input` event for a
folder, `setInputFiles` never returns, though the page uploads; one more
`input` once the page shows it took the folder ends that wait.
**Action.** `chooseFolder` in `readalong.spec.ts` at the four folder picks.
One change from the plan: the extra event goes to the folder field found
by `input[webkitdirectory]`, not by its label, because "Choose the
read-along folder" becomes "Replace with another folder" once a reading is
ready, and a label lookup after that waits with no limit.
**Evaluation.** From a snapshot taken after the `offline` project
(database, files and saved login together), the folder test alone, in both
engines: control; Playwright made to miss the event (a capture listener
that stops the browser's first `input`) with a plain pick; the same with
`chooseFolder`; then the plain pick with a 20 s limit, under the test's 30 s.
**Result.** Control: `1 passed` (5.0 s Chromium, 5.5 s WebKit). Missed
event, `chooseFolder`: `1 passed` (5.0 s, 5.6 s). Missed event, plain pick,
20 s limit: `TimeoutError: locator.setInputFiles: Timeout 20000ms exceeded`
at the pick, in both engines (21.0 s, 21.3 s). A run that recorded the
events: `input` stopped at the window, `change` delivered, the page at
"Done.", the pick still waiting at 20 s. With a 30 s limit (the plan's),
the test's own 30 s ran out first: Chromium reported the pick; WebKit
reported the next line, because Playwright's wait swallows the error when
the page is closed (`dom.js`, `waitForInputEvent.catch(() => {})`); the
page there also showed "Done.".
**Lesson.** A limit on one step proves nothing when the whole test's limit
is the same: set it lower, or the failure lands somewhere else.

### Iteration 41 · 2026-10-06 10:07 (the read-along run's log; from its file) · Flake step 4 (no on-disk audio for CI's WebKit) · partial (the proof is CI's first run)

**Hypothesis.** With `WPE_SHELL_DISABLE_MEDIA_DISK_CACHE=1`, CI's WebKit
(WPE, GStreamer) no longer copies the audio to disk, so after the jump far
into the file no request goes back for the bytes it skipped, and the
stall that followed such a request (CI run 37348223223) cannot happen.
**Action.** The variable on the `readalong-safari` project
(`playwright.config.ts`); the far-into-the-file test logs every audio
request and, when every request is open-ended (Linux WebKit), checks that
none after the far one starts lower; `playUntil` prints the player's state
if the audio never gets there.
**Evaluation.** The whole read-along file in both engines, from the
snapshot taken after `offline`. A Mac cannot show the effect (its WebKit
plays audio through Apple's media system); it can show that WebKit still
starts with the replaced environment and that the check is skipped there.
**Result.** `23 passed (2.1m)` (Chromium), `23 passed (2.3m)` (WebKit). The
log lines: Chromium `bytes=0- → 206; bytes=11075584- → 206`; WebKit on the
Mac only closed ranges (`bytes=0-1`, `bytes=0-15863883`, then pieces from
`bytes=11272192-15859711` on), so the check did not run there. Whether the
variable reaches WebKit on Linux is for the PR's first CI run to show; if a
go-back request still appears there, the step is withdrawn.
**Lesson.** When only CI can show an effect, say in advance what the first
CI run must show and what would withdraw the change.

### Iteration 42 · 2026-10-06 10:26 (timing-samples run 37448727457 finished; from GitHub) · Flake step 1 baseline · measurement, no fix

**Hypothesis.** `main` (0cc07de) fails the WebKit page-break test often
enough to measure fixes against: 3 or more failures or near misses in 30
(step 1's "Done when").
**Evaluation.** `gh workflow run timing-samples.yml -f refs=main -f
machines=3 -f repeats=10` (the quick shape: the owner's account, then only
this test), the Summary job's table, and the 30 runs' own records (`gh run
download 37448727457`). Times are in ms after the voice begins page 2's
first word ("most"), as median / 90th percentile / maximum.
**Result.**
- Failed 6 of 30. Near misses (a word at 80 ms or more, the failures
  included): 13, so 7 runs came within 20 ms of failing.
- The bar's word at a frame: 70 / 117 / 163. The book's highlight at a
  frame: 57 / 161 / 173.
- Lighting a word to writing the bar's word (`barWrittenClock` minus
  `litSet`): 4.4 / 33.4 / 58.5, in 29 runs.
- The bar's frame later than the book's: 3 runs of 29 (16, 13 and 72 ms
  later). In one more run the bar never showed the word at a frame.
- Each run's font load held the page: 39 / 51 / 55. This is the first
  direct measurement of the system-font lookup, and every run had one that
  failed.
- The longest gap between frames within 0.4 s of the word: 67 / 142 / 182.
- The six failures are of two kinds:
  - **Five are in a machine's first runs** (machine 1, runs 0-2; machine 3,
    runs 0-1). The word was lit 18-82 ms after it began, but the frame that
    showed it came at 100-173 ms (the longest gaps between frames: 73-182
    ms). So the highlight a reader sees was late too, not only the bar.
  - **One is the kind CI shows** (machine 3, run 7). The word was lit at 34
    ms by the page's text arriving, React wrote the bar at 92, and the bar's
    frame came at 117 while the book's was at 45.
  - Machine 2 never failed. Its font loads held the page 18-29 ms, against
    33-55 on the others.
**Lesson.** A sample of repeats is not a sample of the same thing: the
first runs on a fresh machine differ from later ones and from CI's full
suite. Look at the runs one by one before trusting a table. The plan's
check of the quick shape against the full chain (`-f shape=suite`)
decides whether these numbers can judge a fix.

### Iteration 43 · 2026-10-06 10:47 (timing-samples run 37450233481 finished; from GitHub) · Flake step 1: the quick shape against CI's · measurement, no fix

**Hypothesis.** The quick shape (the owner's account, then only the
page-break test) measures what CI's full suite sees. The plan trusts it
only if the medians of the two agree within one frame.
**Evaluation.** `gh workflow run timing-samples.yml -f refs=main -f
machines=1 -f repeats=5 -f shape=suite`, its five WebKit runs one by one.
**Result.** 3 of 5 failed. For page 2's first word, the bar's frame and the
highlight's frame came at a median of 93.5 and 84.7 ms. The quick shape
gave 69.9 and 57.1 over all 30 runs, and 50.8 and 48.6 over its later runs.
That is more than a frame apart, so the quick shape does not stand for CI.
The failures:
- Two are the bar trailing React: lit at 23 and 19 ms, React wrote the
  bar at 85 and 90, and the bar's frame came at 104 and 114 while the
  book's was at 30 and 87.
- One is a stretch of 226 ms with no frame drawn ("real", word 52, shown
  at 169 ms on both).
**Lesson.** Measure where the failure lives: CI's full chain fails
differently, and more often, than a quick run of the one test. A sampling
run that costs about 20 runner-minutes a machine is dear, so from here on
each step is proved by its own check that fails without it and by its
pull request's CI run, and ordinary CI is harvested afterwards.

### Iteration 44 · 2026-10-06 10:49 · Flake step 2 (the bar's word written when it is lit) · success (CI to come)

**Hypothesis.** Writing the bar's word in the same step as the word is
lit removes the bar's lag behind React, the main kind of failure on CI
(Iterations 39, 42 and 43).
**Action.** `recordLit` in `Reader.tsx` at all three places a word is lit.
The bar keeps no word state. Step 1's `nl:bar-set` mark moves into
`recordLit`. `expectEveryWordOnTime` checks that the bar and the book
change on the same frame.
**Evaluation.** The new check replayed on the three saved CI recordings
(scratchpad `sameframe.py`). A live try on a Mac: the old code with a
40 ms busy task queued right after each lit word, ahead of React's
update. Then the whole suite from a fresh database, and `npm run check`.
**Result.**
- **Replay:** the check fails all three recordings, at the words CI failed
  at. "most" (word 51) on frame 553 against 551, in both the `main` and
  #75 recordings; "and" (word 10) on frame 106 against 105, in `:727`'s.
- **Live try:** the old code still passed (`3 passed`, with and without the
  busy task). WebKit on a Mac ran React's update before the next frame
  even then, whereas on CI a frame came between them (Iteration 39). So a
  Mac cannot show this, as the plan said; the replay and CI are the proof.
- **With the change** (on steps 1, 5 and 4): `261 passed (6.7m)`;
  `Tests 417 passed | 2 skipped (419)`.
**Lesson.** A delay is not an ordering: to reproduce a race, make the same
thing come first, not only later.

### Iteration 45 · 2026-10-06 10:59 · Flake step 3 (the next PDF page drawn ahead); steps 4, 2 and 3 in one pull request · success (CI to come)

**Hypothesis.** If the next page is drawn ahead, small and thrown away, its
fonts load while this page is read, so no font is loaded between page 2's
turn and its first word.
**Action.** `warmUp` in `pdf-book.ts`, started once a page is drawn: one
page at a time, a page already shown skipped, stopped when the book
closes. The page-break test checks that no font load starts between page
2's turn request and its first lit word.
**Evaluation.** The step-3 tests run on the code before step 3, then with
it: the page-break test alone, in both engines, from the snapshot taken
after `offline` (scratchpad `proof-warm.sh`). Then the whole suite from a
fresh database, on steps 1, 5, 4, 2 and 3 together.
**Result.**
- **Before step 3:** `1 failed` in both engines with "a font was loaded at
  the page turn": the italic font loaded 18 ms (Chromium) and 12 ms (WebKit)
  before page 2's first word began.
- **With it:** `1 passed` (25.5 s, 25.9 s).
- **Whole suite:** `261 passed (6.8m)`.
- **#82 (step 4)** passed CI, and its log is the proof the plan asked for.
  WebKit on Linux asked `no range → 0; no range → 200; bytes=10247084- →
  206; bytes=10247084- → 206`: nothing after the far request starts below
  it, where the failing runs went back to byte 7,348,224.
- **But #82 could not merge.** Each stacked branch adds its ledger entry at
  the same place, so after #81's squash merge, git saw two different
  insertions there. GitHub runs no checks on a pull request that conflicts,
  which is why #83 never got any. Steps 4, 2 and 3 now go in one pull
  request (`m14-flake-fixes`, the same tree as the one tested here), so CI
  runs once instead of three times.
**Lesson.** Stacked branches that each write the same ledger lines do not
merge after a squash: git compares the insertions, not their meaning. To
save CI rounds, put the steps in one pull request with a commit each.

### Iteration 46 · 2026-10-06 11:24 · Step 6a (one player for the app) · success (CI to come)

**Hypothesis.** If the reader's player logic moves, unchanged, into a
provider in the root layout that owns the one `<audio>`, and the reader
only attaches itself (word lighting, page turns, where to draw the bar),
then every existing player test passes unchanged and the audio goes on
when the reader is left.
**Action.**
- `components/player/PlayerProvider.tsx` and `ListenSession.tsx`:
  ListenBar's logic, moved as it was. The bar is drawn into the reader
  through a portal (React drawing a component's output inside another
  element), so it renders in the same step as before, with no extra update
  in between.
- The bar's buttons stay in the reader with its styles.
- `lib/player/session.ts` holds the first voice and the bar's note, with
  unit tests.
- Closing the bar unmounts the session, as before. `/sign-in` stops it.
- The cross-link is now a `<Link>`.
**Evaluation.** The whole suite from a fresh database. A snapshot after
the `ai` project, then the `audio` project alone: a control run, and four
browser mutations.
**Result.**
- **Whole suite:** `261 passed (6.8m)`, every existing test unchanged
  except one added URL wait in the cross-link test. `npm run check` →
  `Tests 426 passed | 2 skipped (428)`.
- **Control:** `7 passed (12.7s)`.
- **The four mutations,** each caught by a new test:
  - reloading the audio on leaving the reader: `audio.spec.ts:175`, the
    time never moved past where it was;
  - stop only pausing: `:190`, the element still in the page;
  - sign-out not stopping: `:214`;
  - the bar not shown again for its book: `:187`.
- **Not as the plan expected:** it thought `audio.spec.ts:132-134` would
  catch "stop only pauses". In this design the reader removes its bar and
  the highlight whatever the player does, so only the new test sees it.
**Lesson.** Move logic first, untouched; change only what it talks to. A
portal let the bar keep its timing and look while its owner moved.
