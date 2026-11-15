#!/bin/zsh
# Prints a CI run's failing browser tests and the first lines of each error, for any attempt (a re-run keeps the run
# id and bumps the attempt; the plain log view shows only the latest attempt).
# usage: attempt-log.sh <run-id> [attempt]      (default: the latest attempt)
set -u
REPO=$(git rev-parse --show-toplevel 2>/dev/null) || exit 1
NWO=$(gh repo view --json nameWithOwner -q .nameWithOwner) || exit 1
RUN=$1 ATTEMPT=${2:-}
if [ -n "$ATTEMPT" ]; then jobs="repos/$NWO/actions/runs/$RUN/attempts/$ATTEMPT/jobs"; else jobs="repos/$NWO/actions/runs/$RUN/jobs"; fi
gh api "$jobs" --jq '.jobs[] | "\(.name): \(.status)/\(.conclusion)"'
# CI runs several browser machines (behavior, behavior-2, branches, readalong; 2026-11): read each one that failed.
J=$(gh api "$jobs" --jq '.jobs[] | select((.name | startswith("Browser")) and .conclusion == "failure") | .id')
[ -z "$J" ] && { echo "no failed browser job"; exit 0; }
mkdir -p "${TMPDIR:-/tmp}/neolibrary-train"
for id in ${(f)J}; do
  name=$(gh api "repos/$NWO/actions/jobs/$id" --jq .name)
  LOG=${TMPDIR:-/tmp}/neolibrary-train/job-$id.log
  # curl, not gh api: gh refuses a log with colour codes in it.
  curl -sfL -H "Authorization: Bearer $(gh auth token)" "https://api.github.com/repos/$NWO/actions/jobs/$id/logs" > "$LOG" || { echo "no log for job $id"; continue; }
  # The raw log has CRLF line endings, colour codes, and a timestamp before each line; BSD sed knows neither \s nor \x1b.
  clean() { tr -d '\r' < "$LOG" | perl -pe 's/\e\[[0-9;]*m//g; s/^[0-9T:.\-]+Z\s+//'; }
  echo "=== $name"
  if ! clean | grep -q -E "^[0-9]+ (failed|passed)"; then
    echo "(no test results in this job's log: it failed for another reason, such as a step before or after the tests)"
    echo "(full log: $LOG)"
    continue
  fi
  echo "--- failing tests"
  clean | grep -E "✘" | perl -pe 's/^\s*✘\s+\d+\s+//'
  echo "--- summary"
  clean | grep -E "^[0-9]+ (failed|passed|did not run|flaky|skipped)" | tr '\n' ' '; echo
  echo "--- first error of each failure"
  clean | grep -n -E "^[0-9]+\) \[" | cut -d: -f1 | while read -r line; do
    clean | sed -n "${line},$((line+16))p" | grep -E "^\s*[0-9]+\) \[|Error|Timeout|Expected|Received|interrupted|spec\.ts:[0-9]+:[0-9]+" | head -5
    echo
  done
  echo "(full log: $LOG)"
done
