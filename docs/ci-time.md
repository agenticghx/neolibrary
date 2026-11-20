# Browser test time

Written for: Samuel, and the next session that touches CI.

The browser job is the slow check. The other three (lint and unit tests, real Postgres, the ledger check) finish first. This file says what the time is spent on, which part runs for which change, and the other ideas that were looked at and not built.

## What one full run spends

Measured from GitHub run 37676437968, job 112981045041, on 2026-10-07. The job's wall clock was 14 min 38 s. `npm ci` was 14 s. Installing the two browsers was 38 s (they are cached now; an earlier docs-only run spent 9 min 4 s downloading them). Playwright itself reported `300 passed (12.9m)`.

The projects share one database, so they run in a line. (Since 2026-11-05 the line is split into groups on separate machines: see "Several machines at once".) Each number is the gap from that project's first log line to its last, in seconds. The gaps between projects are not included, which is why the numbers add up to less than 12.9 minutes.

| Project | Seconds | Slice |
|---|---:|---|
| Screenshot projects (four, overlapping) | about 15 | screenshots |
| flows, uploads, shell, reader, annotations, ai, audio, notes, images, stats, home, own-paths, agents, offline | 7, 11, 6, 19, 5, 26, 21, 13, 9, 7, 14, 2, 8, 10 (158 together) | behavior |
| readalong (Chromium) | 175 | readalong |
| readalong-safari (the same file in WebKit) | 236 | readalong |
| narration (fake voice) | 57 | narration |
| review (Daily review, M21; a branch off stats, beside home) | not timed yet | behavior |
| focus (a focus session with a question, M26 R3; a branch off stats too) | not timed yet | behavior |

The audiobook file is serial (`test.describe.configure({ mode: "serial" })` in `e2e/readalong.spec.ts`). Extra cores do not run it alongside itself. WebKit is the highlight test in `e2e/safari.spec.ts` plus that second pass of the audiobook file.

## What runs for a change

The slice ids, in order, are `screenshots`, `behavior`, `readalong`, `narration`, `webkit`.

`behavior` is the chain from sign-in and uploads through the offline tests. `readalong` is the audiobook file, in Chromium and then in WebKit. `webkit` without `readalong` is Safari's highlight test only. `narration` is the whole-book narration tests, with the fake voice.

| What changed | Slices |
|---|---|
| Docs, `PROGRESS.md`, other Markdown, `LICENSE`, `.claude/`, `.github/` outside `workflows/` | none. The job still succeeds. |
| Empty file list, or the file list could not be read | every slice |
| `.github/workflows/`, `package.json`, `package-lock.json`, `playwright.config.ts`, `next.config.*`, `tsconfig.*`, `scripts/ci-browser-needed*`, `e2e/auth.setup.ts` | every slice. The selector does not skip its own check. |
| A CSS file, `postcss.config.*`, `e2e/visual.spec.ts`, `e2e/a11y.spec.ts`, `e2e/pages.ts`, `public/` | screenshots |
| `components/`, a `.tsx` page under `app/` (not `app/api/`), `proxy.ts` | screenshots and behavior |
| `lib/` and `app/api/` that are not in a row below | behavior |
| `lib/readalong/`, `lib/player/`, `components/player/`, `e2e/readalong.spec.ts`, `AudiobookUpload.tsx`, a path containing `/readalong/` | behavior, readalong, webkit |
| `e2e/safari.spec.ts`, `e2e/listen.ts` | behavior and webkit. The audiobook file does not run. |
| `lib/library/narration.ts`, `e2e/narration.spec.ts`, `app/(app)/import/page.tsx`, `WholeBookNarration.tsx`, a path containing `/narration/` | behavior and narration |
| `lib/library/audio.ts` | behavior, readalong, narration, and webkit. `speak()` lives in that file. |

The word "narrative" in a Path (the narrative book, then the engineering book) is not the narration slice. `data/paths/hidden-machinery.ts` runs the behaviour chain only.

A slice that needs the shared database also runs the behaviour chain in front of it. Narration waits on the audiobook projects when those ran, and on the offline project when they did not. It does not wait on Safari's highlight test.

The screenshot grid requires every page in `e2e/pages.ts` that this run actually photographs. The mini-player images are taken by the audiobook file. The Path-edit images are taken by `own-paths.spec.ts`, and the Daily review images by `review.spec.ts`. A style-only run does not fail for images those files did not take.

On this laptop, leave `CI_BROWSER_SLICES` unset. Playwright then runs the same projects, with the same dependencies, as before.

