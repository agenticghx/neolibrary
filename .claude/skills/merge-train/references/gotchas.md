# Gotchas met while merging (2026-10-07), for the next session

Each cost at least one wasted step. Read this the first time something behaves oddly.

## Git and GitHub

- **A duplicate CI run for one commit.** Pushing a rebased stacked PR and then re-targeting it at `main` (`gh pr edit --base main`) are two events a second apart; CI's concurrency group cancels the older run. A script that grabs the first run it sees reads "cancelled" as a failure. Take the newest run for the head commit, and treat a cancelled run as "look again".
- **The plain log view shows only the latest attempt.** `gh run view --job <id> --log` after a re-run is the re-run. An earlier attempt: `gh api repos/<owner>/<repo>/actions/runs/<run>/attempts/<n>/jobs`, then `gh api repos/<owner>/<repo>/actions/jobs/<job>/logs`.
- **A branch held by a worktree cannot be checked out elsewhere** ("already used by worktree"). Remove the worktree (`git worktree remove --force <path>`) once its branch is pushed, before the train reaches that PR.
- **`node_modules/` in `.gitignore` does not match a symlink** named `node_modules` in a worktree; it shows as untracked. Never `git add -A` there; add explicit paths.
- **The PR hygiene check needs a `PROGRESS.md` Log entry in the PR's diff.** Insert it after the `## Log` line, skipping blank lines, rather than matching `"## Log\n\n### "` exactly: the train's conflict resolution can leave a different number of blank lines, and a missed match that is not checked leaves the PR without its entry.
- **Branch protection requires the checks on the head commit.** Any push is a new CI round; plan reference-image PRs for two.
- **`gh pr merge` on a draft** fails; the train marks the PR ready first.

## Playwright and CI

- **References are full-page Linux renderings** (`e2e/__screenshots__/<page>-<project>.png`, `fullPage: true`). The grid images on the `ci-screenshots` branch and in the PR comment are viewport-only: not the same pixels.
- **"did not run"** in a Playwright summary means tests that depend on a failed project were skipped. A page change can take two rounds before every stale reference has been compared.
- **A loose comparison allowance hides changes.** `maxDiffPixelRatio: 0.002` let one added sidebar row pass in light mode for a whole PR (#99); `maxDiffPixels: 40` (#108) catches it, and CI's own run-to-run noise stays below it.
- **"Test timeout of 30000ms exceeded" after an assertion** in a read-along test is Playwright's failure-trace saving hitting its limit (the `trace.zip` left behind is truncated). It adds 30 s to every failing read-along test and says nothing about the cause.
- **Two WebKit races that looked like flakes were test bugs:** leaving a page while the app's own `router.refresh()` was landing ("Navigation to … is interrupted by another navigation to …", fixed in #109 by waiting for network idle); pressing Back before the audio element had data after a far seek (the player ignores the press by design; #110 waits for `readyState >= 2 && !seeking`). The tell: the same test failing twice in a row on one PR.
- **`safari.spec.ts:42`** (the read-aloud highlight, on time) is the most frequent true flake: six failures on 2026-10-07, each passing on re-run. Its cause is not removed yet.
- **The "audio stands still right after the position is set" stall** (`playUntil: the audio never reached …`, `currentTime ≈ 0.63`, `readyState 2`, `networkState 2`, `buffered [0, 11.6]`) is a recurring WebKit-on-CI pattern (four runs by 2026-10-07). #104's `playUntil` report lists the audio requests when it happens; read it rather than re-running blindly.

- **A test that must land exactly before or after a boundary needs slack for the runner.** The "part before never comes" test (#103) pressed Back 15 s from 14.5 s into a paragraph so that the landing fell 0.5 s before it; on a slow WebKit runner the steps between the audio reaching the point and the click took longer than 0.5 s, and the press no longer asked for anything (three CI failures that looked like a flake). Leave seconds, not tenths; and when a test waits for a request that may never come, make the timeout error print the player's state (`currentTime`, `paused`, `seeking`, `readyState`), as `asksBefore` does since #110 — that one line turned a guess into a measurement.
- **The browser install step can take an hour.** "Install Chromium and WebKit" took 52 minutes on run 37643052389 (a slow download from Playwright's servers), with the tests not yet started. A silent train is not a hung train: read the job's steps with their start and end times (`gh api repos/<owner>/<repo>/actions/jobs/<id> --jq '.steps[]'`). Caching `~/.cache/ms-playwright` keyed on the Playwright version (`actions/cache`) would remove this cost; worth a small PR.

- **A ledger committed with conflict markers passes the hygiene check and gets merged.** On 2026-10-07 a hand-run rebase loop ignored its resolver's failure (nested markers from an earlier bad merge), committed `PROGRESS.md` with `<<<<<<<` lines, and the train merged it; three later PRs rebased on it carried the markers on. Two guards now: the train aborts when its resolver fails or markers remain; `scripts/check-pr-hygiene.mjs` fails on a marker line. When resolving by hand, always end with `grep -cE '^(<<<<<<<|=======|>>>>>>>)' PROGRESS.md LEARNING_LOG.md` → 0.

## Shell (macOS, zsh)

- **zsh does not word-split a string in `for x in $var`.** `for pair in "$a $b"` loops once. Use literal words, arrays, or `${=var}`.
- **macOS `sed` has no GNU `0,/re/` first-match address;** it silently does nothing, and `-i` needs `''`. Use `perl -pi -e` (first match per line) or `perl -0pi -e` (whole file), and print `git diff --stat` after any scripted edit before running anything on it.
- **A command started with a plain `&` inside a tool call may die with that shell.** Check it is alive (`pgrep -f train.sh`), or start it as a harness background task.
- **`tail -F`** (capital F) follows a log by name and survives the file being created or truncated later; `-f` does not.

## Reading a stuck train

The train waits silently while CI runs (15–20 minutes a round). If its log has not changed for 25 minutes, check `gh run list --branch <branch>`: a queued run on the shared runners can wait; a run that finished without the train noticing means the head sha it waits for differs from the run's (a push happened behind its back).
