"""Unit mutation check (M14): break one line on purpose, run the named Vitest files, restore.

usage: python3 scripts/m14/mutate.py "NAME" FILE "OLD" "NEW" TEST_FILE [TEST_FILE ...]
OLD must match exactly once. Pass test files as separate arguments (in zsh a
variable holding two paths is ONE argument). "exit=1 []" with no test counts
means the tests did not run: not a caught mutation.
"""
import subprocess, sys, shutil
# usage: mutate.py name file old new test-files...
name, path, old, new, *tests = sys.argv[1:]
src = open(path).read()
assert src.count(old) == 1, f"{name}: match count {src.count(old)}"
shutil.copy(path, path + ".bak")
try:
    open(path, "w").write(src.replace(old, new))
    r = subprocess.run(["npx", "vitest", "run", *tests], capture_output=True, text=True)
    out = r.stdout + r.stderr
    fails = [l.strip() for l in out.splitlines() if l.strip().startswith(("×", "FAIL")) or " ✗ " in l]
    summary = [l.strip() for l in out.splitlines() if l.strip().startswith("Tests ")]
    print(f"[{name}] exit={r.returncode} {summary}")
    for l in fails[:6]: print("   ", l[:180])
finally:
    shutil.move(path + ".bak", path)
