#!/bin/zsh
# Runs Neolibrary's Playwright browser tests inside Playwright's own Linux image: the same system CI uses, on the Mac,
# in a few minutes instead of a 15-20 minute CI round. Written for Claude sessions (see ../SKILL.md).
#
#   linux-run.sh [--ref <git ref>] [--env NAME=VALUE]... -- <playwright test arguments>
#
#   linux-run.sh -- --project reader -g "two pages"           # this checkout, as it is now (uncommitted changes too)
#   linux-run.sh --ref origin/main -- --project reader -g "…"  # the control: main's code, in its own folder
#   linux-run.sh --env EXP=1 -- --project reader -g "…"         # a switch the test reads (process.env.EXP)
#   linux-run.sh                                               # the whole suite, as CI runs it on a pull request
#
# --ignore-snapshots and CI_SKIP_WEBKIT=1 are always set, as on a pull request's CI. Prints Playwright's own summary
# lines (passed, failed, flaky, did not run) and each failing test's first error. Exit code is Playwright's.
#
# Do not run this and a Mac browser run in the same folder at once: both build into .next and write .data/e2e.
set -eu -o pipefail

ref=""
envs=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --ref) ref=$2; shift 2 ;;
    --env) envs+=(-e "$2"); shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done

root=$(git rev-parse --show-toplevel)
cd "$root"
version=$(node -p "require('./package.json').devDependencies['@playwright/test']")
image="mcr.microsoft.com/playwright:v${version}-noble"

dir=$root
if [[ -n $ref ]]; then
  # The control gets a folder of its own, kept for the next run (remove: git worktree remove --force <folder>).
  sha=$(git rev-parse --short "$ref")
  dir="$HOME/.cache/neolibrary-linux-runs/$sha"
  if [[ ! -d $dir ]]; then
    mkdir -p "${dir:h}"
    git worktree add --detach "$dir" "$ref" >/dev/null
  fi
fi
# colima, the Mac's Docker, shares only the home folder: anywhere else the container sees an empty folder.
if [[ $dir != $HOME/* ]]; then
  echo "linux-run: the folder must be under your home folder (colima shares only that): $dir" >&2
  exit 2
fi

colima status >/dev/null 2>&1 || colima start >/dev/null
docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image"

# Linux packages live in a Docker volume named after the lockfile, so the Mac's node_modules is never touched and a
# second run with the same packages skips the install.
lock=$(shasum "$dir/package-lock.json" | cut -c1-12)
volume="nl_linux_nm_${lock}"

echo "linux-run: $image, folder ${dir/#$HOME/~}${ref:+ ($ref = $sha)}, packages volume $volume"
log=$(mktemp -t linux-run)
set +e
docker run --rm --ipc=host \
  -v "$dir":/work -v "$volume":/work/node_modules -w /work \
  -e PORT=3307 -e CI_SKIP_WEBKIT=1 "${envs[@]}" \
  "$image" bash -lc '
    if [ ! -x node_modules/.bin/playwright ]; then npm ci --no-audit --no-fund >/dev/null 2>&1 || { echo "npm ci failed"; exit 3; }; fi
    npx playwright test --ignore-snapshots --reporter=line "$@"
  ' bash "$@" >"$log" 2>&1
code=$?
set -e
grep -E '^\s+[0-9]+\) \[|^\s+(Error|Expected|Received)|^\s+[0-9]+ (passed|failed|flaky|skipped|did not run)|npm ci failed' "$log" || true
echo "linux-run: exit $code; full log: $log"
exit $code
