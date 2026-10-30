"""Check a script against what the audio actually says.

    python check_script.py AUDIO SCRIPT.txt OUT.json [--start S --end S]

Transcribes the audio on the laptop (faster-whisper "small", free; about
1/8 of real time on an Apple Silicon CPU) and compares the transcript with
the script word by word. Reports:

  not_spoken  script passages the audio skipped (character ranges into the
              script). Pass this file to align.py --check so those words are
              not forced onto audio they are not in.
  extra       things said that are not in the script (a heading read aloud,
              an ad-lib), with their time.
  differences every difference with its place in the script, by kind:
              skipped / added / misread / written (spelling only).
  match       fraction of words that agree (spelling and punctuation ignored).

Why: "polished" scripts are often edited after recording. In the Kuhn test,
chapter ten's script held five paragraphs (about 500 words) the narrator
never read, and chapter one's opening heading was spoken differently.
Run with the readalong venv: ~/.local/share/readalong/venv/bin/python
"""
import argparse
import difflib
import json
import re
import time

import numpy as np
from faster_whisper import WhisperModel

from align import SR, load_audio

norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())  # noqa: E731


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("audio")
    p.add_argument("script")
    p.add_argument("out")
    p.add_argument("--start", type=float)
    p.add_argument("--end", type=float)
    p.add_argument("--model", default="small", help="faster-whisper model (tiny, base, small, medium)")
    a = p.parse_args()

    t0 = time.time()
    audio = load_audio(a.audio, a.start, a.end).numpy().astype(np.float32)
    model = WhisperModel(a.model, device="cpu", compute_type="int8")
    heard = [w for seg in model.transcribe(audio, word_timestamps=True, language="en")[0] for w in seg.words]
    offset = a.start or 0.0

    script = open(a.script, encoding="utf-8").read()
    words = list(re.finditer(r"\S+", script))
    A = [norm(m.group()) for m in words]
    B = [norm(w.word) for w in heard]
    sm = difflib.SequenceMatcher(a=A, b=B, autojunk=False)

    not_spoken, extra = [], []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        n_script, n_heard = i2 - i1, j2 - j1
        # Script words with (almost) nothing heard in their place were skipped.
        # Short differences (a hyphen, "1.47" for "one point four seven") are
        # left to the aligner, which copes with them.
        skipped = (op == "delete" and n_script >= 3) or (op == "replace" and n_script >= 6 and n_heard * 3 <= n_script)
        if skipped:
            not_spoken.append({"from": words[i1].start(), "to": words[i2 - 1].end(), "words": n_script, "text": script[words[i1].start() : words[i2 - 1].end()][:160]})
        added = (op == "insert" and n_heard >= 3) or (op == "replace" and n_heard >= 6 and n_script * 3 <= n_heard)
        if added:
            extra.append({"at": round(offset + heard[j1].start, 2), "words": n_heard, "text": "".join(w.word for w in heard[j1:j2]).strip()[:160]})

    # Every difference, with where it is in the script and when it was heard,
    # so the script can be corrected (fix_script.py) or a misread word noted.
    #   skipped  script words with (almost) nothing heard in their place
    #   added    said, but not in the script (a heading read aloud, a footer)
    #   misread  a different word said ("Greek God" for "Great God")
    #   written  the same words written differently ("1.47" / "one point four
    #            seven", "out-ofdate" / "out of date"); nothing to fix
    differences = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            continue
        s_text = script[words[i1].start() : words[i2 - 1].end()] if i2 > i1 else ""
        h_text = "".join(w.word for w in heard[j1:j2]).strip()
        if norm(s_text) == norm(h_text) or (re.search(r"\d", h_text + s_text) and i2 - i1 <= 6 and j2 - j1 <= 4):
            kind = "written"
        elif any((n["from"], n["to"]) == (words[i1].start(), words[i2 - 1].end()) for n in not_spoken):
            kind = "skipped"
        elif any(e["at"] == round(offset + heard[j1].start, 2) for e in extra) if j2 > j1 else False:
            kind = "added"
        elif op == "delete":
            kind = "skipped"
        elif op == "insert":
            kind = "added"
        else:
            kind = "misread"
        at = words[i1].start() if i1 < len(words) else len(script)
        differences.append({
            "kind": kind,
            "from": at,
            "to": words[i2 - 1].end() if i2 > i1 else at,
            "script": s_text[:300],
            "heard": h_text[:300],
            "heard_at": round(offset + heard[j1].start, 2) if j2 > j1 else None,
        })

    report = {
        "audio": a.audio,
        "script": a.script,
        "match": round(sm.ratio(), 4),
        "script_words": len(A),
        "heard_words": len(B),
        "not_spoken": not_spoken,
        "extra": extra,
        "differences": differences,
        "seconds_taken": round(time.time() - t0, 1),
    }
    json.dump(report, open(a.out, "w"), indent=1)
    skipped_words = sum(n["words"] for n in not_spoken)
    misread = [d for d in differences if d["kind"] == "misread"]
    print(f"match {report['match']:.1%}; {len(not_spoken)} skipped passages ({skipped_words} words); {len(extra)} additions; {len(misread)} misread; {report['seconds_taken']}s; wrote {a.out}")


if __name__ == "__main__":
    main()
