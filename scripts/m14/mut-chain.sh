#!/bin/zsh
# usage: mut-chain.sh NAME FILE OLD NEW PROJECT [GREP]
# Break FILE (exactly one match), run PROJECT and its dependencies from a fresh database
# (Playwright builds the app), print the result, restore the file.
cd "$(git rev-parse --show-toplevel)"
NAME=$1 F=$2 OLD=$3 NEW=$4 PROJ=$5 GREP=$6
cp "$F" /tmp/mutc.bak
python3 - "$F" "$OLD" "$NEW" <<'PY'
import sys
p,old,new=sys.argv[1:4]; s=open(p).read()
assert s.count(old)==1, f"match count {s.count(old)}"
open(p,"w").write(s.replace(old,new))
PY
[[ $? -ne 0 ]] && { echo "[$NAME] PATCH FAILED"; mv /tmp/mutc.bak "$F"; exit 1; }
rm -rf .data/e2e .data/e2e-files
if [[ -n $GREP ]]; then ARGS=(-g "$GREP"); else ARGS=(); fi
OUT=$(npx playwright test --project "$PROJ" --ignore-snapshots $ARGS 2>&1)
mv /tmp/mutc.bak "$F"
echo "[$NAME] $(echo "$OUT" | grep -E '^\s+[0-9]+ (passed|failed|did not run)' | tr -s ' ' | tr '\n' ' ')"
echo "$OUT" | grep -E "✘" | head -4
echo "$OUT" | grep -E "^ +> [0-9]+ [|]" | head -3
git diff --quiet -- "$F" && echo "[$NAME] restored" || echo "[$NAME] NOT RESTORED"
