"""Correct a script to match what the audio says, using a check_script.py report.

    python fix_script.py SCRIPT.txt CHECK.json OUT.txt [--changes CHANGES.md]

Applies only the changes that are safe to make without a person listening:
  - skipped passages (3+ words never read) are removed;
  - added passages (3 to 15 words said but not in the script: a heading read
    aloud, a page footer) are inserted, in the transcriber's spelling, marked
    in the changes list for checking; longer ones are only listed, because
    they are usually the voice garbling or the transcriber mishearing;
  - "misread" single words are NOT changed: most are the transcriber hearing
    a sound-alike ("pains" for "panes"), so they are listed for a person to
    check by ear;
  - a word cut off in the script and said in full ("justifica") is completed;
  - "written" differences (spelling, numbers, Roman numerals) are left alone.
The original file is never modified. The changes list says what was done,
where, and why, so the edit can be reviewed or undone.
"""
import argparse
import json
import re
from pathlib import Path

# Additions longer than this are listed for a person to listen to, never inserted.
MAX_INSERT_WORDS = 15

norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())  # noqa: E731


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("script")
    p.add_argument("check")
    p.add_argument("out")
    p.add_argument("--changes", help="write a Markdown list of the changes here")
    a = p.parse_args()

    text = Path(a.script).read_text(encoding="utf-8")
    report = json.loads(Path(a.check).read_text())
    diffs = report.get("differences")
    if diffs is None:
        raise SystemExit("This check report has no 'differences'; re-run check_script.py.")

    edits = []  # (from, to, replacement, note)
    review = []
    for d in diffs:
        words = len(d["script"].split()) if d["script"] else 0
        heard = len(d["heard"].split()) if d["heard"] else 0
        if d["kind"] == "skipped" and words >= 3:
            if heard:  # a few other words were said instead ("Preface." for a 9-word heading)
                edits.append((d["from"], d["to"], d["heard"].strip(), f"replaced {words} words never read (“{d['script'][:100]}”) with what was said: “{d['heard'][:80]}”"))
            else:
                edits.append((d["from"], d["to"], "", f"removed {words} words never read: “{d['script'][:120]}”"))
        elif d["kind"] == "added" and heard > MAX_INSERT_WORDS:
            # Long stretches said that are not in the script are often the voice
            # garbling (long text-to-speech runs can drift into made-up words),
            # or the transcriber mishearing: never paste them into the script.
            review.append(f"- at {d['heard_at']}s: {heard} words said that are not in the script (not inserted; listen): “{d['heard'][:160]}”")
        elif d["kind"] == "added" and heard >= 3:
            # Inserted as its own sentence before the script text at that point.
            insert = d["heard"].strip()
            if d["to"] > d["from"]:
                # A few script words, then more said after them ("nineteen
                # sixty-two" heard as "1962. Volume 2, Number 2. …"): keep the
                # script's own words and add only what follows them.
                toks = insert.split()
                lead = 0
                while lead < len(toks) and lead < words + 1 and (re.search(r"\d", toks[lead]) or norm(toks[lead]) in norm(d["script"])):
                    lead += 1
                rest = " ".join(toks[lead:])
                if rest:
                    sep = " " if re.search(r"[.!?:;,]$", d["script"]) else ". "
                    edits.append((d["to"], d["to"], sep + rest, f"after “{d['script'][:60]}”, inserted what was said: “{rest[:120]}” (check spelling)"))
            else:
                edits.append((d["from"], d["from"], insert + " ", f"inserted what was said at {d['heard_at']}s: “{insert[:120]}” (check spelling)"))
        elif d["kind"] == "misread" and words == 1 and heard == 1 and len(norm(d["script"])) >= 4 and norm(d["heard"]).startswith(norm(d["script"])) and len(norm(d["heard"])) - len(norm(d["script"])) >= 3:
            # (3+ letters missing: "justifica"; not spelling like "fulfil"/"fulfill")
            # A word cut off in the script ("justifica") that was said in full.
            edits.append((d["from"], d["to"], d["heard"].strip(), f"completed the cut-off word “{d['script']}” as said: “{d['heard'].strip()}”"))
        elif d["kind"] == "misread" and all(re.fullmatch(r"[IVXLC]+[.,;:]?", w) for w in d["script"].split()):
            continue  # Roman numerals read as numbers ("III" / "three"): spelling only
        elif d["kind"] == "misread":
            review.append(f"- at {d['heard_at']}s: script “{d['script'][:80]}”, heard “{d['heard'][:80]}” (left as written; check by ear)")

    out = text
    for f, t, rep, _ in sorted(edits, key=lambda e: -e[0]):  # from the end, so offsets stay valid
        out = out[:f] + rep + out[t:]
    Path(a.out).write_text(out, encoding="utf-8")

    lines = [f"# Changes to {Path(a.script).name}", "", f"Made from {Path(a.check).name} (match {report['match']:.1%}). Original unchanged.", ""]
    lines += [f"- {note} (characters {f}–{t})" for f, t, _, note in sorted(edits)] or ["- no changes"]
    if review:
        lines += ["", "## Not changed: listen to these", ""] + review
    if a.changes:
        Path(a.changes).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(edits)} changes, {len(review)} words to check by ear; wrote {a.out}")


if __name__ == "__main__":
    main()
