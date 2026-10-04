"""Check a read-along package before anyone imports it.

    python validate_package.py PACKAGE_DIR

Checks, and says plainly what is wrong:
  - manifest.json has the right format name and every file it names exists,
    with the recorded sha256 (so audio and timings were not swapped later);
  - each chapter's timings cover every word of its script, in order, with
    character offsets that point at that very word;
  - spoken words have times inside the chapter's span, never going backwards;
  - words marked "not_spoken" have no times;
  - reports low-confidence words and paragraphs not found in the book
    (warnings, not failures: spoken headings are never in the book).
Exit 0 and a one-line summary when the package is usable.
"""
import hashlib
import json
import re
import sys
from pathlib import Path


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main():
    root = Path(sys.argv[1])
    errors, warnings = [], []
    m = json.loads((root / "manifest.json").read_text())
    if m.get("format") != "neolibrary-readalong/1":
        errors.append(f"format is {m.get('format')!r}, expected 'neolibrary-readalong/1'")
    for a in m["audio"]:
        f = root / a["file"]
        if not f.exists():
            errors.append(f"missing {a['file']}")
        elif sha256(f) != a["sha256"]:
            errors.append(f"{a['file']} does not match its recorded sha256")
    total = spoken = low = 0
    for c in m["chapters"]:
        script = (root / c["script"]).read_text(encoding="utf-8")
        words = list(re.finditer(r"\S+", script))
        t = json.loads((root / c["timings"]).read_text())["words"]
        if len(t) != len(words):
            errors.append(f"chapter {c['n']}: {len(t)} timed words for {len(words)} script words")
            continue
        last = c["start"]
        for i, (w, s) in enumerate(zip(t, words)):
            if (w["from"], w["to"]) != (s.start(), s.end()) or script[w["from"] : w["to"]] != w["w"]:
                errors.append(f"chapter {c['n']} word {i}: offsets do not point at {w['w']!r}")
                break
            if w["source"] == "not_spoken":
                if w["start"] is not None:
                    errors.append(f"chapter {c['n']} word {i}: marked not spoken but has a time")
                continue
            if not (c["start"] - 0.5 <= w["start"] <= w["end"] <= c["end"] + 0.5):
                errors.append(f"chapter {c['n']} word {i} {w['w']!r}: time {w['start']}-{w['end']} outside the chapter ({c['start']}-{c['end']})")
                break
            if w["start"] < last - 0.05:
                errors.append(f"chapter {c['n']} word {i} {w['w']!r}: starts before the previous word")
                break
            last = w["start"]
            spoken += 1
            low += w["score"] < -2
        total += len(words)
    bm = json.loads((root / m["book_map"]).read_text())["paragraphs"]
    missing = [p for p in bm if not p["found"]]
    if low:
        warnings.append(f"{low} low-confidence words ({low / max(spoken, 1):.1%})")
    if missing:
        warnings.append(f"{len(missing)} of {len(bm)} paragraphs not found in the book (spoken headings are expected here)")
    for e in errors:
        print("ERROR:", e)
    if errors:
        sys.exit(1)
    print(f"Package OK: {len(m['chapters'])} chapters, {total:,} words ({total - spoken:,} not spoken)" + (f"; warnings: {'; '.join(warnings)}" if warnings else ""))


if __name__ == "__main__":
    main()
