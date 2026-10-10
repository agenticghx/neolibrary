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
| 60 | 2026-10-07 00:40 | V3b (#99) | Import fits the sidebar and a fifth phone tab with only the column count changed | whole suite; tab sizes measured; base comparison; control + 2 mutations | success (CI to come) | a database copy taken later can hold data that fails an older test: run the control, then compare with the base |
| 61 | 2026-10-07 01:41 | V5 (#100) | Whole-book narration needs no new table: speakPassage in a loop, runs in memory | npm run check; whole suite twice; browser test timings; 12 screenshots; 7 mutations with controls | success (CI to come) | time the code path a test runs, from inside the test, and print the margin |
| 62 | 2026-10-07 01:21 | V5 full run 1 | The whole suite passes on 30a0766 | whole suite; the WebKit project alone on the same build | flake (an older test's navigation race) | |
| 63 | 2026-10-07 02:13 | V5 review (#100) | #100 is ready | review workflow (reviewers, a skeptic per finding) | failure (7 confirmed, all in V5's files) | every finding involved two things at once |
| 64 | 2026-10-07 03:04 | V5 review fixes | Seven small fixes in V5's files close the seven | npm run check; narration test; 3 unit + 6 browser mutations with controls; whole suite | success (CI to come) | a page that asks again and again: wait for the answer on its way, show only answers about the current choice, keep action errors apart |
| 65 | 2026-10-07 04:22 | V5 owner only (#100) | One rule in the route (POST, GET) and on the Import page keeps whole-book narration to the library's owner; Stop stays open | npm run check; route test; narration and uploads tests; 4 unit + 2 browser mutations with controls; whole suite | success (CI to come) | test a permission where it is the only thing in the way: the reader's own book |
| 68 | 2026-10-07 06:51 | Back into a chapter not loaded (draft from `m14-back-into-chapter`) | A "before" mode on the parts route and one skip rule land Back where it lands with everything loaded | npm run check; a sweep against the whole list; read-along tests in both engines; 6 unit + 4 browser mutations with controls; whole suite | success (CI to come) | a test that needs an exact first paragraph must not start from the reader's page |
| 69 | 2026-10-07 07:32 | WebKit stall report (draft from `m14-flake-s4-diag`) | When the audio stands still, the log says whether the player asked for audio and whether the server answered; no check changed | npm run check; the read-along file in both engines; forced failures (audio requests held) in both engines and on the base | success (CI to come) | force the failure before trusting a report |
| 71 | 2026-10-08 22:12 | B4 Account | An Account page, disabling a reader, and API tokens that expire after 90 days | `npm run check`; Playwright `--project=shell --ignore-snapshots` | success (CI screenshots still to refresh) | the screenshot projects run before any reader exists; the shell project runs after |
| 72 | 2026-10-08 22:40 | B4 screenshots | CI's first browser job fails only the pixel comparison, and the new images are the page we built | run 37852607386; looked at Account, Invite, Agent access, Home, and the design page | success (behaviour tests still to run) | a new sidebar link changes every signed-in desktop image; phone changes only where the page's own text changed |
| 73 | 2026-10-08 22:36 | B4 merge | The second browser job passes, including the tests that did not run the first time, and the pull request merges | run 37853536318; `gh pr view 117` | success | auto-merge squashes once the four checks are green; a backup still has to come before the deploy |
| 74 | 2026-10-09 09:17 | One page or Two pages | One saved choice drives a PDF and a reflowable book; a tall window stays on one page | `npm run check`; reader Playwright project, then the fixed test alone | success | wait until a PDF page is drawn before pressing Next; this Playwright ignores a timeout written on the test itself |
| 75 | 2026-10-09 10:13 | Review of One page / Two pages | A tall window stays on the page it is showing, and a failed reopen can be tried again | `npm run check`; the two reader tests on the leftover database | success | a fix in an installed package has to run after install; a column's width is not how many columns there are |
| 76 | 2026-10-09 10:34 | Second review of One page / Two pages | The viewer names the page; the reader only drops a page that is not showing | `npm run build`; the two reader tests on the leftover database | success | do not keep a second writer of a fact the patched viewer already reports |
| 79 | 2026-10-09 | See it thumbnails | A scaled Commons picture is blocked because its host is not in the page's image rule | `npx vitest run lib/csp.test.ts`; Playwright images project; a real thumbnail in the reader | success | the empty box was a blocked thumbnail, not a layout rule |
| 80 | 2026-10-09 16:45 | PDF made voice (Part A) | Each word of an AI-voice paragraph in a PDF can be placed on its page the way an uploaded audiobook's words are | npm run check; full browser suite; 1 unit + 1 browser mutation; The Grid pages 22-25 by hand | success (one WebKit flake in the new test, cause removed) | a stale lit word at a paragraph change is not a new word |
| 81 | 2026-10-09 22:20 | Row 14 (b) | The highlight tests can forgive a word only the machine skipped (no redraw while it was said) and still catch a real skip | 5 unit tests; full browser suite; a player that skips every fifth word | success | judge a skip by the redraws, not by the time it took |

Iterations 38 to 59 have no row in this index (the sessions that wrote them did not add one); they are in full below.

## Lessons so far

Rules learned in this milestone, each with the iterations that taught it
and how to apply it. A lesson seen twice moves to the top.

- **Do not keep a second writer of a fact another piece already reports**
  (Iteration 76). The patched viewer names the PDF page on screen. The
  reader only drops an address for a page that is not showing.
- **A fix inside an installed package has to run again after install**
  (Iteration 75). foliate-js comes from npm. Editing `node_modules` alone
  disappears on the next install. The script is
  `scripts/patch-foliate-fxl.mjs`, run from `postinstall`, `predev`, and
  `prebuild`. If the next version of that file does not contain the old
  text, the script stops instead of pretending the fix is in.
- **The width of a column is not the number of columns** (Iteration 75).
  After Scroll, the viewer's column count can stay at 2, and one column
  about 680px wide is more than half of a 1152px window. The document's
  own `column-width` is `auto` for one scrolling column. Read it with
  that document's window.
- **A page that asks the server again and again needs three rules**
  (Iterations 63-64). Never replace a request still on its way (wait for
  it, with a time limit); show and send only answers about what the person
  has chosen now; keep an action's error apart from a check's, or the next
  check wipes it out. Apply: test with a route that answers slower than the
  interval, and one that fails once.
- **Time the code path a test runs, from inside the test, and print the
  margin** (Iteration 61). A run timed through the HTTP route, one request
  per paragraph, was twice as slow as the same work in the server's own
  loop, so the first test book left Stop only a third of the run. Apply:
  when a test must act while something is still going on, size it from
  the test's own printed timing, keep several times the margin, and leave
  the print in so CI's log shows it too.
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

### Iteration 47 · 2026-10-06 11:47 (the traced run's log; from its file) · Step 6a: one failure that would not come back · unexplained

**Hypothesis.** The new tests or the provider made `readalong.spec.ts:661`
(a phone, large text, the page turning as the voice reads) fail. In one of
two local whole runs, its audio was paused at 6.6 s.
**Evaluation.**
- The player diagnostic from that run.
- The test alone, then the read-along group, then a whole run with a
  temporary tracer. The tracer wraps `HTMLMediaElement.prototype.pause`
  inside `recordPlayer` (`e2e/listen.ts`), so every call records its stack
  and whether the element is still in the page, and `playUntil`'s
  diagnostic prints them.
**Result.**
- **The failing run:** the element was still in the page, with one load and
  no error. Its events were `play`, `waiting`, `loadstart`, `playing`, then
  `pause` at 6.6 s. Only two lines in the app call `pause()`: changing the
  voice and the Pause button. The test does neither before its check.
- **A first repeat of the test alone was invalid:** `--repeat-each 6` ran
  the copies in parallel, and their imports into one book collided.
- **Then 9 passes:** 4 alone with one worker, the read-along group twice
  (`23 passed`), the traced whole run (`263 passed (6.8m)`), and #85's CI
  in both engines.
**Lesson.** `--repeat-each` repeats in parallel unless `--workers 1`: a
repeat run of one test tests something else. A failure that will not come
back gets a trap (the tracer above), not a story.

### Iteration 48 · 2026-10-06 11:59 · Step 6a review, and its fixes · success (CI to come)

**Hypothesis.** Reviewers holding the mapped constraints find what a green
suite cannot: behaviour at the new joints (leave, come back, switch book).
**Evaluation.** Four reviewers (tests, reader, app shell, moved logic),
each with one analyst's report, read #85's diff; a skeptic per reviewer
followed. I checked each finding below against the code before fixing it.
**Result.** Five problems were real, plus one note:
1. **Back on a book still read aloud, the reader attached before its book
   had opened.** The "show where it is" call was lost, and × could throw,
   leaving the audio playing. Now the reader attaches only once the book
   is open, and closing the bar copes with a half-open book.
2. **The new test clicked × before the book was open** (a race on slower
   machines). It now waits for the book, then checks that a word is lit
   again.
3. **Opening another book kept the first one playing, with no bar.** Now
   opening another book stops it, as before; the question is Open unknowns
   row 9.
4. **Both search boxes loaded a whole new page, which ended reading aloud.**
   They are now `next/form`.
5. **A Listen never played outlived the reader**, and came back later with
   expired audio links. Now only a session that has played goes on, and
   Home's "Listen from here" always starts at the reading position.
6. **(Note)** Back-to-back local runs against one reused server can hit the
   sign-in limit. No code change.

Whole suite on these fixes before the last one (`fresh`): `265 passed (6.8m)`.
**Lesson.** A refactor that makes state outlive a page creates new joints;
test each one (leave, return, switch, search, sign out), not only the old
paths.

### Iteration 49 · 2026-10-06 12:45 · Step 6b, part 1 (the mini-player) · success (CI to come)

**Hypothesis.** The app-wide player can show the design's mini-player away
from the reader without a page, if the server sends each paragraph's
text, the player works out the word from its times, and the app's layout
gives it a slot that idle pages do not notice.
**Action.**
- **Server:** paragraph text, chapter names, the paragraph before, the book,
  and saving the position by paragraph.
- **Pure rules:** sentence, skip and speed (`lib/player/`).
- **The bar itself:** `MiniPlayer` in a slot at the foot of the app's column
  (`:has()` changes the column only while it is there).
- **Mapped first:** a read-only workflow of three analysts mapped the server,
  the layout and the skip rules. The skip analyst found that a skip landing
  in a stretch playing jumps over is undone on the next frame.
**Evaluation.** Unit tests, then the three new read-along tests in both
engines (from the snapshot after `offline`), the screenshots looked at, the
whole suite, and four mutations.
**Result.**
- **Unit tests:** `Tests 450 passed | 2 skipped (452)`; the skip sweep covers
  724 landings.
- **The 6b tests:** `3 passed` in each engine, after two fixes in the tests
  themselves. `textContent` read the hidden phone copy of the sentence, and
  `name: "Play"` also matched "Playback speed".
- **Screenshots, looked at:**
  - the shared mini cover was twice the design's size (now the design's
    30 x 45 swatch);
  - the phone's book line wrapped "5 min left" (now one line; the title gives
    way).
- **Whole suite from a fresh database:** `271 passed (7.2m)`.
- **Mutations, each caught after a control (`3 passed`):** no clamp at 0 (3
  unit tests); speed not re-applied (`readalong.spec.ts:1597`); word only
  from the page (`:1511`); position not saved (`:1538`).
- **A slip of mine:** I changed a file while a background run used the same
  working copy (the unit mutation). Its results were clean, but only by
  timing.
**Lesson.** Look at the screenshots: two of the three visual faults (cover
size, wrapped line) passed every test. And never edit the working copy
while a run is reading it.

### Iteration 50 · 2026-10-06 13:59 · Step 6b review, and its fixes · success (CI to come)

**Hypothesis.** The 19 findings that survived the 6b review (workflow
`wf_36df385f-c88`: logic, looks and server reviewers, then a skeptic per
finding) each need only a small change, and every fix a test can see is
caught by a test when broken.
**Action.**
- **Player** (`ListenSession.tsx`):
  - on leaving the page, the mini-player starts from where the audio is;
  - a made-voice skip into the next or previous paragraph pauses first,
    and plays on only if it was playing;
  - `settling` is reset on a voice change and on an audio error;
  - the minutes left follow a speed change;
  - every part's chapter names are kept (`withPart`, unit-tested).
- **Bar** (`MiniPlayer.tsx`, `.module.css`, `globals.css`):
  - the phone's speed menu opens on the screen;
  - three lines at most, from near the word;
  - an iPad-width layout;
  - only the chapter shortens, never the minutes;
  - the speed menu's closing rules, and one pill per screen size, so the
    tab order matches the order seen;
  - focus scrolled clear of the bar: room measured by the bar, and lifted in
    Safari.
- **Server** (`reading.ts`): progress on the reader's scale (share of text;
  PDF pages).
- **Tests:**
  - new: paused then left; a made voice; the phone menu; a long chapter
    name; an iPad width; focus clear of the bar;
  - skips measured inside one call in the page;
  - a permanent `pause()` tracer in `recordPlayer`.
**Evaluation.**
- Unit tests.
- The 6b tests in both engines, and the made-voice test.
- Screenshots, looked at.
- The whole suite from a fresh database, twice.
- Mutations, after a control.
- The progress scale re-measured with `scratchpad/progress-compare.mts`.
**Result.**
- **Unit tests:** `Tests 452 passed | 2 skipped (454)`.
- **The 6b tests:** `4 passed` in each engine; the made-voice test `1 passed`.
- **The new tests found three more bugs:**
  - with a made voice, the mini-player put the previous paragraph back
    (mark "That"). The new paragraph's `timeupdate` back to 0 ran with the
    previous render's data;
  - Safari never closed the speed menu on Escape: a clicked button does not
    take focus there, so the key never reached the menu;
  - Safari ignores `scroll-padding` when focus moves.
- **The progress scale:** counting paragraphs was off from the reader's
  scale by up to 16.6, 15.4 and 4.6 points on the three test books. Text
  share is within 2.4, 1.9 and 1.3.
- **Whole suite, run 1:** `239 passed`, then `readalong.spec.ts:1348`
  (Chromium) failed. Its audio was paused at 10.54 s of 22.3 s buffered, with
  no error and only a `pause` event: Iteration 47's mystery, a second time.
- **Whole suite, run 2** (final code): `253 passed (5.6m)`. All 27 Chromium
  read-along tests and all 10 audio tests passed. Then
  `readalong.spec.ts:582` (WebKit) failed: "the audio fell 1430 ms behind
  the clock".
- **The same test on `main` (5ab0837):** 1436 and 1435 ms, so not this
  branch. The Mac's default output was AirPods Pro (Bluetooth;
  `system_profiler SPAudioDataType`).
- **The WebKit group without that test:** `6 passed`, then `:662` failed.
  Its events were `pause` at 14.77 s, `play` at 14.77 s, `pause` at 15.08 s,
  but the tracer's `pauses: []`: no script called `pause()`. The browser
  paused it.
- **Mutations, after a control** (`4 passed`; made voice `1 passed`):
  - phone menu not moved left: caught at `readalong.spec.ts:1663`;
  - no fill on leaving the page: caught at `:1590`, and by the made-voice
    test;
  - a skip always plays: caught by the made-voice test;
  - no iPad layout: caught at `:1713`;
  - `withPart` keeping only the first part's chapters: caught, `1 failed`
    (unit);
  - PDF progress one page short: caught, `1 failed` (unit).
**Lesson.**
- **A new test on an untested path finds what reviews miss.** The made-voice
  test failed at once on a bug none of the six reviewers saw.
- **Check a local failure on `main` before blaming the branch.** Look at the
  machine too:
  - with Bluetooth headphones as the output, WebKit's first playback starts
    about 1.4 s late;
  - the system can pause the audio by itself (no `pause()` call: the
    tracer's `pauses` is empty).
- **While Bluetooth headphones are the output, CI is the judge** for the
  read-along timing checks (CI passed them for #84 to #87).

### Iteration 51 · 2026-10-06 14:10 · Step 6b, part 2a (Listen from here on Home) · success (CI to come)

**Hypothesis.** Home can start the book's own audiobook in the same tap if
two things hold. The Listen data is fetched before the tap. And the tap
mounts the session and presses Play before the tap is over: Safari starts
audio only from a tap.
**Action.**
- **`ListenHere` on the Continue card** fetches the Listen data while Home is
  open. When the book's own audiobook is the voice that would play first, a
  tap calls `playHere`.
- **`PlayerProvider.playHere`** mounts the session at once (`flushSync`). The
  session presses Play as it mounts (`useLayoutEffect`).
- **Otherwise the link opens the reader, as before:** while the data is
  still coming, for a made voice (Open unknowns row 10, default (a)), and for
  a click meant for a new tab.
**Evaluation.**
- **A browser test in both engines:** one tap on Home plays there, from the
  reading position. `play()` must be recorded while the click is still
  being handled.
- **Two mutations.**
**Result.**
- **Tests:** the 6b tests `5 passed` in each engine; Home's Continue test
  `1 passed`; the made-voice test `1 passed`.
- **Mutation 1, `flushSync` removed:** the test still passed. React 18
  already applies an update made inside a click before the click's handling
  ends, so `play()` still ran inside the tap. `flushSync` stays, to make
  that timing explicit rather than leave it to React's scheduling.
- **Mutation 2, the session started one tick after the tap**
  (`setTimeout`): caught at `readalong.spec.ts:1622`, with `play()` outside
  the tap.
- **CI round 1** (run 37478603601): `272 passed`, then one failure in WebKit,
  in #88's "paused in the reader, then left". The test moved the audio while
  it played, and WebKit on Linux stood still after the seek, at 14.49 s:
  not paused, no error, the whole file loaded. Nothing in this PR runs in
  that path.
- **The fix:** the test now pauses first, then moves while paused, and waits
  for the bar to light the word. It still catches its mutation (no fill on
  leaving): `1 failed` at `:1591`.
**Lesson.**
- **A mutation that survives can be telling the truth:** here it showed the
  guarantee comes from React itself. Then break the property for real (a
  start after the tap) to prove the test can see it.
- **In WebKit tests, move the audio while it is paused** unless the move
  while playing is what is being tested.

### Iteration 52 · 2026-10-06 15:23 · Step 6c (Think aloud) · success (CI to come)

**Hypothesis.** Think aloud can reuse the reader's voice recorder and the
existing voice-notes route. Then the only new parts are the mini-player's
button and panel, pausing, and knowing where the note goes (the paragraph
being read, and the sentence shown).
**Action.**
- **The recorder** moved to `components/notes/` with its own copy of its
  styles, so the reader looks the same.
- **The session:** `thinkAloud()` pauses and returns the place;
  `saveThought()` posts the note.
- **The bar:** the pill and the panel. At iPad width the controls sit closer
  together, so the title keeps its room.
- **Tests:** a browser test with Chromium's fake microphone, two unit tests,
  and the panel checked in all four looks in both engines.
**Evaluation.** The browser test from the snapshot; two mutations after a
control; unit tests; the panel's screenshots looked at; a review workflow
(three lenses, a skeptic per finding) over 2a and 6c.
**Result.**
- **The Think aloud test:** `1 passed`.
- **Mutations, after a control** (`1 passed`):
  - anchored at the book's start: `1 failed`, the note's place is not the
    paragraph;
  - no pause: `1 failed`, the Play button never appeared.
- **Unit tests:** `Tests 5 passed (5)` in `voice-notes.test.ts`. In a PDF, a
  page's place goes to the page's last paragraph, as the plan suspected.
- **Looked at:**
  - the panel first read `““Indeed?” said Utterson.”`: the sentence's own
    quote mark plus mine. It now shows the sentence as a quotation block
    under a label;
  - at iPad width the title had exactly 150 px against a check of more than
    150. The controls now sit closer, rather than the check being loosened.
- **CI meanwhile (#89):** two WebKit stalls in two runs, both right after the
  audio's position was set (runs 37478603601 and 37484095289). Recorded; the
  job was re-run.
- **Review workflow** `wf_6783e4a9-544` (2a and 6c): running when this was written.
**Lesson.**
- **Look at the words on the screen,** not only the layout: the doubled
  quote mark passed every check.
- **A check that fails by a pixel is a design question, not a threshold to
  move.**

### Iteration 53 · 2026-10-06 16:06 · Step 7 (deploy), and the review of 2a and 6c · success (CI to come)

**Hypothesis.** M14 can go live as it stands (steps 1 to 6b part 2a), with a
backup whose restore is checked. A review of 2a and 6c (workflow
`wf_6783e4a9-544`: logic, looks and server-and-tests reviewers, then a
skeptic per finding) finds what the tests missed.
**Action.**
- **Deploy:**
  - backed up production with `pg_dump` over Railway's SSH (host key checked
    against the ledger's), and restored it into a throwaway Postgres 18;
  - `railway up` from a separate worktree of `main`, because the review's
    agents were reading the main checkout;
  - opened the "M14 verdict" issue (#90).
- **2a's fixes,** on `m14-e2-home-fixes` (this PR; 6c's go in its own PR):
  - **`playsHere`:** one tap plays only an audiobook with something from the
    reading position on, going on from near it;
  - **on mount, Play is pressed only as the button could be;**
  - **a second tap carries on with the book in the player** (`resume`);
  - **Home keeps the Listen data for four minutes;**
  - **a screen reader hears that playing started;**
  - **the racy one-time time check became a bounded wait.**
**Evaluation.**
- The deploy checks: health, sign-in, the M14 routes, and the database's
  counts before and after.
- The review's verdicts.
- Unit tests, the 6b tests in both engines, and two mutations.
**Result.**
- **The deploy:**
  - production before: `1|129|19|0019_annotation_agent` (users, books,
    migrations, latest);
  - backup: 1,129,203 bytes; restore exit 0, with the same counts;
  - Railway: `SUCCESS` at 15:46 UTC;
  - after: health `200`; sign-in `200`; `/library` and `/paths` `307` to
    sign-in; database `1|129|20|0020_readalong_imports`.
- **The review:** 28 findings confirmed, 0 refuted. The high one, a crash on
  Home's one tap when the audiobook has nothing from the reading position
  on, was found by all three reviewers. It cannot happen on the live site
  yet: production has 0 read-along imports.
- **Tests:** `Tests 453 passed | 2 skipped (455)`; the 6b tests `5 passed` in
  each engine; Home's Continue test `1 passed`.
- **Mutations:**
  - no "has something to play" rule: `1 failed` (unit);
  - no same-book branch: caught at `readalong.spec.ts:1647` (a new audio
    element).
**Lesson.** Run the review before merging, not after. Here #89 merged on
green CI while its review was still running, and the review found a
crash. For the next step, open the PR only after the review's fixes.

### Iteration 54 · 2026-10-06 16:19 · Step 6c, review fixes (Think aloud) · success (CI to come)

**Hypothesis.** The review's 6c findings each need a small change in the
mini-player, the recorder, or `sectionForCfi`, and each can be held by a
test.
**Action.**
- **Think aloud is disabled while the next paragraph is prepared; Resume
  only plays.**
- **The recorder reports its state.** The panel then knows when closing
  would lose a recording: Escape, a second press and Go to the page are
  held back (Go to the page says why).
- **Focus and announcements:**
  - focus goes back to the button;
  - after saving, focus moves to Resume or Close;
  - "Saved" is announced.
- **Smaller fixes:** 44 px recorder buttons; the speed menu above the
  panel; the mini-player's status line (errors, loading).
- **In a PDF,** the quote breaks the tie between a page's paragraphs.
**Evaluation.**
- The Think aloud test, rewritten: it moves into the paragraph's fifth
  sentence first, then checks Escape, focus, the held link, the
  announcement and Resume.
- A new failed-start test.
- The unit tests.
- Four browser mutations and one unit mutation, then the screenshots
  looked at.
**Result.**
- **Tests:** the Think aloud test `1 passed`; the 6b tests `6 passed` in
  each engine; the made-voice and Home tests `1 passed` each;
  `npm run check` → `Tests 455 passed | 2 skipped (457)`.
- **Mutations, each caught:**
  - no focus after Save (`toBeFocused`);
  - the link not held back (no warning);
  - Escape closing while recording (the recording gone);
  - no status line (`readalong.spec.ts:1670`);
  - no tie-break (unit: `1 failed`).
- **Two test slips of my own:**
  - Playwright will not click a link marked `aria-disabled`, though a person
    can (`force: true` now, with the attribute checked first);
  - quoting the page's second paragraph could pass without the tie-break
    when a page has exactly two, so the test quotes the first.
**Lesson.** A guard is tested only if the test does what a person would do
anyway: click the dimmed link, press Escape mid-recording. And a quote
taken from the last of the tied paragraphs cannot tell the tie-break from
the old rule.

### Iteration 55 · 2026-10-06 16:42 · Step 6b, part 2b (skips across audiobook files) · success (CI to come)

**Hypothesis.** A 15 s skip can cross into the file before or after with
the same rule as within a file: count only audio that plays. Forward that
means leaving where `follow` leaves the file and starting the next where
playing starts it; back, it means entering the file before at its last
word's end.
**Action.**
- **`skipAcross`** (`lib/player/skip.ts`): pure, with helpers for the
  stretches playing jumps over.
- **The session** loads the other file at that time, and plays on only if
  it was playing.
- **A browser test** with a two-file reading.
**Evaluation.**
- Unit tests, including a sweep that every landing plays on.
- The browser test in both engines.
- A mutation: a skip into another file does nothing.
- `npm run check`.
**Result.**
- **Unit tests:** `Tests 15 passed (15)` in `skip.test.ts`.
- **The browser test found a bug.** After a skip back into the first file,
  the mini-player still showed paragraph 33. Following only notices a
  change of paragraph, and the skip had set the paragraph itself. Now a jump
  away from the reader shows its paragraph at once.
  (Corrected after the review: I first wrote that the landing was "just
  after the last word". The review's numbers put it at 0, the file's start,
  where the time was cut off. Why no word was lit there was not checked.)
- **The 6b tests:** `7 passed` in each engine; the made-voice test
  `1 passed`; `npm run check` → `Tests 460 passed | 2 skipped (462)`.
- **The mutation:** caught at `readalong.spec.ts:1702` (the file stayed the
  first).
- **Two broken mutation runs of mine:**
  - one used a function the file no longer imports;
  - one left TypeScript unreachable code (`never`).

  Both builds failed, and the tests ran on a stale build. The script printed
  "BUILD FAILED", but I read the test lines first.
**Lesson.**
- **Read a mutation run's build result before its test result.** A broken
  build makes the tests meaningless either way.
- **A skip lands where following would not have taken the player,** so
  anything that following normally updates must be set there too.

### Iteration 56 · 2026-10-06 17:29 · Step 6b, part 2b review fixes · success (CI to come)

**Hypothesis.** A review of 2b, run while its PR is held as a draft (the
auto-merge skips drafts), finds what the tests miss before it merges, not
after, as happened with #89.
**Action.**
- **The review:** workflow `wf_71873196-40c`, a logic lens and a tests lens,
  a skeptic per finding.
- **The fixes:**
  - forward carries on through short files, counting another file only up
    to its last word's end;
  - back stops at the earlier file's start;
  - a seek-triggered move to the next file stays paused;
  - a skip into another file saves the reading position;
  - the reviewers' unit cases, and pinned landing times in the browser test.
**Evaluation.** Unit tests and five unit mutants; the 6b tests in both
engines; one browser mutation (the start time ignored); `npm run check`.
**Result.**
- **The review:** 7 confirmed, 0 refuted. The worst: a paused Forward into a
  very short file (an epigraph) landed past where playing leaves it, and
  the next chapter started by itself. Three wrong versions of `skipAcross`
  passed every unit test I had written.
- **Unit tests:** `Tests 17 passed (17)`. Each of the five mutants now fails
  one test: the next file from 0, this file begun at 0, played time ignoring
  jumps, no carry through short files, no stop at the earlier file's start.
- **The 6b tests:** `7 passed` in each engine. The ignored start time is
  caught at `readalong.spec.ts:1713`; before, the test checked only "under
  15 s".
- **`npm run check`:** `Tests 462 passed | 2 skipped (464)`.
**Lesson.**
- **Hold a PR as a draft while its review runs:** this time the fixes landed
  before the merge.
- **My hand-picked cases all had long files.** The reviewers' oracle, which
  simulated playing tick by tick on random layouts, found the short-file
  case at once. For rules about edges, test against a simulation of the
  real thing, not only cases I chose.

### Iteration 57 · 2026-10-06 22:38 · M14 follow-ups V1 (Path picker) and V2 (Go to the page, made voice) · success (CI to come)

**Hypothesis.** Samuel could not find Frankenstein in his own Path's book
picker because of a fault: missing from the list, or adding failing.
**Action.**
- **The live data, read-only:** the page's own query lists 129 books, with
  Frankenstein 26th; his "literature" Path had no titles.
- **A reproduction on a copy of the app:** a Path "literature", a section
  "man and machine", the picker's options listed, then Frankenstein added.
- **V2 first as a test:** "Go to the page" with a made voice (his case).
**Evaluation.** The reproduction; V1's and V2's tests; a mutation for each.
**Result.**
- **No fault in the code.** Frankenstein was in the list ("Frankenstein, by
  Mary Shelley", among 134 options), and adding it worked ("1 section · 1
  available"). It was simply lost among the titles without a file.
- **V1:** the picker now shows "Books you have" first, then "Titles without
  a file yet". `own-paths.spec.ts` `2 passed`. The one-list mutation was
  caught (the two-group check).
- **V2:** it already worked with a made voice: the reader opens playing on,
  the lit word is the bar's word, and its paragraph is on the page in front.
  `audio.spec.ts` `1 passed`. The no-word-lit mutation was caught.
- **`npm run check`:** `Tests 462 passed | 2 skipped (464)`.
**Lesson.**
- **"It did not show up" can mean "I could not see it".** Reproduce before
  fixing: here the fix was findability, not a missing row.
- **A follow-up may need only a test:** V2's behaviour was right.
### Iteration 67 · 2026-10-07 05:22 · Fix from `main`: the Paths list fits a phone with a long one-word Path name (draft #102) · success (CI to come: CI is still not starting jobs)

*Iterations 57 to 65 are on the M14 stack's branches (#97 to #100) and 66 on #101, none on `main` yet.*

**Hypothesis.** One line, `overflow-wrap: anywhere` on the Paths list's name links (`.itemTitle`), stops `/paths` scrolling sideways on a phone when a Path's name is one word wider than the screen, and changes nothing for names that fit.
**Action.** The line in `app/(app)/paths/page.module.css`; in `e2e/own-paths.spec.ts`, at 390 px after it makes "Pneumonoultramicroscopicsilicovolcanoconiosis": `/paths` has no sideways scroll and the name ends inside the screen (commit 7cc1a00).
**Evaluation.** The three pages that show the name, measured on `main`'s build and the fix's, on the database copy after `offline` (it holds that Path), at 390 px (resized and phone-emulated), 375 and 320; the shell phone test on that copy; `/paths` in the four looks on the copy after `home` (names that fit), compared with `cmp`; a control and 2 mutations, each compiled; `npm run check`; the whole suite.
**Result.**
- **Before (`main` c1a2526):** `/paths` `sideways 345px (scrollWidth 735, innerWidth 390)`, 360 px at 375 wide, 415 px at 320; the Path page and its edit page `sideways 0px` at all three. The shell test failed at `shell.spec.ts:126`, `Received: 345`, as V3b found.
- **After:** `sideways 0px` everywhere; the name in 3 lines (308 × 131 px) inside its card; the shell test `1 passed (1.6s)`. Names that fit: the four screenshots `identical`.
- **Mutations:** control `1 passed (1.8s)`; the wrap removed: `own-paths.spec.ts:364`, `Received: 345`; the wrap removed and the list hiding what sticks out: no sideways scroll, but `own-paths.spec.ts:366` (the name past the edge), `Received: 319.96875`.
- **Runs:** `npm run check` `Tests 462 passed | 2 skipped (464)`; whole suite `281 passed (7.6m)`, exit 0.
**Lesson.**
- **Under phone emulation, `window.innerWidth` grows with a page that is too wide** (`scrollWidth 735, innerWidth 735` on `main`), so `scrollWidth <= innerWidth` cannot see sideways scroll there; `clientWidth` stayed 390. The 15 older checks written that way run in ordinary desktop browsers, where it works; new checks use `clientWidth`, as `shell.spec.ts` does.
- **A test that makes unusual data should check every page that shows it.** The long name was checked on its own two pages, not on the list; the shell tests, which do open the list on a phone, run before the name exists.
### Iteration 66 · 2026-10-07 04:57 · Fix from `main`: EPUB uploads unpacked within limits (draft #101) · success (CI to come: CI is still not starting jobs)

*Iterations 57 to 65 are on the M14 stack's branches (#97 to #100), not yet on `main`.*

**Hypothesis.** Unpacking EPUBs with the read-along importer's `safeUnzip`, at 512 MB and 10,000 files, refuses a zip bomb at upload in plain words with nothing saved, and reads real books exactly as before.
**Action.** `EPUB_ZIP_LIMITS` and `unzipEpub` in `lib/library/ebook.ts`, used by `parseEpub` and `extractSections`; test zips built by `zipSync` in `lib/library/test-epub.ts` (commit 2102c1b).
**Evaluation.** Unit tests; a control and 4 unit mutations, each compiled; `npm run check`; the upload browser tests from an empty database; the crafted files sent to the built server; the whole browser suite.
**Result.**
- **Limits from evidence:** the samples hold 24 to 48 files and unpack to 2.06 to 2.27 times their size; the live library's largest EPUB is the sample Frankenstein itself, 271,904 bytes; a 524,030-byte zip made here unpacks to 512 MB.
- **Mutations:** size limit removed `3 failed`; file limit removed `3 failed`; `extractSections` back on `unzipSync` `1 failed`; `parseEpub` as on `main` `3 failed` (it attached the 512 MB claim to the waiting title).
- **Runs:** `npm run check` `Tests 469 passed | 2 skipped (471)`; uploads `148 passed (18.5s)`; the server answered both files `HTTP 200` with the plain line, 129 books before and after; whole suite `281 passed (7.6m)`, exit 0.
**Lesson.**
- **Build a test's input from literal numbers, not from the constant it tests.** My first tests made their zips from `EPUB_ZIP_LIMITS`. With the limit mutated to `Infinity`, `epubWithEntries(Infinity)` died inside the helper ("Too many properties to enumerate"): the test failed for the wrong reason.
- **After switching branches, rebuild before trusting `tsc`.** The control failed `tsc` (exit 2) on `.next/types` left by V5's build (`app/(app)/import/page.js` not found); `npm run build` cleared it.

### Iteration 58 · 2026-10-06 23:17 · M14 follow-up V3a (the Import page; the drop areas removed) · success (CI to come: CI is not starting jobs)

**Hypothesis.** One Import page can take books and your own audiobooks,
with Home's Import going there and no drop areas elsewhere, and the tests
that added books from the Library or Home pass from the Import page.
**Action.**
- **The first run's failure, fixed:** Home says "Your library is empty."
  again; the link to Import is a second sentence (`e2e/auth.setup.ts:17`
  matches the full stop).
- **What the move left unused, removed:** the old Import button (it opened
  the file picker inside Home's drop strip) and the hint's phone-only hiding.
- **The V3a test made real:** it adds a read-along package (.zip) to the
  chosen book on the Import page, checks the book's import list, removes it
  again, and checks the page in four looks (accessibility, fits the screen).
- **The empty Library's text** asked for books with no way to add them
  there; it now links to the Import page.
**Evaluation.** The whole suite from a fresh database (three runs); the V3a
test from the snapshot after `ai`; two mutations, each after a control run;
the screenshots.
**Result.**
- **Run 1:** `1 failed`, `134 did not run`: my new locator
  `getByRole("region", { name: "Your audiobook" })` also matched "Add your
  audiobook to a book". Fixed with `exact: true`.
- **The V3a test, from the snapshot:** failed on the fits-the-screen check:
  the page was 553 px wide in a 390 px screen. The book list's longest title
  set the grid column's width. Fixed (`minmax(0, 1fr)`, `min-width: 0`);
  then `1 passed`.
- **Run 2:** `291 passed (7.6m)`.
- **Run 3, on the squashed commit 72bde33:** `1 failed`, `11 did not run`,
  `279 passed (7.6m)`: WebKit's tint check in the PDF read-along test
  (`share of "opens" tinted: 0.00`), the same failure as Iteration 32, in
  code V3a does not touch; sound on the built-in speakers. The whole
  `readalong-safari` project rerun on the same build: `30 passed (2.7m)`.
- **Mutations** (controls `1 passed`): Home's Import pointing to `/library`,
  caught at `home.spec.ts:108`; the audiobook list with books without a
  file, caught at `uploads.spec.ts:227` (`+ Received + 125`).
- **`npm run check`:** `Tests 462 passed | 2 skipped (464)`.
- **CI for #97 never started:** "The job was not started because recent
  account payments have failed or your spending limit needs to be
  increased" (run 37541928335). Draft PR #98 waits for it too.
**Lesson.**
- **Check a page in the state it reaches after a choice,** not only as it
  first opens: the overflow appeared only with books in the library, which
  the page screenshots (an empty library) never show.
- **Playwright matches names as substrings by default:** "Add your audiobook
  to a book" contains "Your audiobook". Use `exact: true` when one name
  contains another.
- **A CI job that fails in 2 seconds with no steps is not a test result:**
  read its annotation before re-running anything.

### Iteration 59 · 2026-10-06 20:06 · M14 follow-up V3a, review fixes · success (CI to come: CI is still not starting jobs)

**Hypothesis.** The seven problems the review of draft PR #98 confirmed can
each be fixed in a few lines, and each fix can be pinned by a check that
fails without it.
**Action.**
- **Home's Import under the mouse:** the hover keeps the text colour (the
  global `a:hover` colour was the button's own hover background).
- **"Did not finish" during a running upload:** no unfinished rows while
  the page sends, and the upload it has just finished is never one of them.
- **A dropped .zip on `/import`:** not sent as a book; its row says where
  your own audiobook goes. Other files go to the server as before, so the
  server's own messages (and the tests that check them) are unchanged. The
  hidden status line counts only files the server read.
- **"Your audiobook" is an h3 on `/import`** (a `headingLevel` prop; the
  book page keeps its h2).
- **The serif text on `/import` at 18 px on a phone.**
- **Tests:** a refresh check right after the first upload; the approved
  line checked whole; the hover check; the running-upload check (a
  collection toggled during a held upload, its `aria-pressed` the sign that
  the refresh arrived); the .zip drop; the heading level; the text size.
**Evaluation.** `npm run check`; the whole suite from a fresh database;
four mutations, each after a control run of the same test.
**Result.**
- **`npm run check`:** exit 0, `Tests 462 passed | 2 skipped (464)`.
- **The whole suite from a fresh database:** `291 passed (7.7m)` (sound
  on the built-in speakers), the new checks included, the read-along one
  in both engines.
- **Mutations** (scratchpad `mut-v3fix-all.sh`; controls on the unbroken
  build `1 passed` each):
  - the hover's text colour removed: caught at `home.spec.ts:115`
    (`Expected: not "rgb(42, 82, 77)"`);
  - the `progress ? [] :` guard removed: caught at `readalong.spec.ts:350`
    ("An upload from 7 Oct 2026 did not finish" while "Sending the audio");
  - the .zip test made to match nothing: caught at `uploads.spec.ts:288`
    (the message never appeared);
  - `router.refresh()` removed, run from an empty database: caught at
    `uploads.spec.ts:31` (`Expected: 0`, `Received: 1`); the 147 tests
    before it passed, so no other test noticed.
  Each failing run also printed "Test timeout of 30000ms exceeded." after
  its failure (the controls did not); not looked into.
- **CI still starts no jobs:** run 37550128494 (the push of adebd11, 00:05
  UTC on 7 October): all four jobs ended in 2 seconds, "The job was not
  started because recent account payments have failed or your spending
  limit needs to be increased". Nothing merged, nothing deployed.
**Lesson.**
- **A check that something does not appear needs a sign that the cause has
  happened first.** With the fix, a refresh changes nothing visible, so the
  test waits for something else the same refresh brings (the collection
  button's pressed state), then checks "did not finish" is absent.
- **A link styled as a button must set its own hover text colour:** the
  global link hover colour can equal the button's hover background.
- **A whole-page drop target takes drops meant for any part of the page:**
  sort the files by what they are before sending them anywhere.

### Iteration 60 · 2026-10-07 00:40 · M14 follow-up V3b (Import in the sidebar and as a fifth phone tab) · success (CI to come: CI is still not starting jobs)

**Hypothesis.** Import can join the sidebar's Library list (last, after
PDFs) and the phone's tabs (fifth) with the existing navigation parts.
Five tabs should still fit a 390 px phone screen with 44 px targets and no
sideways scroll, with no CSS change beyond the number of columns.
**Action.**
- **The sidebar:** one item after the library's filters, inside the Library
  list (the filters' own list stays filters only).
- **The tabs:** a fifth entry; the tab bar's grid has five columns.
- **The icon:** the arrow Home's Import button draws.
- **Tests** (`e2e/shell.spec.ts`):
  - desktop: Import is clicked like the other links; the Library list's
    order; Import stays current after a book is chosen (`/import?book=…`);
  - phone: five tabs by name; each tab measured (at least 44 × 44, on the
    screen, beside the one before, its label inside it); Import opens its
    page; it stays current with a book chosen.
- **Two old checks found "the link named Import" on Home,** which now has
  two: they look inside the page's main part.
**Evaluation.** `npm run check`; the whole suite from a fresh database; the
tabs measured by a one-off script; the screenshots; mutations after a
control run.
**Result.**
- **`npm run check`:** exit 0, `Tests 462 passed | 2 skipped (464)`.
- **The whole suite from a fresh database** (code of 7f421b2, sound on the
  built-in speakers): `291 passed (7.7m)`.
- **The tabs at 390 px:** each `74.8x55.0`; the widest icon and label
  `38.6` px; `sideways scroll 0px`. For information: `71.8x55.0` at 375 px,
  `60.8x55.0` at 320 px, no sideways scroll at either.
- **Screenshots:** Import last in the Library list (desktop light);
  highlighted on the Import page (desktop dark); five whole labels (phone
  light and dark); the Import tab marked (phone dark); Home's own Import
  beside the account button, above the Import tab (phone light). On a
  1280 × 800 window, "New path" now sits just below the sidebar's visible
  part (the sidebar scrolls).
- **First mutation round, on the database copy after `offline`:** the
  control failed. The phone test's sideways check on `/paths`: `Expected:
  <= 0`, `Received: 345`. A one-off script found the cause: the `/paths`
  list was 704 px wide, held open by a Path the own-paths tests make,
  "Pneumonoultramicroscopicsilicovolcanoconiosis", whose name does not
  wrap there. The base branch (V3a, 66f92e1) on the same copy failed the
  same way (`Received: 345`), so V3b did not cause it. In a normal run the
  shell tests come before own-paths, so no test sees it. Left for its own
  PR (PROGRESS.md, Exact next steps 4b).
- **Second round, on the copy after `home`** (`mut-v3b-round2.sh`):
  - control `1 passed (2.0s)`;
  - the Import tab removed: caught at `shell.spec.ts:129` (`- "Import"`);
  - the grid back to four columns: caught at `shell.spec.ts:147`, "Import:
    beside the tab before it" (`Expected: >= 381.5`, `Received: 8`: the
    fifth tab wrapped to a second row).
- **CI:** opening #99 started run 37552574877; all four jobs ended in 2
  seconds with no steps ("The job was not started because recent account
  payments have failed or your spending limit needs to be increased").
**Lesson.**
- **A database copy taken later in the suite can hold data an earlier test
  never meets.** Here it held a long-named Path, which made a shell test
  fail for a reason older than the change. Run the control first, then
  run the base branch on the same copy before blaming the change.
- **A test that measures something should be broken once on purpose, the
  way it would break in real life:** the four-column grid showed the fit
  check catches a wrapped tab, which a count of tab names would miss.

### Iteration 61 · 2026-10-07 01:41 · M14 follow-up V5 (AI voice narration for an entire book, chosen on purpose) · success (CI to come: CI is still not starting jobs)

**Hypothesis.** Whole-book narration needs no new table. A paragraph is
"saved" when `speakPassage` would serve it again (the same key). A run is
`speakPassage` in a loop: it already saves each paragraph and checks the
spending limits. Only "is a run going on" has to live in the server's
memory. The fake voice is enough to test all of it (Samuel's rule: no paid
voice for a whole book).
**Action.**
- `lib/library/narration.ts`: the summary, with where the limits would
  stop it; a start only with `confirm: true`; the run; Stop.
- The route `app/api/books/[id]/narration`, the panel on `/import`, and one
  sentence added under "How books are heard" (Samuel's words unchanged).
- Tests: 10 unit tests, and a browser test in a Playwright project of its
  own that runs last (`e2e/narration.spec.ts`). Draft PR #100 (base
  `m14-v3b-import-nav`), commit e0393af.
**Evaluation.** `npm run check`; the browser test on the database copy
after `offline`; the whole suite from a fresh database; 12 screenshots
looked at; 7 mutations, after control runs.
**Result.**
- **`npm run check`:** exit 0, `Tests 472 passed | 2 skipped (474)`.
- **Sizing the browser test's book:**
  - 600 paragraphs passed;
  - 1,000 paragraphs printed "Stop pressed 2664 ms after Create, at 644
    saved": too little room left before the run would end by itself;
  - 2,500 paragraphs of 6 characters ($4.50, under the $5 limit) printed
    "Stop pressed 2562 ms after Create, at 357 saved"; the rest took 15,674
    ms. The earlier estimate, 9 ms a paragraph timed through the HTTP route,
    was about twice the real loop's speed.
- **Looking at the screenshots** found two things to change: after a limit
  stop the page still offered Continue (now it says nothing can be made),
  and the stop message repeated the Railway note.
- **Whole suite:** on 30a0766, `1 failed`, `26 did not run`, `265 passed
  (5.6m)`, from a WebKit race in an older test (Iteration 62). On e0393af,
  with three small fixes, `292 passed (8.2m)`. The narration test printed
  "Stop pressed 2661 ms after Create, with 379 of 2,500 paragraphs saved"
  and "134 different counts seen".
- **Mutations:** each caught. Controls `Tests 10 passed (10)` (unit) and
  `1 passed (31.2s)` (browser).
  - Create enabled without the checkbox: `narration.spec.ts:114`
    (`Received: enabled`).
  - A start without `confirm: true`: `:123` (`Received: 202`) and
    `narration.test.ts:258`.
  - Saved paragraphs not skipped: `:159` and `:231`.
  - The estimate counting saved paragraphs: `:110` and `:162`.
  - Stop ignored: `:193`. At first it was caught only by a 30 s timeout;
    the test now checks that the voice is not asked again.
  - The limits without what has been spent: `:140` and `:215`.
**Interpretation.** The design held. No migration was needed. "Nothing paid
twice", the progress, and the stop at a limit all come from what
`speakPassage` already does. The browser test's weak point is time: Stop
must land while the run is still going on, so the test prints how far the
run had got.
**Lesson.** Time the code path a test runs, from inside the test, and
print the margin. The per-request timing was twice the in-process loop's,
so the first sizing left Stop a third of the run.
**Next experiment.** Review #100 as a draft. When CI runs, commit CI's
renderings of `import-*`, after #98's and #99's.

### Iteration 62 · 2026-10-07 01:21 · First full run of V5: a WebKit failure in an older test · flake (not V5's; evidence given)

**Hypothesis.** The whole suite passes on 30a0766 (V5's first commit).
**Action.** `rm -rf .data/e2e .data/e2e-files e2e/.auth && npx playwright
test --ignore-snapshots`, 01:16 to 01:21 UTC. The sound was on the
built-in speakers.
**Result.** `1 failed`, `26 did not run`, `265 passed (5.6m)`. In WebKit,
`readalong.spec.ts:330` ("a two-part upload is announced once, can be
cancelled…") failed: "page.goto: Navigation to
"http://127.0.0.1:3100/library?new=collection" is interrupted by another
navigation to "http://127.0.0.1:3100/books/…"". The 26 that did not run
were the tests after it, the narration test among them.
**Interpretation.** Most likely a race inside the test. It presses Remove
on the book page and waits for the status line ("Removed Long reading…").
At that moment `settle()` also starts a refresh of the book page
(`router.refresh()`). The interrupting navigation went to that page's
address, so the refresh was most likely still going when the test opened
`/library`. V5 does not touch the book page, this test, or the upload.
The `readalong-safari` project alone, on the same build from the copy
after `offline`, passed: `30 passed (2.7m)`. The full run on e0393af
passed too. The ledger and the logs have no earlier sighting.
**Lesson.** None new: "not caused by this PR" still needs evidence, here
the project alone on the same build, then a full run.
**Next experiment.** If it happens again, have the test wait for the book
page's refresh to finish (its request's answer) before opening the next
page.

### Iteration 63 · 2026-10-07 02:13 · Review of V5 (draft #100) · failure (seven problems the tests had passed)

**Hypothesis.** Draft #100 (V5, whole-book narration) is ready.
**Action.** A review workflow read V5's diff (commit e0393af), with
reviewers and a skeptic per finding, some testing their claim on scratch
copies (fake voice only).
**Result.** Seven findings confirmed, all in V5's own files; none in V3b
(#99), so V3b is unchanged:
1. two runs at once for one reader (another voice or book) could together
   pass the spending limits, and the page showed and stopped only one;
2. "press Listen: it plays for free" was false in a voice other than the
   first on offer: Listen opened in the first voice;
3. checks slower than a second were all dropped, so the progress froze
   (the reviewer's harness: no "Done" at 1,100 ms per check);
4. choosing another book or voice during a run hid its progress and Stop;
5. the Voice list followed the server's last answer, so Create could start
   the voice just left;
6. keyboard focus was lost when a run ended by itself;
7. the Import page's opening line left out the whole-book choice.
**Interpretation.** The tests covered the happy path and the money rules
one run at a time. Every finding involves two things at once: two runs, a
slow answer and the next tick, the person's choice and the server's answer.
**Lesson.** See Iteration 64.
**Next experiment.** Fix each with a check that fails without it.

### Iteration 64 · 2026-10-07 03:04 · V5 review fixes · success (CI to come: CI is still not starting jobs)

**Hypothesis.** Seven small fixes in V5's files close the seven findings,
each caught by a check that fails without it, and nothing else breaks.
**Action.** Commit bfed0b3 on `m14-v5-whole-book`: one run per reader
(`narration.ts`); Listen opens in the first voice a paragraph is saved in
(`listen.ts`, `audio.ts` `firstStoredTrack`, `session.ts` `firstVoice`);
the panel waits for each check (up to 15 s), locks its lists during a run,
shows only the chosen voice's figures (with Try again), and moves focus to
the outcome (`WholeBookNarration.tsx`); the opening line. Found while
fixing: a refused Create's reason was wiped by the next check; it stays now.
**Evaluation.** `npm run check`; the narration test on the database copy
after `offline`; 3 unit and 6 browser mutations after controls; the whole
suite from a fresh database.
**Result.**
- `npm run check`: exit 0, `Tests 475 passed | 2 skipped (477)`.
- Narration test: `1 passed (36.9s)`; "Stop pressed 2680 ms after Create,
  with 373 of 2,500 paragraphs saved".
- Unit mutations (control `Tests 35 passed (35)`): one-run rule removed,
  `narration.test.ts:197`; Listen back to the first voice, `listen.test.ts:113`;
  `firstVoice` ignoring the saved track, `session.test.ts:54`.
- Browser mutations (control `1 passed (36.7s)`): checks dropped again,
  `narration.spec.ts:259` (`Received: "Making the narration in the
  background."` after 15 s); the old voice's figures shown, `:136`
  (`Expected: 0`, `Received: 1`); lists not locked, `:201`; no focus after
  the end, `:264` (`Received: inactive`); the refusal wiped, `:172`; Listen
  in the first voice, `:357` (`Expected: "fake-ben"`, `Received: "fake-ada"`).
- V5's own five unit mutations, again on the fixed code: control `Tests
  11 passed (11)`; 5 of 5 still caught.
- Whole suite: `292 passed (8.3m)` on bfed0b3, 02:55 to 03:04 UTC. Also on
  9dc7563, the same without a one-line style folded in later (a locked
  list shows no hover): `292 passed (8.3m)`.
**Interpretation.** Each fix is pinned by a check that fails without it.
Left open for Samuel (Open unknowns row 12): paid paragraphs one at a time
server-wide, which would close the remaining overshoot (at most one
paragraph per other caller paying at the same moment).
**Lesson.** A page that asks again and again needs three rules: never
replace a request still on its way (test with a route slower than the
interval); show and send only answers about what the person chose now;
keep an action's error apart from a check's, or the next check wipes it.
**Next experiment.** When CI runs: the stack in order (#97, #98, #99,
#100), with CI's renderings of `import-*`.

### Iteration 65 · 2026-10-07 04:22 · V5: whole-book narration for the library's owner only · success (CI to come: CI is still not starting jobs)

**Hypothesis.** One rule, checked in the narration route (POST and GET)
and on the Import page, keeps whole-book narration to the library's owner
(the admin), while Stop stays open to a book's owner; a test fails without
each check.
**Action.** Commit 44aa04c on `m14-v5-whole-book`: `mayNarrateWholeBooks`
and `OWNER_ONLY` in `narration.ts`; the route answers anyone else 403
before looking at the book, and Stop answers them 204 without the figures;
the page shows them the one line and leaves the whole-book choice out of
its opening line and "How books are heard". Tests: a route test (the
repo's first; the real handlers, with `vi.mock` for the signed-in user,
the database, the voice and the file store); the browser test signs Grace
in, and she adds an EPUB of her own first.
**Evaluation.** `npm run check`; the narration and uploads browser tests
on the database copy after `offline`; 4 unit and 2 browser mutations after
controls; the whole suite from a fresh database.
**Result.**
- `npm run check`: exit 0, `Tests 478 passed | 2 skipped (480)`.
- Narration test `1 passed (40.6s)`; the Import page test `1 passed (3.9s)`.
- Unit mutations (control `Tests 14 passed (14)`): POST's check removed,
  `route.test.ts:72` (`expected 202 to be 403`); GET's, `:78`
  (`expected 200 to be 403`); Stop giving a reader the figures, `:82`
  (`expected 200 to be 204`); everyone may narrate, `:72`.
- Browser mutations (control `1 passed (39.4s)`): POST's check removed,
  `narration.spec.ts:368` (`Expected: 403`, `Received: 202`); the page's
  check removed, `:353`.
- Whole suite: `292 passed (8.4m)` on 44aa04c, 04:12 to 04:21 UTC.
**Interpretation.** The check that proves the rule uses Grace's own EPUB:
with the route's check removed, her start there went through (202, and a
run began with the fake voice). On the owner's book, the check that a
book is your own would still have refused her (404), whatever the role.
**Lesson.** Test a permission where it is the only thing in the way: give
the person something they could otherwise use (here an EPUB of her own),
so a refusal for another reason cannot hide a missing check.
**Next experiment.** When CI runs: the stack in order (#97, #98, #99,
#100). If Samuel answers row 13 with yes: take the check out, with the
tests that pin it, in a small PR.

### Iteration 68 · 2026-10-07 06:51 · Back 15 s into a chapter that was not loaded (draft PR from `m14-back-into-chapter`) · success (CI to come: CI is still not starting jobs)

(Iteration 66 is on #101's branch, `m13-epub-safe-unzip`, and 67 on #102's, `m14-paths-phone-wrap`: three branches from one log.)

**Hypothesis.** A "before" mode on the parts route, plus one rule in the skip ("back past the first paragraph loaded, with more of the audiobook before it: load the part before, then ask again"), makes Back 15 s land exactly where it lands with everything loaded, in both engines, paused or playing; a test fails without each piece.
**Action.** On `m14-back-into-chapter`, from #100's head f83fd83:
- `?before=<position>` on `…/readalong/[importId]/reading` (`readingPartBefore`: the nearest paragraphs first, the same size rule as a forward part, back in reading order, with `earlier`, where the part before ends); the first part says `earlier` too.
- `skipAcross(…, earlier)` answers "earlier" when the landing would be before the first paragraph loaded (in its own file, or the file before); without the flag it never does, so its type for the older callers is unchanged.
- The session (`lookBack`): one fetch, the skip computed again from the values taken at the press, then the part added at the front and the list's index moved on in one `flushSync`, then the landing through a ref to the newest `land`.
- Tests: 5 skip unit tests (one a sweep that compares every answer on a partly loaded list with the answer on the whole list), `withEarlier`, the part before in `audio.test.ts`, a route test, and 3 browser tests.
**Evaluation.** `npm run check`; the M14 read-along tests and the whole read-along file in Chromium and WebKit, from the database copy after `offline`; 6 unit and 4 browser mutations after controls; the whole suite from an empty database.
**Result.**
- `npm run check`: exit 0, `Tests 489 passed | 2 skipped (491)`.
- The sweep: `SWEEP asked=2701 wrongBefore=2069`. Without the change, 2,069 of its back skips landed somewhere else than with everything loaded; with it, every answer is either "earlier" or exactly the fully loaded one.
- Browser: M14 tests `10 passed (18.5s)` (Chromium) and `10 passed (34.1s)` (WebKit); the whole read-along file `33 passed` in each (2.4 and 2.8 minutes).
- **Three wrong turns on the way, each found by a run:**
  - My first fixture (Jekyll paragraphs 30-32 in the first file) failed inside `importReading`: the importer placed only the words from "ashamed" on (in paragraph 31), and put "said he. “I" into paragraph 12. A scratch unit test against the importer showed the same for 29-32 and 31-32, and that 40-57 | 58-69 is placed word for word; the tests now use that.
  - The same-file test asked for nothing: the reader starts Listen at the first paragraph on its page, and 66 to 68 were on 69's page, so 68 was already loaded. The tests now start from Home's "Listen from here" at a reading position set through the API, and check the Listen data they were given.
  - My first sweep counted forward skips too, from times before the first paragraph loaded. The player cannot be there while more is known to be before (it fetches first), so the sweep covers back skips only.
- Mutations: the required two are caught in unit and browser tests, in both engines (the before mode returning nothing: `readalong.spec.ts:1806`; the skip ignoring it: no request, `:1782`). **One mutation survived the two boundary tests:** not moving the list's index on after adding the part. A load into another file sets the index anew, so only the same-file test (a seek, `:1868`) catches it.
- Whole suite, from an empty database: `298 passed (8.4m)`, exit 0 (06:42 to 06:50 UTC).
**Lesson.**
- **Compare with the fully loaded answer, not with landings I chose.** Iteration 56's lesson, applied from the start: a sweep against the whole list is the oracle, and it also showed the rule errs on the safe side: in the sweep, 632 of its 2,701 asks were not needed (the answer without the part was already right), and none of its answers is wrong.
- **A test that needs an exact first paragraph must not start from the reader's page.** The reader starts where its page starts; Home's "Listen from here" starts at the reading position.
- **Check a new fixture with the importer before building a browser test on it** (a scratch unit test takes seconds).
- **Read which test catches each mutation.** A mutation that survives all but one test shows what that one test alone protects.
**Next experiment.** When CI runs: this PR after #100, its four checks green.

### Iteration 70 · 2026-10-07 09:30 · Review of Back-into-a-chapter (#103) finished by hand, one fix; #104 reviewed clean · success (CI to come: CI is still not starting jobs)

(Iteration 69 is on #104's branch, `m14-flake-s4-diag`.)

**Hypothesis.** The one review finding on #103 (the request for the part before has no time limit) is real, and a time limit plus a fallback counted from where the audio is by then fixes it without changing where a successful Back lands; a browser test that never answers the request fails without each piece.
**Action.** Workflow `wf_6467c1e9-e7c` had died on the session limit after its reviewer returned one finding on #103 and before any review of #104. Rather than resume it (a verify agent and a fresh review: 1 to 2 M tokens), both were finished by hand:
- #103's finding, checked against `lookBack` in `components/player/ListenSession.tsx`: confirmed. The fetch had no `AbortSignal`; while it hung, `skip` ignored Back and Forward (`lookingBack` true), a voice change did not clear the flag (cleared only in `finally`), and a late failure fell back to the skip counted from the press (`from.t`), so the player could land far more than 15 s back.
- The fix, on `m14-back-into-chapter`: `LOOK_BACK_MS` = 8 s (`lib/player/session.ts`) with an `AbortController`; failed or given up, the skip is counted again from where the audio is by then within what is loaded (`skipLoaded`, through a ref to the newest one); `lookingBack` holds the voice generation it was started in, so `skip` waits only while `lookingBack.current === generation.current` and a change of voice frees the buttons at once.
- One browser test (`readalong.spec.ts`, "the part before never comes"): `page.route` holds the `?before=` request forever; Forward is ignored during the wait; past the limit the first time set is 15.00 s back from the time just before it (the setter is hooked to record both), inside paragraph 69; then Forward works again, 15 s on.
- #104's diff (`git diff origin/m14-v5-whole-book...origin/m14-flake-s4-diag`): `e2e/readalong.spec.ts` only, plus the two ledgers. It adds a `test.beforeEach` that records every audio request, and makes `playUntil` print them with a one-line reading of the player when the audio stands still. No `expect` changes; no test's assertions change. One note, not a fix: `test.beforeEach(({ page }) => …)` makes every test in the file open the default page, including the two that make their own context (`:400`, `:960`): one extra page each, no change in behaviour.
**Evaluation.** `npm run check` on #104's head and on the fix; the four "back into" browser tests in Chromium and WebKit; three mutations after a control; the whole read-along file in both engines. Sound on the built-in speakers.
**Result.**
- #104's head 3c52315: `npm run check` exit 0, `Tests 478 passed | 2 skipped (480)`.
- The fix: `npm run check` exit 0, `Tests 489 passed | 2 skipped (491)` (unchanged: no unit test touched). Browser, the four "back into" tests: `4 passed (14.5s)` in Chromium, `4 passed (19.2s)` in WebKit; the new test 10.3 s and 11.6 s (it waits through the 8 s limit).
- Mutations (`mut-lookback.sh`: break, build, run the new test in Chromium, restore; `cmp` against the backup afterwards: identical; the `git diff` checksum comparison was void because the ledger was edited meanwhile): control `1 passed (10.2s)`; all three caught: no time limit (60 s instead of 8) → `readalong.spec.ts:1923`, `Received: 0` after "Timeout 23000ms exceeded" (24.0 s); the fallback counted from the press (the old answer) → `:1926`, `Expected: 15`, `Received: 23.000638`; other skips not held during the wait → `:1920`. A failed run then waited another 30 s ("Test timeout of 30000ms exceeded" after the assertion). I first blamed the held request, released only at the test's end, and moved the cleanup into a `finally`; measured afterwards (a failing run 43 s of wall time against 14 s passing, before and after the change; the older paused "back into" test, which holds nothing, 39 s against 5 s), the 30 s is Playwright saving the failure trace (`trace: "retain-on-failure"`) and hitting the 30 s limit: the `trace.zip` left behind is truncated. The `finally` stays as tidiness; the 30 s is a separate, older cost of any failing read-along test.
- The whole read-along file: Chromium `34 passed (2.6m)`, WebKit `34 passed (3.0m)` (33 before, plus the new test: 9.3 s and 11.6 s), from the database copy after `home`.
- On the final text (the cleanup in a `finally`): `npm run check` exit 0, `Tests 489 passed | 2 skipped (491)`; the four "back into" tests `4 passed (14.3s)` in Chromium (the new test 10.3 s) and `4 passed (20.9s)` in WebKit (11.3 s).
**Lesson.**
- **A workflow that died mid-review is cheaper to finish by hand than to resume** when its journal already holds the findings: the finding was one paragraph to check against forty lines of code.
- **A wait that holds buttons needs a limit, and the thing it waits for must be counted at landing time, not press time, when it fails.** The press-time rule is right for a quick answer (the user asked for 15 s before what they heard then) and wrong for a late one; the limit makes "quick" true.
- **Hook the setter, record both times.** Recording `[currentTime before, value set]` on every `currentTime` set made the assertion exact (15.00 s) instead of a tolerance on a polled reading.
- **A claim about a failure path needs a failing run after the change, not before.** The `finally` "fix" for the 30 s was written into both ledgers from the failing run before it; one timed run after it (and one of a test that could not have the suspected cause) showed the cause was elsewhere.
**Next experiment.** When CI runs: #103 after #100, its four checks green; the new test on CI's WebKit (it plays on for 8 s with no seek: not the stall pattern seen so far).
### Iteration 69 · 2026-10-07 07:32 · WebKit stall on CI: the log says which audio requests were made and answered (draft PR from `m14-flake-s4-diag`) · success (shown on forced failures; CI to come: CI is still not starting jobs)

(Iteration 66 is on #101's branch, 67 on #102's, 68 on #103's (`m14-back-into-chapter`). This branch starts from #100's head, f83fd83, which has none of them.)

**Hypothesis.** Every read-along test can record each request its page makes for audio, from the test's side, and `playUntil` can print that record when it gives up. Then the next WebKit stall on CI will show whether the player asked for more audio after its position was set, and whether the server answered. No check needs to change.
**Action.** On `m14-flake-s4-diag`, code commit e181935, `e2e/readalong.spec.ts` only:
- a watcher set up before each test in the file (`test.beforeEach`). It listens to Playwright's `request`, `response`, `requestfinished` and `requestfailed` events, for media requests and the two audio link shapes;
- `describeRequest`: one line per request;
- `readPlayer`: one line reading the player's state;
- `playUntil` prints both, plus when the audio's time last moved (`stillSince`), and the stretches loaded, played and seekable.

`watchAnswers` and every check are unchanged: `git diff f83fd83 -- e2e | grep -E '^[-+][^-+].*expect\('` prints nothing.
**Evaluation.**
- `npm run check`.
- The whole read-along file in both engines, from the database copy after `offline`.
- A forced failure, never committed: every request for the reading's audio after the first is held, never answered. Run in both engines on this change, and in WebKit on the base f83fd83 for comparison. Each forced edit was type-checked (`tsc` exit 0), then reverted; the file's checksum was the same afterwards (`fc3c2334…` on the code before the fix below, which was amended before any push; `1774a972…` on e181935).
**Result.**
- `npm run check`: exit 0, `Tests 478 passed | 2 skipped (480)`.
- Read-along file on e181935: `30 passed (2.4m)` in Chromium, `30 passed (2.7m)` in WebKit (sound on the built-in speakers).
- **WebKit, forced, on e181935** (the new part of the report):
  ```
  playUntil: the player is stopped by a media error (code 4: the audio could not be loaded, or is not supported). Its requests for audio (2), oldest first, times since the test began; gave up at 46.30 s; the page's clock (frames, stillSince) began at 0.62 s:
    1. audio/0 bytes=0-1: asked at 1.32 s; answered 206 bytes 0-1/185644, 2 bytes, at 1.32 s; finished at 1.32 s
    2. audio/0 bytes=0-185643: asked at 1.33 s; no answer; failed at 19.37 s (cancelled)
  ```
- **Chromium, forced.** Its first wait passed: the first request was answered in full, and Chromium needed no other. The test then opens the reader again for its screenshots and waits for 0.68 s. That is the wait that hung in CI run 37484095289, and here it hung too, with the page's own recorder off (a new page). The report still listed both requests, across the two pages:
  ```
  playUntil: the player is not paused but short of data (readyState 0): it waits for audio; its network is loading. Its requests for audio (2), oldest first, times since the test began; gave up at 55.98 s; the page's clock (frames, stillSince) began at 10.69 s:
    1. audio/0 bytes=0-: asked at 0.86 s; answered 206 bytes 0-185643/185644, 185644 bytes, at 0.87 s; finished at 0.87 s
    2. audio/0 bytes=0-: asked at 10.99 s; no answer
  ```
- **The base's report for the same forced failure** (WebKit, f83fd83): only the player's state (`"readyState":0,"networkState":3,"error":{"code":4,"message":""}`, its events), no requests, no reading.
- **One wrong turn, found by the first forced run.** My first reading line said "it waits for audio", while the element had stopped with media error 4. WebKit had given up on the held request after 18 s (`failed at 19.43 s (cancelled)`). The reading now checks for an error first (`readPlayer`); the commit was amended before any push.
- **Found on the way, not changed here:** `lib/library/questions.test.ts` failed 3 of 10 runs (`npx vitest run lib/library/questions.test.ts`). It is unchanged since #20 and untouched by this branch: two marks made in the same millisecond come out in either order. PROGRESS.md, Exact next steps item 7.
**Interpretation.** On the laptop, the report tells apart "asked, no answer", "asked, gave up (cancelled)" and "answered in full". Not shown: what Linux WebKit (GStreamer) does at CI's stall. Only the next stall on CI can show that.
**Lesson.**
- **A report must outlive what it reports on.** The page's own recorder was gone in two of the three CI stalls, because the test had opened the page again. The request record lives in the test, so it survives.
- **Force the failure before trusting a report.** The first forced run found a misleading line that reading the code had not.
- **Check the plan against the code before building from it.** The plan's S4 step had merged (#84), and its check still passes on CI. The new stalls are another pattern.
**Next experiment.** When CI runs again, read `playUntil`'s report at the next WebKit stall, and choose the fix by what it shows:
- no request after the position was set: WebKit never asked;
- "no answer": the server;
- "finished" or "still arriving": the audio was sent and WebKit did not use it.

### Iteration 71 · 2026-10-08 22:12 · Account page (B4) · success (CI screenshots still to refresh)

**Hypothesis.** A signed-in person can change their password and sign out of every other browser from `/account`. An admin can disable a reader (not themselves) on Invite, which sets `disabledAt` and deletes that person's sessions, and can enable them again. A new API token stops working 90 days after it is made; a token that already exists gets the same 90 days from when it was made. The checks that already pass stay green.
**Action.** Branch `m14-account` from `main` `077c3a0`. Migration `0022_api_token_expiry` (a script that changes the database layout) adds `expires_at` and has a reverse step. The page is linked from the account menu on the phone and from the sidebar on a desktop. Screenshots were not updated on this Mac.
**Evaluation.** `npm run check`. Then `npx playwright test --project=shell --ignore-snapshots`, which builds the app and runs the four looks (including the accessibility check), the join-the-library flow, and the shell. `--ignore-snapshots` so this Mac's pixels are not treated as the reference images.
**Result.**
- `npm run check` exit 0. `Tests 543 passed | 2 skipped (545)`.
- Playwright: `172 passed (40.7s)`. The Account page had no accessibility violations in the looks that printed (`phone-dark`, `desktop-light`); the run as a whole passed, so the other two looks did too. The shell opened Account and Invite. A reader opened Account.
- The migration test: a token made at `2026-10-04T00:00:00Z`, then the new migration, expires at `2027-01-02T00:00:00.000Z` (90 × 24 hours). Going backwards drops the column.
**Lesson.** The screenshot projects run right after setup, when the only account is the owner, so Invite's reference image shows "No readers yet." The shell project runs after the flow that invites Ada, so that test can look for "Disable Ada Lovelace". Those are two different moments in the same database. Do not assert the empty list from the shell.
**Next experiment.** CI's browser job will fail the screenshot comparison once. Copy CI's renderings into `e2e/__screenshots__`, look at Account in the four looks and at the pages whose sidebar or text changed, and push. Do not deploy until a backup of the live database is taken: migration 0022 runs when the server starts.

### Iteration 72 · 2026-10-08 22:40 · Account screenshots from CI · success (behaviour tests still to run)

**Hypothesis.** The first browser job fails only because the reference images are the old pages. CI's new images show Account, a Readers section, a 90-day sentence, and an Account link in the desktop sidebar, with nothing else moved.
**Action.** Run 37852607386. `zsh .claude/skills/merge-train/scripts/refresh-screenshots.sh 37852607386` copied 36 images. Looked at Account in all four looks, Invite and Agent access on the phone and the desktop in both colours, Home on the desktop in the light colour, and the design page on the desktop in the light colour.
**Evaluation.** The attempt log: 36 failed, 101 passed, 99 did not run. Every failure is `toHaveScreenshot`. Account had no image yet. The other failures are pixel differences. Lint, Postgres, and the ledger check passed.
**Result.** The images match the page. Account has Change password and Sign out of other sessions. Invite has Readers and "No readers yet." (the screenshot projects run before anyone is invited). Agent access says a token works for 90 days. The desktop sidebar shows Account between Your data and Invite. The phone tab bar covers the last lines of a full-page image the same way it already does on other phone pages. The design page is 2 pixels shorter; the page itself is intact, and the difference is the new sidebar link.
**Lesson.** A link added to the desktop sidebar changes every signed-in desktop reference image. On a phone the sidebar is hidden, so only a page whose own text changed needs a new image.
**Next experiment.** Push these images. The next browser job runs the behaviour tests that did not run (99 of them). Merge only when the four checks are green. Do not deploy until a backup is taken.

### Iteration 73 · 2026-10-08 22:36 · Account pull request merged · success

**Hypothesis.** With the reference images from run 37852607386, the second browser job passes the screenshot comparison and the behaviour tests that were skipped, and the four checks go green.
**Action.** Pushed commit `361816e`. Run 37853536318. Did not deploy.
**Evaluation.** `gh pr checks 117` after the run, then `gh pr view 117 --json state,mergedAt,mergeCommit`.
**Result.** All four checks passed. Browser tests 8 min 37 s, lint 7 min 22 s, Postgres 1 min 0 s, the ledger check 15 s. Auto-merge squashed the pull request at 2026-10-08 22:35 UTC. The commit on `main` is `de68330`. The live site was not deployed. Health on the live site was last read as commit `8f8a1a8` before this merge.
**Lesson.** The first red browser job was the screenshot comparison. The second run, with CI's own images, went green, including the behaviour tests.
**Next experiment.** A later session takes a backup of the live database, then deploys `main` `de68330`. Migration 0022 runs when the server starts, so the backup comes first. Do not start a whole-book narration.

### Iteration 74 · 2026-10-09 09:17 · One page or Two pages · success

**Hypothesis.** One saved choice, One page or Two pages, can drive both a PDF and a reflowable book. The default stays one page. On a wide window, Two pages shows two pages and the words can be selected. A 390-pixel-wide window stays on one page. Scroll stays one column. The choice survives a reload and applies to the next book. The Spine fold is not in this change.
**Action.** `pages` on the device settings (`neolibrary.reader.v1`), default `one`. A reflowable book sets `max-column-count` to `2` only when the book is showing pages and Two pages is chosen. A PDF opens with spread `landscape` for Two pages and `none` for One page, and reopens on the same page when the choice changes. `npm run check`. Playwright project `reader` on a fresh database, then the two-pages test again after the picture loop was fixed.
**Evaluation.** `npm run check` at 05:14:53 local: lint and types clean, `Tests 546 passed | 2 skipped (548)`, exit 0. `npx playwright test e2e/reader.spec.ts --project=reader --ignore-snapshots` on a fresh database: `181 passed, 1 failed` (1.6m). The failure was the PDF picture loop: Next was pressed before the pages were drawn, so a four-page PDF walked to its last single page (`100% read`) and then stayed on one page. After the loop waits until a page is drawn, `npx playwright test e2e/reader.spec.ts --project=reader --grep "two pages is a reading setting" --no-deps --ignore-snapshots` → `1 passed (4.7s)`. Pictures: EPUB and PDF, desktop and phone, light and dark, plus the settings panel. A later isolated rerun of "a book opens on one page" failed only because that leftover database already contained Facing Pages (`Already in your library`). That test had passed in the fresh-database run.
**Result.** The hypothesis held on the checks above. A wide window shows two pages for the EPUB and for the PDF. A 390-pixel-wide window shows one. The words on the pages that are showing can be selected. The choice is still Two pages after a reload, and the next book (the PDF) opens in that mode.
**Lesson.** Wait until a PDF page is actually drawn before pressing Next. Pressing it while the count is still zero turns a page that is not on screen yet. Also, Playwright 1.56.1 ignores `timeout` written on the test itself; the time limit has to be set on the group with `test.describe.configure`.
**Next experiment.** After this pull request merges, branch `pdf-spine` builds the Spine fold. Corner waits. Do not restart port 8733. Do not deploy.

### Iteration 75 · 2026-10-09 10:13 · Review of One page / Two pages · success

**Hypothesis.** The six review findings are real, and fixing them keeps a tall window on the page it is showing. A late report from a renderer that has already been closed does not replace that page. A failed reopen can be tried again. The one-page check still runs when the PDF is already in the library. Scroll is judged by the layout, not by the button's attribute.
**Action.** foliate-js is only installed, so `scripts/patch-foliate-fxl.mjs` rewrites the two spots in `fixed-layout.js` on install and before dev and build. The reader rewrites a one-page event to the page on screen, swallows a relocate from the closed renderer, and records the opened spread only after the book has opened again. `fixedBook`, `reopenGen`, and `alive` are gone. `openSpread` and `heldCfi` stay: without them Issue 3 cannot hold. The one-page test uses `openFacingPdf`. `sidesShowing` reads the document's `column-width`.
**Evaluation.** `npm run check` at 05:59:21 local: `Tests 548 passed | 2 skipped (550)`, exit 0. Then `npx playwright test e2e/reader.spec.ts --project=reader --no-deps --grep 'a book opens on one page|two pages is a reading setting' --ignore-snapshots` on the leftover database.
**Result.** `2 passed (6.2s)`. The one-page test was 1.1s (Facing Pages already on the shelf). The two-pages test was 4.7s, including Scroll as one column and a 390×844 reload that stays on leaf 1. An earlier fresh-database run passed the one-page test in 1.6s (the upload). In that run the two-pages test failed only because a width span called one scrolled column two columns.
**Lesson.** Do not edit `node_modules` and call it done. And do not treat the width of a scrolled column as a second column.
**Next experiment.** Leave this pull request open until the four GitHub checks are green, then merge. After that, branch `pdf-spine` from `origin/main`. Do not build the fold here. Do not restart port 8733. Do not deploy.

### Iteration 76 · 2026-10-09 10:34 · Second review of One page / Two pages · success

**Hypothesis.** The reader does not need to build a PDF address. The patched viewer already names the page on screen. Dropping an address for a page that is not showing is enough, and the tall-window reload still opens leaf 1.
**Action.** Deleted the rewrite in the relocate handler. `heldCfi` and `pdfDocsOnScreen` stay. No helper. The page-count check's renderer type was missing `localName`, which stopped `npm run build`, so that property is on the type. The measure is unchanged.
**Evaluation.** `npm run build` after the type fix: TypeScript finished in 1360ms, exit 0. Then `npx playwright test e2e/reader.spec.ts --project=reader --no-deps --grep 'a book opens on one page|two pages is a reading setting' --ignore-snapshots` on the leftover database, against a server built from this change.
**Result.** `2 passed (6.4s)`. One page 1.4s. Two pages 4.5s, including the 390×844 reload that stays on leaf 1.
**Lesson.** Do not keep a second writer of a fact the patched viewer already reports. A type the build checks has to name every property the test reads, or CI fails before the browser starts.
**Next experiment.** Leave this pull request open until the four GitHub checks are green, then merge. After that, branch `pdf-spine` from `origin/main`. Do not build the fold here. Do not restart port 8733. Do not deploy.

### Iteration 77 · 2026-10-09 12:49 · Spine fold on two PDF pages · success

**Hypothesis.** A click can fold two PDF pages on a straight crease, the words stay readable, and a drag that selects words does not turn the page. A white line on white paper is not enough to see the crease.
**Action.** The sheet math is in `lib/reader/spine.ts`. The reader draws the fold as strips of the page pictures, then a soft shadow on the page the sheet uncovers. The test book has different words on the left, middle, and right of each page. The first halfway picture (title Spine Fold, words only at the top left) looked like a flat pair. The second (title Spine Fold Sheet) showed the crease, and the drag missed because it started in a gap between short words. The third book, Spine Fold Line, puts one continuous line of words on the drag path.
**Evaluation.** `npx vitest run lib/reader/spine.test.ts lib/reader/pdf-book.test.ts` at 12:44 local: `Test Files 2 passed (2)`, `Tests 4 passed (4)`, exit 0. `npx tsc --noEmit` and eslint on the reader files: exit 0. First browser run, `/tmp/spine-pw3.log`: `1 failed`, `PW_EXIT:1`. The drag left `selectedWords` empty (reader.spec.ts:732). Second browser run, `/tmp/spine-pw4.log`: `2 passed (10.8s)`, the fold test `4.2s`, `PW_EXIT:0`. Looked at `screenshots/reader-spine-mid-desktop-light.png` and the dark halfway picture: a vertical shadow splits the right page, Leaf 4 on the gutter side and Leaf 5 on the outer side, words reading the right way. The phone picture is one page (Leaf 6) with no fold.
**Result.** The hypothesis held on that run. A click on the right page lands on the next pair and a word there can be selected. A click on the left page returns. A drag selects words and does not turn. Read aloud's `goTo` does not play the fold. A 390-pixel-wide window stays on one page.
**Lesson.** A white edge disappears on a white page. The shadow on the uncovered page is what shows the crease. A drag only selects when it starts on words, not in the gap between them.
**Next experiment.** Open the pull request. Merge with the train only when the four GitHub checks are green. Samuel asked to deploy after that. Confirm the newest migration before skipping a backup. Do not build Corner. Do not restart port 8733. Do not start a whole-book narration.

### Iteration 78 · 2026-10-09 13:04 · Spine fold deployed · success

**Hypothesis.** The merged Spine fold can go live without a database change, and the health page will name that commit.
**Action.** Pull request 120 merged as `44fd0e2` after run 37962013687 was green. The newest migration on the live database was `0022_api_token_expiry`, the same as in the repo, so no backup was taken. Set `NEOLIBRARY_COMMIT` to `44fd0e2a98d5140b53b63bf57751bbfa036cd6e1`, then uploaded `main` from that commit.
**Evaluation.** `railway up --service web --environment production --ci` wrote `Deploy complete` and `DEPLOY_EXIT:0`. Deployment `667158c6-ac9a-4798-bb93-42258cb08f30` status `SUCCESS`. `curl /api/health` returned `{"status":"ok","service":"neolibrary","commit":"44fd0e2"}` and HTTP 200. `/sign-in` returned HTTP 200. `/import` and `/account` returned HTTP 307 to `/sign-in`.
**Result.** The live site is commit `44fd0e2`. The fold itself was checked before the merge, in `/tmp/spine-pw4.log` (`2 passed (10.8s)`). I did not click through a book on the live site, because that needs a signed-in reader.
**Lesson.** A reader-only deploy still needs the live migration id checked. When it matches the repo, the backup step stays unused.
**Next experiment.** Samuel can open a PDF on the live site, choose Two pages on a wide window, and click the right page. Corner waits. Do not start a whole-book narration.

### Iteration 79 · 2026-10-09 · See it thumbnails · success

**Hypothesis.** See it draws a broken icon because a scaled Wikimedia thumbnail comes from `thumb.wikimedia.org`, and the page's image rule only names `upload.wikimedia.org`. The width and height on the picture do not, by themselves, clip the credit.
**Action.** Allowed `https://thumb.wikimedia.org` next to the upload host. Left the panel's layout alone. A test locks the image rule to those two hosts and no others.
**Evaluation.** `npx vitest run lib/csp.test.ts` → `Tests 2 passed (2)`, exit 0. eslint on the three changed files and `npx tsc --noEmit` were in the same command, which exited 0. `npx playwright test e2e/images.spec.ts --project=images --ignore-snapshots` → `217 passed (2.2m)`. Against that server, a script put the live NREL chart into the real panel: natural width 500, drawn 302 by 151, the panel did not scroll sideways, the hint was not clipped, the credit was on the card, and Escape closed the panel. Looked at `screenshots/seeit-real-desktop-light.png`, `screenshots/seeit-real-desktop-dark.png`, `screenshots/seeit-real-phone-light.png`, and `screenshots/seeit-real-phone-dark.png`: the chart is in the panel in all four, with the credit under it.
**Result.** The hypothesis held. A small original on `upload.wikimedia.org` already loaded. The scaled chart did not, until the thumbnail host was allowed.
**Lesson.** The empty box was a blocked thumbnail. The cut-off sentence in the meeting screenshot was the meeting frame: without it, the same sentence wraps inside the panel.
**Next experiment.** Merge when the four GitHub checks are green, then deploy that merge. Do not change the Spine fold. Do not build Corner. Do not start a whole-book narration.

### Iteration 80 · 2026-10-09 16:45 · PDF made voice (Part A of docs/pdf-narration-plan.md) · success

**Hypothesis.** The AI voice's word times are offsets into the paragraph's text, the same text an uploaded audiobook's words are placed by. So counting non-space characters from the top of the page (as `asParagraphs` does for an audiobook) places each made word on a PDF page, and the reader lights it with no change of its own.
**Action.** `placeOnPage` in `lib/library/audio.ts` adds `inPage` to a made track in a PDF (worked out when asked, not stored). `listenInfo` offers the made voices in a PDF; the audio route places the track it makes. The player passes `t.inPage?.[i]` to the reader. The bar's PDF line is gone. Tests: two unit tests (voices offered; the page's letters at each place are the word's), one browser test in both engines (every word lit in order, on time, on screen, on to page 2; four looks).
**Evaluation.** `npm run check` → `Tests 554 passed | 2 skipped (556)`. Unit mutation (no page base) → `1 failed | 8 passed (9)`. First full browser run: the new test failed twice over. In Chromium, my recorder counted the word still lit from the paragraph before as the new paragraph's first word. In WebKit, the wait for one exact word never ended: the word was most likely skipped (the WebKit skip in `docs/ci-flakes.md`), and the reading ran to the end of the book. After fixing both in the test: `311 passed (9.4m)` from a fresh database; the final test version `2 passed (28.5s)` in both engines; 20 more WebKit runs passed. Browser mutation (player drops `t.inPage?.[i]`) → the new test fails, nothing lit. *The Grid* by hand, fake voice at 2×: 1,358 words over pages 22-25 lit in order, 0 missed, 0 late (worst 85 ms), 0 off screen.
**Result.** The hypothesis held. My own analysis script made the same stale-word mistake on *The Grid* (page 22 looked all wrong); the lit words were right, one place behind the count.
**Lesson.** When the audio moves to the next paragraph, the last word of the one before stays lit until the new first word is lit. A recorder that keys a word by the paragraph playing, not by the lit word changing, reports a whole paragraph as wrong.
**Next experiment.** Merge and deploy; Samuel's live test on *The Grid* page 22 measures the pause at a page turn (Part B). Then Part A2 (labels), Part D (a PDF audiobook on the laptop).

### Iteration 81 · 2026-10-09 22:20 · Open unknowns row 14, choice (b) · success

**Hypothesis.** The Safari highlight test fails when a busy machine lets a short word pass between two redraws; nothing can light such a word. If the test records the audio's clock at every redraw, it can tell that case (no redraw while the word was said) from a real skip (the page redrew, and the player did not light the word), and forgive only the first.
**Action.** `lib/player/highlight-check.ts` (`checkHighlight`) holds the rule; `e2e/listen.ts` `expectHighlightKeepsUp` (used by `e2e/safari.spec.ts:42` and `e2e/audio.spec.ts:139`) and the PDF made-voice test in `e2e/readalong.spec.ts` record every redraw and use it. A word lit later than 100 ms still fails.
**Evaluation.** `npx vitest run lib/player/highlight-check.test.ts` → `Tests 5 passed (5)`. First full browser run in the worktree: `audio.spec.ts:139` and `safari.spec.ts:42` failed with "lit but not said next": my helper left out words lit in the last moments before the pause. Fixed (every word up to the last one lit is checked); second run → `311 passed (9.4m)`. A player built to skip every fifth word fails all three tests: `"Mr." (420-540 ms) was not lit, though the page redrew while it was said`, and the same for "on" and "reader".
**Result.** The hypothesis held on the laptop. Whether it ends the re-runs on CI shows over the next pull requests: the pattern stays in `flaky-tests.txt` until the test has been quiet for a week.
**Lesson.** A test that forgives must say exactly what it forgives, and a deliberate bug must still fail it. Judging by redraws keeps the forgiveness to what the machine caused.
**Next experiment.** Watch CI's WebKit runs of the two tests; a failure now names a word that was redrawn over, which is a real skip.

### Iteration 82 · 2026-10-10 04:00 UTC · PDF labels (Part A2 of docs/pdf-narration-plan.md) · success

**Hypothesis.** Since #126 the AI voice reads PDFs with each word lit on the page, so the only thing still calling a PDF "Read only" is one condition in `availabilityOf` (`fileType === "epub"`). Removing it changes the shelf, Paths, the book page and Home's "Listen from here" together, because they all read that one value.
**Action.** Dropped the EPUB condition; the function now takes only `fileKey`. Flipped the tests that asserted the old rule (unit: `availability.test.ts`, `import.test.ts`; browser: `home.spec.ts`, `reader.spec.ts`, `own-paths.spec.ts`). Kept narration-off cases in the unit tests, since no book in the browser tests can show "nothing to listen to" any more. Reworded the now-false reason on the Import page and in the server's refusal; whole-book narration stays EPUB only.
**Evaluation.** `npm run check` → `Tests 564 passed | 2 skipped (566)` (the first run failed on `import.test.ts:40`, an assertion of the old rule I had not found by grepping for "Read only"). `npx playwright test --ignore-snapshots` without Safari → `315 passed (9.8m)`. Looked at `screenshots/home-full-desktop-light.png`: the PDF's card has "Listen from here"; every PDF says "Read and listen".
**Result.** The hypothesis held: one line, plus tests and wording.
**Lesson.** Grep for the value as well as the label: the unit test asserted `{ read: true, listen: false }` with only a comment saying "Read only".
**Next experiment.** CI will fail once on the Import page's reference images (its sentence changed); refresh them with the merge train, look at them, merge.

### Iteration 83 · 2026-10-10 05:05 UTC · A PDF audiobook made on the laptop (Part D of docs/pdf-narration-plan.md) · success

**Hypothesis.** The PDF gap is in the laptop's tools, not the app: chapters and clean scripts can come from PyMuPDF (outline, font sizes, positions), and if the check that finds each script paragraph in the book reads the PDF exactly as the app does, its "N of M found" predicts the upload.
**Action.** `scripts/pdf-paragraphs.mjs` (the app's own paragraphs, via `toolParagraphs`); `split_pdf.py` in the book-chapters skill; `map_to_book.py --app-text`. Then the round trip on *The Grid* chapter 1: free Kyutai voice, package, upload to the local app, playback checked word by word with the browser tests' own `expectEveryWordOnTime`.
**Evaluation.** Whole book: 862 of 865 script paragraphs found in the app's text. Chapter 1: 76 of 76; the app matched 8,224 of 8,227 spoken words; Chrome lit every one of 827 words from page 22 (two page turns) and 80 from page 38, each on time and on screen. Skill tests: 11 passed; each of three deliberate bugs in `split_pdf.py` failed at least one test.
**Result.** The hypothesis held, after four surprises: all 8 line-end hyphens in chapter 1 were real compounds (a PDF made from an ebook), so a hyphen is dropped only when the book spells the joined word elsewhere; "CO2"'s 2 is small type set lower and must stay; PyMuPDF gave some justified lines word by word; and the aligner put a blurred "T." after "Boone", which `validate_package.py` refused (fixed in `align.py`).
**Lesson.** Check a cleaning rule against the book before trusting it: the textbook rule (drop a line-end hyphen) would have spoken "wellappointed" eight times in one chapter. And Playwright's own Chromium cannot play AAC; a test of real `.m4a` audio needs installed Chrome or WebKit.
**Next experiment.** Samuel's live test of the AI voice on *The Grid* page 22 measures the pause at each page turn (Part B).
