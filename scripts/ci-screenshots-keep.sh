#!/bin/sh
# Keeps the ci-screenshots branch small (Open unknowns row 37; Samuel's yes, 2026-11-15).
#
# Usage: sh scripts/ci-screenshots-keep.sh <commit> [keep]
# Prints a new commit with no parent whose files are <commit>'s newest <keep> (default 30) pull requests'
# folders (pr-<number>, the highest numbers) and every top-level entry not named pr-<number>.
#
# Why no parent: pictures stay stored as long as any commit on the branch holds them, so removing old folders
# in an ordinary commit frees nothing. CI's publish step pushes this commit in place of the branch, with a lease
# on the commit it fetched, so a run that pushed in between is never overwritten (the step fetches and tries again).
#
# It reads only the top-level list of folders, never a picture, so it works in CI's clone that has no pictures
# (git fetch --filter=blob:none).
set -eu
commit=$1
keep=${2:-30}
case $keep in '' | *[!0-9]*) echo "keep must be a whole number, got: $keep" >&2; exit 2 ;; esac

listing=$(git ls-tree "$commit")
tree=$(
  {
    printf '%s\n' "$listing" | grep -Ev '	pr-[0-9]+$' | grep -v '^$' || true
    printf '%s\n' "$listing" | grep -E '	pr-[0-9]+$' | awk -F '\tpr-' '{ print $2 "\t" $0 }' | sort -rn | head -n "$keep" | cut -f 2-
  } | git mktree
)
git commit-tree "$tree" -m "Screenshots of the newest $keep pull requests (from $(git rev-parse --short "$commit"))"
