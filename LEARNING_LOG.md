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

## Lessons so far

Rules learned in this milestone, each with the iterations that taught it
and how to apply it. A lesson seen twice moves to the top.

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

