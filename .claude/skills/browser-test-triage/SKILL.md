---
name: browser-test-triage
description: Decide, on the laptop and before pushing, whether a failing Neolibrary browser (Playwright) test is caused by the change, already broken on main, a Mac-only difference, or a flake, by running it in Playwright's own Linux image (what CI uses) on the branch and on main. Use whenever a browser test fails locally, before writing "fails on main too", "Mac-only", "flaky" or "CI will judge" anywhere (chat, PR, ledger), when a test passes on the Mac but fails on CI or the other way round, when many unrelated tests fail in a new worktree, or when the user says "it fails on my Mac", "is it my change?", "why does this keep happening", "is this a flake". Load it before merge-train when the failure was seen locally.
---

# Browser test triage

Written for Claude sessions on Neolibrary (`agenticghx/neolibrary`, public) working on a Mac. Samuel, the owner, is a scientist: say in plain English what failed, what was run to decide why, and what it showed.

## Why this exists

The Mac and CI's Linux machine render and behave differently (text width, CSS column wrapping, mouse drag selection, dialog event timing). Sessions kept meeting a failing test on the Mac, running it once on main's code, seeing it fail there too, and writing "fails on this Mac regardless; CI will judge". Then they pushed and waited 15-20 minutes for CI.

On 2026-11-01 that was wrong. Two reader tests failed on the Mac with and without the change (#256, the reader sidebar). CI then failed one of them on Linux, where it passes on main: the change *had* broken it. The Linux image on the laptop showed the same in under 3 minutes, and a logged run there found the cause in two more. A Mac failure on main hides real regressions; only a Linux run tells them apart.

## The rule

Never write "fails on main too", "Mac-only", "flaky" or "CI will judge" about a test until it has been run in the Linux image **on the branch and on main**. Quote both summary lines.

## Step 0: is the laptop set up right? (one minute)

- **Many unrelated failures in a new worktree** (fonts, PDF pictures, text editions: about 15 unit tests, or browser tests that cannot load a font): the worktree is borrowing the main folder's older packages. Run `npm ci` in the worktree. Seen 2026-10 and 2026-11-01.
- **A test run alone with `--no-deps` fails** where the full chain passes: some projects need data earlier projects make (flows, uploads, audio). Run without `--no-deps` before judging.
- **`-g` can change a test's result, not only which tests run.** Tests in one project share a database and settings, and earlier tests leave state later ones rely on (on 2026-11-01 "read it rewritten" expected the STE strict style that earlier AI tests had set; filtered with `-g` it met Plain and failed twice). A test that fails only when filtered: run its whole project (`linux-run.sh -- --project <p>`) before judging.
- **One heavy job at a time.** A second test run, `npm ci`, or a type check alongside a browser run makes timing tests fail (a page turn that "did not move" on 2026-11-01, gone when run alone). Write code in parallel; run tests one at a time.
- **Screenshot comparisons fail on the Mac by design** (the references are Linux renderings): always `--ignore-snapshots` locally; merge-train refreshes them from CI.

## Step 1: is it steady? (Mac, a few minutes)

Run the one failing test three times: `npx playwright test --project <p> --ignore-snapshots -g "<title>" --repeat-each 3`. Use `-g` with words from the test's own title (`--grep-invert` did not leave out a test inside a `describe` here). 3 of 3 is steady; mixed results mean a race (read `docs/ci-flakes.md` and merge-train's flake rules).

## Step 2: the Linux image, branch and main (about 3-5 minutes each)

```bash
SKILL=.claude/skills/browser-test-triage/scripts
zsh $SKILL/linux-run.sh -- --project <p> -g "<title>"                  # the branch as it is (uncommitted edits too)
zsh $SKILL/linux-run.sh --ref origin/main -- --project <p> -g "<title>" # the control
```

The script starts colima (the Mac's Docker), picks the image matching `@playwright/test` in `package.json`, keeps Linux packages in a Docker volume (the Mac's `node_modules` is never touched), and sets `--ignore-snapshots` and `CI_SKIP_WEBKIT=1` as a pull request's CI does. The folder must be under the home folder (colima shares only that); `--ref` makes one under `~/.cache/neolibrary-linux-runs/`. With no arguments it runs the whole suite as CI does. Never run it and a Mac browser run in the same folder at once (both build into `.next`).

## Step 3: read the four results

| Linux, branch | Linux, main | Mac | What it is | What to do |
|---|---|---|---|---|
| fails | passes | any | **the change broke it** | find the cause (step 4) and fix it; never push hoping CI disagrees |
| fails | fails | any | main is broken | fix in its own small PR first, or say so in the PR with both runs quoted |
| passes | passes | fails | Mac-only | record it in `docs/ci-flakes.md` (Mac-only section) with the cause if found; push |
| mixed over 3 runs | | | a race | merge-train's flake rules; a test failing twice on one PR is real until shown otherwise |

## Step 4: find the cause (Linux image, minutes)

1. Read the failing step and what it measures. Then add a temporary `console.log("DBG", …)` in the test with what the assertion depends on (sizes, the element's state, the place), and run it in the Linux image with and without the suspect (an environment variable the test reads switches it: `linux-run.sh --env EXP=1 -- …`).
2. Compare the two logs. On 2026-11-01: the place mark was there but over other words, because the test read the top words *before* opening the settings panel, whose narrowing re-wrapped the lines; and two pages became one because the sidebar and a panel together left 644 px of text, under the 680 px two pages need.
3. Decide whether the app or the test is wrong. Fixing a test is right when it measured at the wrong moment or assumed room it no longer has; it is weakening when it stops checking the behaviour. Say which in the PR, with the numbers.
4. Remove every temporary line and prove it: `grep -c "DBG\|EXP" <file>` prints 0.

## Recording

- The LEARNING_LOG iteration names the Linux and Mac results and the cause.
- `docs/ci-flakes.md`: Mac-only failures get a row in its Mac-only section (test, what differs, run date); real races go in the flake table as before.
- A gotcha that cost time and is not here: add it to this file.
