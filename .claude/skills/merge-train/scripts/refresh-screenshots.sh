#!/bin/zsh
# Copies CI's renderings of the pages whose screenshot comparison failed into e2e/__screenshots__ (the references).
# The grid images on the ci-screenshots branch are viewport-only; the references are the full-page *-actual.png
# files in the run's playwright-report artifact. Nothing is committed: look at the images first.
# usage: refresh-screenshots.sh <run-id> [--dry]      (--dry: list what would be copied)
set -u
HERE=${0:A:h}
REPO=$(git -C "$HERE" rev-parse --show-toplevel) || exit 1
cd "$REPO" || exit 1
RUN=$1 DRY=${2:-}
DIR=${TMPDIR:-/tmp}/neolibrary-train/report-$RUN
rm -rf "$DIR" && gh run download "$RUN" -n playwright-report -D "$DIR" >/dev/null 2>&1 || { echo "no playwright-report artifact for run $RUN (kept 14 days)"; exit 1; }
n=0
for f in $(find "$DIR" -name "*-actual.png" | sort); do
  d=$(basename $(dirname "$f")); name=$(basename "$f" -actual.png); proj=${d#visual-$name-looks-as-approved-}
  echo "$name-$proj.png"
  [ "$DRY" = "--dry" ] || cp "$f" "e2e/__screenshots__/$name-$proj.png"
  n=$((n+1))
done
[ "$DRY" = "--dry" ] && { echo "would copy $n"; exit 0; }
echo "copied $n into e2e/__screenshots__ (not committed: look at them first)"
