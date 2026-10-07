---
name: merge-train
description: Merge Neolibrary pull requests under the repository's rules without wasting CI rounds — one PR at a time, rebased onto main with both sides of PROGRESS.md and LEARNING_LOG.md kept, merged only when the four GitHub checks are green — and handle what CI throws back — a known flaky WebKit or timing test (re-run once, then investigate), changed Playwright reference screenshots (download CI's renderings, look at them, commit), a rebase conflict, a real failure. Use this whenever a session must merge one or more PRs (a stack of M-step PRs, review fixes, small PRs into main), rebase a PR after main moved, decide whether a CI failure is a flake, refresh reference images, or read an earlier attempt's CI log, even when the user only says "merge it", "CI is red", "re-run", "the screenshots changed" or "why did this fail".
---

# Merge train

Written for Claude sessions on `sahuno/neolibrary` (laptop or cloud). Samuel, the owner, is a scientist; whatever reaches him (PR text, the ledger) is plain English with jargon defined.

## Why this skill exists

On 2026-10-07 one session merged fourteen PRs. Every one needed the same dance, and each misstep cost a 15–20 minute CI round:
- Every PR carries a `PROGRESS.md` Log entry (the PR hygiene check requires it) and most carry a `LEARNING_LOG.md` entry, so **every merge into `main` makes every other open PR conflict on those two files**. Merges are therefore one at a time: rebase → CI → merge → next.
- Branch protection on `main` requires the four checks on the PR's **head commit**, so any push (a rebase, a reference-image commit) means a fresh CI round.
- The browser job has timing tests in WebKit (and a few in Chromium) that fail on the shared runners on a third to a half of runs. A flake is re-run once; a second failure of the *same* test on the same PR has, twice now, turned out to be a real race (see `docs/ci-flakes.md`).
- Reference screenshots are Linux renderings. A page change makes CI fail once; the renderings come back as `*-actual.png` in the `playwright-report` artifact, must be **looked at** (the look and feel is a requirement), copied into `e2e/__screenshots__`, and pushed for one more round.

The scripts here do the mechanical parts. The judgement — is this a flake, do these images look right, is this conflict one of the ledgers — stays with the session, and the places to look are listed below.

## Rules that bound everything (from CLAUDE.md; do not bend them)

- Merge your own PR only when all four required checks are green on its head commit, no test was skipped, deleted or weakened to get there, and the PR description carries the "Done when" evidence.
- Never commit to `main`. Stage with `git add` on explicit paths. Never commit `docs/ideasFeaturesSelf.md` or `docs/handoffs/`.
- Keep both sides when `PROGRESS.md` or `LEARNING_LOG.md` conflicts (newest ledger entry on top; the learning log grows at the end).
- Before a migration merges: it has a reverse step, and a backup is taken before it runs in production.
- Never report "green" or "merged" without re-deriving it (`gh pr view N --json state,mergeCommit`, `gh run view <id>`).

## The order of work

1. **Decide the order.** Safety fixes and small main-based PRs first; then a stack in build order (each stacked PR is rebased `--onto main` from the commit it was built on). Reference-image PRs (anything that changes a page in `e2e/pages.ts`) take two CI rounds each; plan for it.
2. **One train at a time.** `scripts/train.sh` checks branches out in the main working tree. Do not run two, and do not hold a PR's branch in a worktree (the checkout fails: "already used by worktree"). Build other PRs meanwhile in `git worktree`s on *other* branches.
3. **Run it in the background and watch its log**, don't poll:
   ```bash
   SKILL=.claude/skills/merge-train/scripts
   (zsh $SKILL/train.sh 101 m13-epub-safe-unzip && zsh $SKILL/train.sh 99 m14-v3b-import-nav 66f92e1; echo "chain exit $?") > /tmp/train-chain.log 2>&1 &
   ```
   Watch with the Monitor tool: `tail -n +1 -F /tmp/train-chain.log | grep --line-buffered -E "MERGED|exit|conflict|failed|NOT pushed|refused|flaky|rebased and pushed|CI green"` (30-minute watches; re-arm on expiry). Set `TRAIN_TRAILERS` to the commit trailers this session must add (the `Co-Authored-By` line and any session line) so the script's reference-image commits carry them.
4. **Act on how a train stops** (its exit code; the log says which):

   | Exit | Meaning | What to do |
   |---|---|---|
   | 0 | merged | nothing; the next PR in the chain runs |
   | 2 | rebase conflict outside the two ledgers | resolve by hand on that branch (`git status`, read both sides, keep the intent of both), `git rebase --continue`, push `--force-with-lease`, run the train again |
   | 3 | screenshot comparisons failed; CI's renderings copied into `e2e/__screenshots__` and committed, **not pushed** | look at them (the Read tool shows images; a desktop and a phone, light and dark, of each page that changed), then `git push` and run the train again; say in the PR which images changed and why |
   | 4 | CI failed for another reason, or a known flake failed twice | read the failure (below); fix or re-run by hand; run the train again |
   | 5 | GitHub refused the merge | usually "not mergeable": main moved under it; run the train again (it rebases) |

