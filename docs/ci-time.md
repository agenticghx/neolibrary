# Browser test time

Written for: Samuel, and the next session that touches CI.

The browser job is the slow check. The other three (lint and unit tests, real Postgres, the ledger check) finish first. This file says what the time is spent on, which part runs for which change, and the other ideas that were looked at and not built.

## What one full run spends

Measured from GitHub run 37676437968, job 112981045041, on 2026-10-07. The job's wall clock was 14 min 38 s. `npm ci` was 14 s. Installing the two browsers was 38 s (they are cached now; an earlier docs-only run spent 9 min 4 s downloading them). Playwright itself reported `300 passed (12.9m)`.

The projects share one database, so they run in a line. Each number is the gap from that project's first log line to its last, in seconds. The gaps between projects are not included, which is why the numbers add up to less than 12.9 minutes.

| Project | Seconds | Slice |
|---|---:|---|
| Screenshot projects (four, overlapping) | about 15 | screenshots |
| flows, uploads, shell, reader, annotations, ai, audio, notes, images, stats, home, own-paths, agents, offline | 7, 11, 6, 19, 5, 26, 21, 13, 9, 7, 14, 2, 8, 10 (158 together) | behavior |
| readalong (Chromium) | 175 | readalong |
| readalong-safari (the same file in WebKit) | 236 | readalong |
| narration (fake voice) | 57 | narration |

The audiobook file is serial (`test.describe.configure({ mode: "serial" })` in `e2e/readalong.spec.ts`). Extra cores do not run it alongside itself. WebKit is the highlight test in `e2e/safari.spec.ts` plus that second pass of the audiobook file.

## What runs for a change

The slice ids, in order, are `screenshots`, `behavior`, `readalong`, `narration`, `webkit`.

`behavior` is the chain from sign-in and uploads through the offline tests. `readalong` is the audiobook file, in Chromium and then in WebKit. `webkit` without `readalong` is Safari's highlight test only. `narration` is the whole-book narration tests, with the fake voice.

| What changed | Slices |
|---|---|
| Docs, `PROGRESS.md`, other Markdown, `LICENSE`, `.claude/`, `.github/` outside `workflows/` | none. The job still succeeds. |
| Empty file list, or the file list could not be read | every slice |
| `.github/workflows/`, `package.json`, `package-lock.json`, `playwright.config.ts`, `playwright.timing.config.ts`, `next.config.*`, `tsconfig.*`, `scripts/ci-browser-needed*`, `e2e/auth.setup.ts` | every slice. The selector does not skip its own check. |
| A CSS file, `postcss.config.*`, `e2e/visual.spec.ts`, `e2e/a11y.spec.ts`, `e2e/pages.ts`, `public/` | screenshots |
| `components/`, a `.tsx` page under `app/` (not `app/api/`), `proxy.ts` | screenshots and behavior |
| `lib/` and `app/api/` that are not in a row below | behavior |
| `lib/readalong/`, `lib/player/`, `components/player/`, `e2e/readalong.spec.ts`, `AudiobookUpload.tsx`, a path containing `/readalong/` | behavior, readalong, webkit |
| `e2e/safari.spec.ts`, `e2e/listen.ts` | behavior and webkit. The audiobook file does not run. |
| `lib/library/narration.ts`, `e2e/narration.spec.ts`, `app/(app)/import/page.tsx`, `WholeBookNarration.tsx`, a path containing `/narration/` | behavior and narration |
| `lib/library/audio.ts` | behavior, readalong, narration, and webkit. `speak()` lives in that file. |

The word "narrative" in a Path (the narrative book, then the engineering book) is not the narration slice. `data/paths/hidden-machinery.ts` runs the behaviour chain only.

A slice that needs the shared database also runs the behaviour chain in front of it. Narration waits on the audiobook projects when those ran, and on the offline project when they did not. It does not wait on Safari's highlight test.

The screenshot grid requires every page in `e2e/pages.ts` that this run actually photographs. The mini-player images are taken by the audiobook file. The Path-edit images are taken by `own-paths.spec.ts`. A style-only run does not fail for images those files did not take.

On this laptop, leave `CI_BROWSER_SLICES` unset. Playwright then runs the same projects, with the same dependencies, as before.

## Pull requests skip Safari's engine (2026-10-09)

Samuel's decision: Safari's engine (WebKit) is the slow part, so a pull request's browser check runs Chromium only. `ci.yml` sets `CI_SKIP_WEBKIT=1` on pull requests and installs only Chromium; `applyBrowserSlices` (`scripts/ci-browser-needed.mjs`) then drops every project whose `browserName` is `webkit` (`safari`, `readalong-safari`: 37 of 311 tests), and `narration` waits on `readalong` instead. The run on `main` after each merge and the night run keep WebKit. A WebKit failure therefore shows on `main`, after the merge: the merge-train skill (step 6) says to read that run. On the laptop, nothing changes unless `CI_SKIP_WEBKIT=1` is set.

## The night run

`.github/workflows/ci.yml` schedules `0 8 * * *` (08:00 UTC). That run is the browser job only, and it forces every slice, including WebKit. Lint and Postgres already ran on the push to `main`.

GitHub runs a schedule only from the default branch. The night run does not exist until this file is on `main`. The concurrency group includes the event name, so the night run and a pull request do not cancel each other.

## This pull request

Pull request #114 also changes `lib/library/audio.ts`, `lib/library/narration.ts`, the workflow, and this selector. Those files select every slice. The next run of #114 still does the long tail once. A later change that stays in spending, sign-in, or uploads does not.

## Alternatives that are not built

These were the other ways to shorten the same wait. They are logged here so the next session does not rebuild them.

1. **Several free GitHub machines.** Set aside. The projects share one database, and each project waits for the one before it. Extra machines wait on that same chain. Splitting the job comes after the chain is broken, which is a larger change than skipping the tail.

2. **A larger GitHub runner.** Set aside. The audiobook file runs one test after another, and the current machine already runs two Playwright workers. More CPUs do not shorten that file. A larger runner is a paid upgrade. This session does not raise a spending limit.

3. **Samuel's Ubuntu machine (denkyem), for his own branches.** Set aside. It was not timed. The repository is public. A machine of ours that executed pull-request workflows would execute a stranger's code on that machine. GitHub's guidance is to keep self-hosted runners off public repositories. The four required checks stay on GitHub. The screenshot references are the pixels from those machines (`maxDiffPixels: 40`). A green run on a Mac is a useful check before a push. It is not the merge gate. The same point, with the measured Mac times, is in `docs/security-leftovers.md`.

4. **An AI looking at the pages.** Set aside. The long wait is the audiobook tests stepping through audio. A picture review does not shorten those clicks. The screenshot grid is about 15 seconds. Those pixels caught a one-row sidebar change when the allowance was 0.2% of the page (pull request #99, 2026-10-07). A model judging the pictures is a weaker check for that kind of change.
