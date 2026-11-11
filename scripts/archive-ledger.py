#!/usr/bin/env python3
"""Moves old Log entries of PROGRESS.md into docs/ledger-archive/<year>-<month>.md, so the ledger a session must read
stays short. Keeps the newest KEEP entries. A pure move: every entry's text is kept byte for byte, and the script
checks that before it writes anything. Safe to run again (entries already in an archive file are left there).

Usage: python3 scripts/archive-ledger.py [--keep 15] [--check]
"""
import argparse, pathlib, re, sys

ap = argparse.ArgumentParser()
ap.add_argument("--keep", type=int, default=15)
ap.add_argument("--check", action="store_true", help="say what would move; write nothing")
args = ap.parse_args()

root = pathlib.Path(__file__).resolve().parent.parent if pathlib.Path(__file__).resolve().parent.name == "scripts" else pathlib.Path.cwd()
ledger = root / "PROGRESS.md"
archive_dir = root / "docs" / "ledger-archive"
text = ledger.read_text(encoding="utf-8")

log_at = text.index("\n## Log\n") + 1
head, log = text[:log_at], text[log_at:]
assert log.count("\n## ") == 0, "a section follows ## Log: this script expects the Log to be last"
starts = [m.start() for m in re.finditer(r"^### ", log, flags=re.M)]
preamble, entries = log[: starts[0]], [log[a:b] for a, b in zip(starts, starts[1:] + [len(log)])]
assert preamble + "".join(entries) == log
if len(entries) <= args.keep:
    print(f"{len(entries)} entries, keeping {args.keep}: nothing to move.")
    sys.exit(0)
kept, moved = entries[: args.keep], entries[args.keep :]

by_month = {}
for e in moved:
    m = re.match(r"### (\d{4}-\d{2})-\d{2}", e)
    assert m, f"an entry's heading does not start with a date: {e[:80]!r}"
    by_month.setdefault(m.group(1), []).append(e)

POINTER = "Older entries are in `docs/ledger-archive/`, one file a month, newest first (moved there by `scripts/archive-ledger.py`; nothing was reworded).\n\n"
new_preamble = preamble if POINTER in preamble else preamble + POINTER
new_text = head + new_preamble + "".join(kept)

files = {}
for month, es in by_month.items():
    path = archive_dir / f"{month}.md"
    title = f"# Neolibrary ledger: Log entries of {month}\n\nWritten for: Claude sessions and Samuel, looking up what was done and why. Moved here from `PROGRESS.md` word for word; newest first.\n\n"
    old = path.read_text(encoding="utf-8") if path.exists() else title
    assert old.startswith(title), f"{path} does not start with the expected title"
    # Newer entries go above the ones already there.
    files[path] = title + "".join(es) + old[len(title) :]

# The proof that this is a move: nothing but the pointer line is new, and every entry is somewhere.
assert new_text.replace(POINTER, "", 1) == head + preamble.replace(POINTER, "", 1) + "".join(kept)
assert "".join(kept) + "".join(moved) == "".join(entries)
for month, es in by_month.items():
    assert "".join(es) in files[archive_dir / f"{month}.md"]
count = lambda s: len(re.findall(r"^### \d{4}-\d{2}-\d{2}", s, flags=re.M))
print(f"{len(entries)} entries: {len(kept)} stay, {len(moved)} move to {len(files)} file(s): " + ", ".join(f"{p.name} +{len(by_month[p.stem])}" for p in sorted(files)))
print(f"PROGRESS.md: {text.count(chr(10))} lines before, {new_text.count(chr(10))} after")
if args.check:
    sys.exit(0)
archive_dir.mkdir(parents=True, exist_ok=True)
for path, body in files.items():
    path.write_text(body, encoding="utf-8")
ledger.write_text(new_text, encoding="utf-8")
