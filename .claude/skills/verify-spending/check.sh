#!/bin/sh
# The one command of the verify-spending skill. Run it from the repository's root folder:
#   sh .claude/skills/verify-spending/check.sh
# It runs every model config through scripts/tlc.sh and compares the result with the
# "Expected:" line at the top of that config, runs the replays on the real code, and says
# whether the covered code changed since the sync commit named in SKILL.md.
# Exit 0: everything as expected. Exit 1: a config or a replay did not do what it should.
# Exit 3: all as expected, but the covered code changed since the sync commit (read SKILL.md).
set -u
here=.claude/skills/verify-spending
[ -f "$here/SKILL.md" ] || { echo "Run this from the repository's root folder." >&2; exit 2; }

covered="lib/ai/generate.ts lib/ai/model.ts lib/ai/claude.ts lib/library/rewritten-turn.ts lib/player/session.ts
app/(reader)/books/[id]/read/RewrittenPane.tsx lib/library/text-edition.ts lib/library/audio.ts
lib/library/pictures.ts lib/library/voice-notes.ts"

bad=0
log=$(mktemp -d "${TMPDIR:-/tmp}/verify-spending.XXXXXX")
trap '[ "$bad" -eq 0 ] && rm -r "$log"' EXIT

echo "== Models (TLC) =="
for cfg in "$here"/*.cfg; do
  name=$(basename "$cfg" .cfg)
  spec="$here/${name%%-*}.tla"
  want=$(sed -n 's/.*Expected: \([A-Za-z]*\) breaks.*/\1/p' "$cfg" | head -1)
  sh scripts/tlc.sh "$spec" "$cfg" >"$log/$name.out" 2>&1
  code=$?
  broke=$(sed -n 's/^Error: Invariant \([A-Za-z]*\) is violated.*/\1/p' "$log/$name.out" | head -1)
  states=$(sed -n 's/.* \([0-9]*\) distinct states found.*/\1/p' "$log/$name.out" | head -1)
  if [ -z "$want" ] && [ "$code" -eq 0 ]; then
    echo "ok    $name: every rule holds ($states states)"
  elif [ -n "$want" ] && [ "$code" -eq 12 ] && [ "$broke" = "$want" ]; then
    echo "ok    $name: $broke breaks, as expected ($states states)"
  else
    bad=1
    echo "WRONG $name: expected ${want:-every rule to hold}; TLC exit $code${broke:+, $broke breaks}. Output: $log/$name.out"
    # The path TLC found, one action per line (read it in a reader's words with /pstack:statechart).
    grep -E '^Error: (Invariant|Deadlock|Parsing|Semantic)' "$log/$name.out" | head -1 | sed 's/^/      /'
    sed -n 's/^State \([0-9]*\): <\([A-Za-z]*\).*/\1. \2/p' "$log/$name.out" | sed 's/^/      /'
    grep -q '^Error:' "$log/$name.out" || tail -15 "$log/$name.out" | sed 's/^/      /'
  fi
done

echo "== Replays on the real code (vitest) =="
if npx vitest run --config "$here/replay/vitest.config.mts" >"$log/replays.out" 2>&1; then
  echo "ok    $(grep -E 'Tests +[0-9]+ passed' "$log/replays.out" | sed 's/^ *//')"
else
  bad=1
  echo "WRONG replays:"
  grep -E '×|FAIL|Tests |AssertionError|Error:' "$log/replays.out" | sed 's/^/      /'
  echo "      Full output: $log/replays.out"
fi

echo "== Covered code since the sync commit =="
sync=$(sed -n 's/^Sync commit: `\([0-9a-f]*\)`.*/\1/p' "$here/SKILL.md" | head -1)
if ! git cat-file -e "$sync^{commit}" 2>/dev/null; then
  bad=1
  echo "WRONG the sync commit in SKILL.md ($sync) is not in this repository (a squash-merge changes hashes): set it to the commit the models were checked at"
fi
set -f
changed=$(GIT_LITERAL_PATHSPECS=1 git diff --name-only "$sync" -- $covered)
set +f
if [ -z "$changed" ]; then
  echo "ok    no covered file changed since $sync"
else
  echo "LOOK  changed since $sync (read SKILL.md, \"When the covered code changed\"):"
  echo "$changed" | sed 's/^/      /'
fi

if [ "$bad" -ne 0 ]; then
  echo "verify-spending: NOT as expected (see WRONG above)"
  exit 1
fi
if [ -n "$changed" ]; then
  echo "verify-spending: as expected, but the covered code changed since the sync commit"
  exit 3
fi
open=$(ls "$here"/*-finding-*.cfg | wc -l | tr -d ' ')
echo "verify-spending: all as expected (the $open finding configs still break their rules: the known findings in SKILL.md are still in the code)"