## Pull requests skip Safari's engine (2026-10-09)

Samuel's decision: Safari's engine (WebKit) is the slow part, so a pull request's browser check runs Chromium only. `ci.yml` sets `CI_SKIP_WEBKIT=1` on pull requests and installs only Chromium; `applyBrowserSlices` (`scripts/ci-browser-needed.mjs`) then drops every project whose `browserName` is `webkit` (`safari`, `readalong-safari`: 37 of 311 tests), and `narration` waits on `readalong` instead. The run on `main` after each merge and the night run keep WebKit. A WebKit failure therefore shows on `main`, after the merge: the merge-train skill (step 6) says to read that run. That run on `main` is started by `auto-merge.yml` right after it merges (`gh workflow run ci.yml --ref main`): a merge made with a workflow's own token starts no push run, and from 2026-10-09 15:10 UTC to the fix no merge had a run on `main` at all; only the night run checked WebKit. On the laptop, nothing changes unless `CI_SKIP_WEBKIT=1` is set.

## The night run

`.github/workflows/ci.yml` schedules `0 8 * * *` (08:00 UTC). That run is the browser job only, and it forces every slice, including WebKit. Lint and Postgres already ran on the push to `main`.

GitHub runs a schedule only from the default branch. The night run does not exist until this file is on `main`. The concurrency group includes the event name, so the night run and a pull request do not cancel each other.

## This pull request

Pull request #114 also changes `lib/library/audio.ts`, `lib/library/narration.ts`, the workflow, and this selector. Those files select every slice. The next run of #114 still does the long tail once. A later change that stays in spending, sign-in, or uploads does not.

## Several machines at once (2026-11-05)

Written for: Samuel, and the next session that touches CI.

Samuel stopped paying for Blacksmith's machines on 2026-11-05. CI now runs on GitHub's own machines, which are free for a public repository but slower. To make up the time, the browser tests run on several machines at the same time.

Each machine runs one **group** of projects (`BROWSER_GROUPS` in `scripts/ci-browser-needed.mjs`), with its own server and its own fresh database. A group repeats the few projects that make the data it needs: `setup` (the owner account), `flows` (Grace, the invited reader) and `uploads` (the books). Those take about a minute.

| Group | What it runs | When |
|---|---|---|
| `behavior` | the chain `flows`, `uploads`, `reader`, `annotations`, then `ai`, `audio`, `notes`, `images` and `home` (each needs what the ones before it made); Chromium only | behaviour slice |
| `behavior-2` | the four screenshot projects (before any data), then after `flows` and `uploads`: `shell`, `stats`, `own-paths`, `agents`, `offline` and `open-shelf`. Split from `behavior` on 2026-11-11; `shell` moved here on 2026-11-14; `reader` no longer runs here (see below) | any slice but narration-only |
| `branches` | `review`, `covers`, `own-keys`, `eink`, `focus`, then `shared-papers`; here they wait on `uploads`, not `stats` | behaviour slice |
| `readalong` | after `flows` and `uploads`: the audiobook file in Chromium, then whole-book narration. Before 2026-11-14 it ran `reader` first, only for its PDF (see below) | readalong or narration slice |
| `webkit` | `reader`, then Safari's highlight test and the audiobook file in WebKit. All of WebKit is on this machine, so the behavior machine is Chromium only. (This was tried on 2026-11-05 as a fix for the design screenshot's 2 px wobble on main; it is not the fix, see docs/ci-flakes.md.) | main and the night run, when the webkit or readalong slice is on |

In `ci.yml`, `browser-plan` picks the slices and lists the machines (`node scripts/ci-browser-needed.mjs --groups <slices> <1 to skip WebKit>`). `e2e-group` starts one machine per group. `e2e` keeps the required check's name: it passes only when every machine passed, gathers the screenshots from all of them, checks the 2×2 grid, and posts it on the pull request. Each machine uploads its own `playwright-report-<group>` artifact.

**Balance, 2026-11-14.** In twelve pull-request runs before this date, `behavior` was the slowest machine every time: 568 to 846 s in its Playwright step, against 398 to 518 for `behavior-2` and 331 to 408 for `branches`. In the slowest of them its projects took, one after another: `reader` 251 s, `ai` 126, `uploads` 71, `annotations` 65, `home` 46, `shell` 43, `audio` 41, `notes` 37, `images` 30, `flows` 14. `shell` and `annotations` moved to `behavior-2`, which already repeats `flows`, `uploads` and `reader`; nothing left on `behavior` needs what they make. Each group passed alone from an empty database in Playwright's Linux image (behavior 137 passed in 6.1 min; behavior-2 289 passed in 5.8 min; main's old behavior group 168 passed in 6.9 min on the same laptop).