5. **Read a failure before re-running.** `scripts/attempt-log.sh <run-id> [attempt]` prints the failing tests and the first error of each. Then:
   - **A test listed in `scripts/flaky-tests.txt`, failing for the first time on this PR** → the train already re-ran it once; if you are here, it failed again or a second flaky test fired. Re-run by hand once more (`gh run rerun <id> --failed`), and note the test and run in `docs/ci-flakes.md`.
   - **The same test failing twice in a row on one PR** → treat it as real until shown otherwise. Twice on 2026-10-07 that was a race in the test (a navigation racing the app's own refresh; a Back press before the audio element had data). Find the interrupting event in the error (what navigated, what was missing), read the app code it names, and fix the *cause* in the test or the app in its own small PR, with the evidence in the PR text. Do not loosen an assertion to make it pass.
   - **A screenshot comparison** failing by a few pixels only → check `maxDiffPixels` in `playwright.config.ts` (40 since #108; CI's own noise is below it). A page change that "passes" is the worse failure: a loose allowance hid one sidebar row for a whole PR.
   - **"Test timeout of 30000ms exceeded" after an assertion in a read-along test** → Playwright's failure-trace saving hitting its limit; it adds 30 s and a truncated `trace.zip`, and says nothing about the test. Ignore it as a cause.
   - **A new test name, or a failure in Lint / Real Postgres / PR hygiene** → not a flake. Hygiene: the PR needs a `PROGRESS.md` Log entry (`node scripts/check-pr-hygiene.mjs origin/main`). Postgres: migrations need an `.up.sql` and a `.down.sql`.
6. **After the last merge:** back up, deploy, check `/api/health`, `/sign-in` and `/import`; comment on the issue the work answers; write the ledger entry (the five fields) and push it in a small PR if `main` already holds everything else.

## Refreshing reference images by hand

When a run failed on screenshot comparisons and you want to do it without the train:
```bash
zsh .claude/skills/merge-train/scripts/refresh-screenshots.sh <run-id>          # copies CI's renderings, lists them
zsh .claude/skills/merge-train/scripts/refresh-screenshots.sh <run-id> --dry   # lists only
```
Then look at them, `git add e2e/__screenshots__`, commit, push. The grid images on the `ci-screenshots` branch are viewport-only and **not** the references; the references are the full-page `*-actual.png` files in the artifact. Playwright skips tests that depend on a failed project ("did not run"), so a page change can need two rounds before every stale image has been seen.

## Stacked PRs

A PR built on another PR's branch is rebased with `--onto`: `train.sh <pr> <branch> <sha of the commit it was built on>`. Find that sha in the ledger entry that opened the PR ("built on …", "on top of #N @ sha"). After a squash-merge of the base PR, the replayed commits apply cleanly when they touched different lines; the two ledgers always conflict and the script resolves them.

**`--onto` is for the first rebase only.** Once the branch has been rebased onto `main` (and pushed), the old base sha is no longer in its history; `git rebase --onto main <old sha> <branch>` then replays `main`'s own commits and conflicts on every ledger entry. Check with `git merge-base --is-ancestor <old sha> <branch>`: true → use `--onto`; false → plain `train.sh <pr> <branch>`. (Cost of learning this: one aborted rebase on #104, 2026-10-07.)

**A conflict outside the ledgers (exit 2)** is usually two PRs inserting at the same anchor in one file (two helpers added after the same constant). Keep both; then check the seam: a mechanical "keep both sides" can drop the closing brace of one side and the comment opener of the other (`npx tsc --noEmit` catches it in a minute). Commit the repair as its own commit; the PR is squash-merged anyway.

## Recording

- A flake you saw: one line in `docs/ci-flakes.md` (test, run, attempt, what the error said). A cause you removed: the fix PR number next to it, and drop the pattern from `scripts/flaky-tests.txt` once the test is quiet for a week.
- The merges: the ledger entry at the end of the session lists each PR with its merge commit (from `gh pr view N --json mergeCommit`), the reference images committed, the flakes met and what they cost.
- Lessons: `LEARNING_LOG.md`, one Iteration per attempt, as the M14 plan asks.

## Files

- `scripts/train.sh` — the train. `scripts/unwind.py` — resolves conflict blocks keeping both sides (also usable by hand: `python3 unwind.py PROGRESS.md theirs-first`). `scripts/flaky-tests.txt` — regexes the train treats as known flakes (one per line). `scripts/refresh-screenshots.sh` — artifact → `e2e/__screenshots__`. `scripts/attempt-log.sh` — an attempt's failures and errors.
- `references/gotchas.md` — the traps that cost time (zsh word splitting, macOS `sed`, worktrees, duplicate runs, hygiene insertions, trace timeouts). Read it the first time something behaves oddly.
- `docs/ci-flakes.md` (repository root) — the known flaky tests with evidence and fixes.
