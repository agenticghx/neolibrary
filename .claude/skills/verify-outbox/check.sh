#!/bin/sh
# The offline note outbox check (see SKILL.md beside this file). Runs TLC, the TLA+ model checker, through
# scripts/tlc.sh (pinned versions) on Outbox.tla:
#   1. Outbox.cfg and Readers.cfg list the rules the code keeps today. Each run must end with exit 0.
#   2. FINDINGS (below) are rules the code breaks today, each in one scenario. Each run must still end with exit 12.
# Prints one line per run, then a last line starting "verify-outbox:". Exits 0 only when every result is as recorded.
# Usage, from anywhere inside the repository: sh .claude/skills/verify-outbox/check.sh
set -u

# id, rule, scenario (the config whose CONSTANTS it runs with). Keep in step with "Known findings" in SKILL.md.
FINDINGS='F5 OnlyYourSession Readers
F7 RefusedNotResent Outbox'

here=$(cd "$(dirname "$0")" && pwd)
root=$(git rev-parse --show-toplevel 2>/dev/null) || root=$(cd "$here/../../.." && pwd)
tlc="$root/scripts/tlc.sh"
[ -f "$tlc" ] || { echo "verify-outbox: cannot find scripts/tlc.sh (run from inside the repository)" >&2; exit 2; }
work=$(mktemp -d "${TMPDIR:-/tmp}/verify-outbox.XXXXXX")
trap 'rm -r "$work"' EXIT
cp "$here/Outbox.tla" "$work/"

changed=0
held=0
known=0

# run CFG -> sets code, rule (the rule TLC reports broken, if any), states, secs; keeps TLC's output in $work/last.out
run() {
  sh "$tlc" "$work/Outbox.tla" "$work/$1" >"$work/last.out" 2>&1
  code=$?
  rule=$(sed -n 's/^Error: Invariant \([A-Za-z]*\) is violated\.$/\1/p' "$work/last.out" | head -1)
  states=$(sed -n 's/.* \([0-9]*\) distinct states found, 0 states left on queue\./\1/p' "$work/last.out" | tail -1)
  secs=$(sed -n 's/^Finished in \([^ ]*\) .*/\1/p' "$work/last.out" | tail -1)
}

for scenario in Outbox Readers; do
  cp "$here/$scenario.cfg" "$work/"
  run "$scenario.cfg"
  if [ "$code" -eq 0 ]; then
    held=$((held + 1))
    echo "holds    $scenario.cfg: every listed rule holds (${states:-?} states, ${secs:-?})"
  else
    changed=1
    echo "BROKEN   $scenario.cfg: exit $code${rule:+, rule $rule is broken}. TLC's output:"
    sed -n '/^Error:/,$p' "$work/last.out" | head -80
  fi
done

echo "$FINDINGS" | while read -r id target scenario; do
  sed '/^INVARIANTS/,$d' "$here/$scenario.cfg" >"$work/finding.cfg"
  printf 'INVARIANT %s\nCHECK_DEADLOCK FALSE\n' "$target" >>"$work/finding.cfg"
  run finding.cfg
  if [ "$code" -eq 12 ] && [ "$rule" = "$target" ]; then
    echo "known    $id $target still breaks ($scenario scenario)"
  elif [ "$code" -eq 0 ]; then
    echo "FIXED?   $id $target now holds ($scenario scenario, ${states:-?} states): confirm, then move it to $scenario.cfg and out of FINDINGS"
    echo x >>"$work/changes"
  else
    echo "ERROR    $id $target: TLC exit $code. TLC's output:"
    tail -30 "$work/last.out"
    echo x >>"$work/changes"
  fi
done

[ -f "$work/changes" ] && changed=1
findings=$(echo "$FINDINGS" | wc -l | tr -d ' ')
if [ "$changed" -eq 0 ]; then
  echo "verify-outbox: as recorded: $held scenarios hold every listed rule; $findings known findings still break"
  exit 0
fi
echo "verify-outbox: CHANGED: a result differs from the record above; read SKILL.md, 'Reading a result'"
exit 1