**Screenshots to the branches machine: tried and dropped (2026-11-14, #373).** #372's own run (every machine): `behavior` 665 s, `behavior-2` 744 s (its four screenshot projects took the first 130 s), `readalong` 739 s, `branches` 332 s. #373 moved the screenshot projects to `branches` (with `flows` waiting on them, as on `behavior-2`). On its run, `behavior-2` fell to 492 s, but the design page's screenshot failed on `branches` in both attempts (phone-light, 248 pixels; then desktop-light, two screenshots in a row not the same). In the 150 CI runs since 2026-11-07, that test failed twice before, both on the old `behavior` machine before the split, and never on `behavior-2`. No difference between the two machines' set-ups was found: the screenshot projects wait on the same `setup` and run with the same two workers. The screenshots stay on `behavior-2`. The whole run takes about 95 s more than its slowest Playwright step (#372: 744 s, 14.0 minutes), so the 12-minute target means a slowest step of about 625 s or less.

**The reader project left two machines (2026-11-14).** In #376's run (every machine), `behavior-2` took 750 s and `readalong` 682 s, both over the 625 s that a 12-minute run allows. Summed from that run's log, `reader` was 235 s of tests on `behavior-2` and 229 s on `readalong`, and it ran there only to make data. On `readalong` it was there for one file: the PDF "Discourse on the Method", which `reader.spec.ts` uploads. On `behavior-2` it was there for `annotations`, which needs the book `reader` opens, and for the same PDF in one offline test. Now `e2e/discourse.ts` builds that PDF. `reader.spec.ts` uploads it as before, and the audiobook file and the offline test upload it themselves when the library does not have it. `annotations` went back to `behavior`, which runs `reader` anyway. Each changed group passed alone from an empty database in Playwright's Linux image: `behavior-2` 237 passed (2.7 min, 3 workers on the laptop), `readalong` 80 passed (4.9 min). The first try of `behavior-2` failed once, in the offline test, which needed the PDF too: that is how it was found. #380's own run (every machine): `behavior` 545 s, `behavior-2` 417 s, `readalong` 406 s, `branches` 338 s; 10.8 minutes from start to the last job (#376: 534, 750, 682, 328 s; 14.1 minutes). `behavior` is now the slowest machine.

**Building the site once for all machines: not built (2026-11-14).** Each machine builds the site before its tests: about 76 s on GitHub's machines (#369, from `npx playwright test` to "Running 168 tests"). A build made once by another job would save that, but every machine would have to wait for that job to finish (checking out, installing, building and uploading, about 100 s) before its own installing could start, so the slowest machine would not finish sooner. It would save machine time, not waiting time.

A new project goes in exactly one group's `targets` (a unit test fails otherwise). Before moving a project to another group, run that group alone from an empty database on the Mac: `CI=1 CI_BROWSER_GROUP=<group> npx playwright test --ignore-snapshots` (with `.data/` moved away first). A test that quietly used another project's data fails there.

## Alternatives that are not built

These were the other ways to shorten the same wait. They are logged here so the next session does not rebuild them.

1. **Several free GitHub machines.** Built on 2026-11-05: see "Several machines at once" above. Playwright's `--shard` flag is still not the tool: it splits test files evenly, and every shard would have to replay the chain in front of its files. The groups split the chain where it branches instead.

2. **A larger GitHub runner.** Set aside. The audiobook file runs one test after another, and the current machine already runs two Playwright workers. More CPUs do not shorten that file. A larger runner is a paid upgrade. This session does not raise a spending limit.

3. **Samuel's Ubuntu machine (denkyem), for his own branches.** Set aside. It was not timed. The repository is public. A machine of ours that executed pull-request workflows would execute a stranger's code on that machine. GitHub's guidance is to keep self-hosted runners off public repositories. The four required checks stay on GitHub. The screenshot references are the pixels from those machines (`maxDiffPixels: 40`). A green run on a Mac is a useful check before a push. It is not the merge gate. The same point, with the measured Mac times, is in `docs/security-leftovers.md`.

4. **An AI looking at the pages.** Set aside. The long wait is the audiobook tests stepping through audio. A picture review does not shorten those clicks. The screenshot grid is about 15 seconds. Those pixels caught a one-row sidebar change when the allowance was 0.2% of the page (pull request #99, 2026-10-07). A model judging the pictures is a weaker check for that kind of change.
