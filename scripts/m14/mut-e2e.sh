#!/bin/zsh
# usage: mut-e2e.sh NAME FILE OLD NEW PROJECT [GREP]
# Break FILE (OLD -> NEW, exactly one match), build, serve on the database the last full run left,
# run PROJECT with --no-deps (optionally -g GREP), print the result, restore the file.
cd "$(git rev-parse --show-toplevel)"
NAME=$1 F=$2 OLD=$3 NEW=$4 PROJ=$5 GREP=$6
cp "$F" /tmp/mut.bak
python3 - "$F" "$OLD" "$NEW" <<'PY'
import sys
p,old,new=sys.argv[1:4]; s=open(p).read()
assert s.count(old)==1, f"match count {s.count(old)}"
open(p,"w").write(s.replace(old,new))
PY
[[ $? -ne 0 ]] && { echo "[$NAME] PATCH FAILED"; exit 1; }
npm run build > /tmp/mut-build.log 2>&1 || { echo "[$NAME] BUILD FAILED"; tail -5 /tmp/mut-build.log; }
mv /tmp/mut.bak "$F"
PGLITE_DIR=.data/e2e FILES_DIR=.data/e2e-files SETUP_CODE=e2e-setup-code AI_FAKE=1 FILES_MAX_RANGE_BYTES=65536 npx next start -p 3100 --keepAliveTimeout 120000 > /tmp/mut-server.log 2>&1 &
SERVER=$!
for i in {1..60}; do curl -sf http://127.0.0.1:3100/api/health >/dev/null && break; sleep 1; done
if [[ -n $GREP ]]; then ARGS=(-g "$GREP"); else ARGS=(); fi
OUT=$(npx playwright test --project "$PROJ" --no-deps --ignore-snapshots $ARGS 2>&1)
kill $SERVER; wait $SERVER 2>/dev/null
echo "[$NAME] $(echo "$OUT" | grep -E '^\s+[0-9]+ (passed|failed)' | tr -s ' ' | tr '\n' ' ')"
echo "$OUT" | grep -E "✘" | head -5
echo "$OUT" | grep -E "^\s+> [0-9]+ \|" | head -3
git diff --quiet -- "$F" && echo "[$NAME] restored" || echo "[$NAME] NOT RESTORED"
