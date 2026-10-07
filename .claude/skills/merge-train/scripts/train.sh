#!/bin/zsh
# Merge train for one pull request (see ../SKILL.md): rebase onto main keeping both sides of the two ledgers,
# push, wait for CI on the new head, re-run a known flaky job once, stop for a human look when reference
# screenshots change, merge when the four checks are green.
#
# usage: train.sh <pr-number> <branch> [<sha the branch was built on, for a stacked PR: rebase --onto main from it>]
# env:   TRAIN_TRAILERS  commit trailers for the reference-image commit (e.g. the Co-Authored-By line), optional
#        TRAIN_LOGS      where to keep logs (default: $TMPDIR/neolibrary-train)
# exit:  0 merged · 2 rebase conflict outside the ledgers · 3 reference images copied and committed, NOT pushed
#        4 CI failed for another reason (or a known flake twice) · 5 merge refused
set -u
HERE=${0:A:h}
REPO=$(git -C "$HERE" rev-parse --show-toplevel) || exit 4
cd "$REPO" || exit 4
NWO=$(gh repo view --json nameWithOwner -q .nameWithOwner) || exit 4
LOGS=${TRAIN_LOGS:-${TMPDIR:-/tmp}/neolibrary-train}; mkdir -p "$LOGS"
PR=$1 BR=$2 ONTO=${3:-}
log() { echo "[train #$PR $(date -u +%H:%M:%S)] $*"; }

# 1. Rebase onto main. Only PROGRESS.md and LEARNING_LOG.md may conflict; both sides are kept.
git fetch -q origin || { log "fetch failed"; exit 4; }
git checkout -q "$BR" 2>"$LOGS/train-$PR-checkout.log" || { log "checkout failed: $(tail -1 "$LOGS/train-$PR-checkout.log")"; exit 4; }
git reset -q --hard "origin/$BR"
before=$(git rev-parse HEAD)
if [ -n "$ONTO" ]; then git rebase --onto origin/main "$ONTO" "$BR" > "$LOGS/train-$PR-rebase.log" 2>&1; rc=$?; else git rebase origin/main > "$LOGS/train-$PR-rebase.log" 2>&1; rc=$?; fi
while [ $rc -ne 0 ]; do
  conflicted=$(git diff --name-only --diff-filter=U)
  if [ -z "$conflicted" ]; then log "rebase stopped without conflicts: $(tail -2 "$LOGS/train-$PR-rebase.log" | tr '\n' ' ')"; git rebase --abort; exit 2; fi
  others=$(echo "$conflicted" | grep -vE '^(PROGRESS\.md|LEARNING_LOG\.md)$' || true)
  if [ -n "$others" ]; then log "conflict outside the ledgers: $(echo $others | tr '\n' ' ')"; git rebase --abort; exit 2; fi
  # unwind.py keeps both sides of every block, innermost first; an empty side is fine (the earlier regex needed text on both sides).
  ok=1
  for f in $conflicted; do
    case $f in PROGRESS.md) python3 "$HERE/unwind.py" "$f" theirs-first || ok=0;; LEARNING_LOG.md) python3 "$HERE/unwind.py" "$f" || ok=0;; esac
  done
  [ $ok -eq 1 ] || { log "the ledger resolver failed: markers left; aborting the rebase"; git rebase --abort; exit 2; }
  # A second guard: a ledger committed with its markers would pass the hygiene check (before #112) and be merged.
  if grep -qE '^(<<<<<<< |=======$|>>>>>>> )' PROGRESS.md LEARNING_LOG.md; then log "markers left after the resolver; aborting the rebase"; git rebase --abort; exit 2; fi
  git add PROGRESS.md LEARNING_LOG.md 2>/dev/null
  GIT_EDITOR=true git rebase --continue > "$LOGS/train-$PR-rebase.log" 2>&1; rc=$?
done
if grep -qE '^(<<<<<<<|=======|>>>>>>>)' PROGRESS.md LEARNING_LOG.md; then log "conflict markers in a ledger after the rebase; stopping"; exit 2; fi
head=$(git rev-parse HEAD)
if [ "$head" != "$before" ]; then
  git push -q --force-with-lease origin "$BR" || { log "push failed"; exit 4; }
  log "rebased and pushed: ${before:0:7} -> ${head:0:7}"
else
  log "already on main's tip; head ${head:0:7} unchanged"
fi
# Re-targeting a stacked PR at main is an event of its own that starts a second run (CI cancels the first); skip it when done.
[ "$(gh pr view "$PR" --json baseRefName -q .baseRefName)" = "main" ] || gh pr edit "$PR" --base main >/dev/null 2>&1 || true

# 2. Wait for the newest CI run on this head. A cancelled run was superseded by a newer one for the same commit.
wait_run() {
  local id="" st=""
  while true; do
    id=$(gh run list --branch "$BR" --workflow CI --limit 5 --json databaseId,headSha -q ".[] | select(.headSha == \"$head\") | .databaseId" 2>/dev/null | sort -n | tail -1)
    if [ -z "$id" ]; then sleep 15; continue; fi
    st=$(gh run view "$id" --json status,conclusion -q '"\(.status) \(.conclusion)"' 2>/dev/null || echo "? ?")
    case "$st" in
      "completed cancelled") sleep 30 ;;
      completed*) break ;;
      *) sleep 60 ;;
    esac
  done
  RUN=$id
  [ "$st" = "completed success" ]
}

# 3. Green: merge. Failed: reference images → copy, commit, stop (3); a known flake → re-run once; else stop (4).
for attempt in 1 2; do
  if wait_run; then log "CI green on run $RUN"; break; fi
  J=$(gh api "repos/$NWO/actions/runs/$RUN/jobs" --jq '.jobs[] | select(.conclusion=="failure") | .id' | head -1)
  fails=$(gh run view --job "$J" --log 2>/dev/null | tr -d '\r' | perl -pe 's/\e\[[0-9;]*m//g' | grep -E "✘" | perl -pe 's/^.*[0-9]Z\s+//; s/^\s*✘\s+\d+\s+//')
  log "CI failed on run $RUN; failing tests:"; echo "$fails" | head -20
  if [ -n "$fails" ] && [ -z "$(echo "$fails" | grep -v 'visual.spec.ts')" ]; then
    n=$(zsh "$HERE/refresh-screenshots.sh" "$RUN" | tail -1 | sed -E 's/^copied ([0-9]+).*/\1/')
    git add e2e/__screenshots__ && git commit -q -m "Reference images from CI run $RUN ($n renderings)

${TRAIN_TRAILERS:-}"
    log "$n reference images copied and committed (NOT pushed): look at them, then push and run the train again"; exit 3
  fi
  if [ $attempt -eq 1 ] && [ -n "$fails" ] && [ -z "$(echo "$fails" | grep -vEf "$HERE/flaky-tests.txt")" ]; then
    log "known flaky test(s) only: re-running the failed job once"; gh run rerun "$RUN" --failed >/dev/null 2>&1; sleep 30; continue
  fi
  log "CI failed for another reason (or a known flake twice): read it with attempt-log.sh $RUN"; exit 4
done

gh pr ready "$PR" >/dev/null 2>&1 || true
sleep 5
if gh pr merge "$PR" --squash --match-head-commit "$head" > "$LOGS/train-$PR-merge.log" 2>&1; then
  log "MERGED #$PR ($BR @ ${head:0:7}): $(gh pr view "$PR" --json mergeCommit -q .mergeCommit.oid | cut -c1-7)"; exit 0
fi
log "merge refused: $(tail -2 "$LOGS/train-$PR-merge.log" | tr '\n' ' ')"; exit 5
