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
J=$(gh api "$jobs" --jq '.jobs[] | select(.name | startswith("Browser")) | .id')
[ -z "$J" ] && { echo "no browser job"; exit 0; }
LOG=${TMPDIR:-/tmp}/neolibrary-train/job-$J.log
gh api "repos/$NWO/actions/jobs/$J/logs" > "$LOG" 2>/dev/null || { echo "no log for job $J"; exit 1; }
# The raw log has CRLF line endings, colour codes, and a timestamp before each line; BSD sed knows neither \s nor \x1b.
clean() { tr -d '\r' < "$LOG" | perl -pe 's/\e\[[0-9;]*m//g; s/^[0-9T:.\-]+Z\s+//'; }
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
