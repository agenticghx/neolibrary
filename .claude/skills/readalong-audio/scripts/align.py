"""Forced alignment: measure when each word of a known script is spoken.

    python align.py AUDIO SCRIPT.txt OUT.json [--start S --end S] [--offset S]

A speech-recognition model (MMS-300m, a CTC model: it scores which letter is
being said every 20 ms) listens to the audio while holding the script, and
the best path through the letters gives every word a start and end. Runs on
the laptop: an 18-minute chapter takes about 10 s on Apple Silicon.

Long audio is aligned in pieces of about PIECE_SECONDS, each starting where
the previous one ended, so memory stays small for any chapter length.

Output: {"words": [{"w","from","to","start","end","score","source"}], ...}
  from/to   character offsets into the script (end exclusive), so the app
            can find the word in the script without guessing which "the".
  start/end seconds from the start of the audio file (plus --offset).
  score     the model's log-confidence for the word: 0 is certain; below
            about -2 means it probably was not spoken as written (see
            check_script.py).
Run with the readalong venv: ~/.local/share/readalong/venv/bin/python
"""
import argparse
import json
import re
import subprocess
import sys
import time

import numpy as np
import torch
from ctc_forced_aligner import (
    generate_emissions,
    get_alignments,
    get_spans,
    load_alignment_model,
    postprocess_results,
    preprocess_text,
)

from timing_order import in_order  # noqa: E402  (this folder)

SR = 16000
PIECE_SECONDS = 300  # target length of one alignment piece
SPEECH_CHARS_PER_SECOND = 14  # rough narration speed, only used to size pieces


def load_audio(path, start=None, end=None):
    cmd = ["ffmpeg", "-v", "error", "-nostdin"]
    if start is not None:
        cmd += ["-ss", str(start)]
    if end is not None:
        cmd += ["-to", str(end)]
    cmd += ["-i", path, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return torch.from_numpy(np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0)


def pieces(script, words):
    """Split the script's words into runs of about PIECE_SECONDS of speech, cut at sentence ends."""
    target = PIECE_SECONDS * SPEECH_CHARS_PER_SECOND
    out, begin = [], 0
    for i, m in enumerate(words):
        long_enough = m.end() - words[begin].start() >= target
        if long_enough and re.search(r"[.!?][\"'”’)]*$", m.group()) and i + 1 < len(words):
            out.append((begin, i + 1))
            begin = i + 1
    out.append((begin, len(words)))
    return out


def align_piece(tokenizer, emissions, stride, text, stars):
    """stars="edges": unknown audio may be skipped only before and after the
    text (used to find where a piece lies in long audio). stars="segment": also
    between words, which gives the most accurate word times once the audio
    window is known (measured against ElevenLabs' own timings: 90% of words
    within 37 ms, against 65 ms with "edges")."""
    tokens, text_starred = preprocess_text(text, romanize=True, language="eng", star_frequency=stars)
    segments, scores, blank = get_alignments(emissions, tokens, tokenizer)
    spans = get_spans(tokens, segments, blank)
    return postprocess_results(text_starred, spans, stride, scores)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("audio")
    p.add_argument("script")
    p.add_argument("out")
    p.add_argument("--start", type=float, help="align only from this second of the audio file")
    p.add_argument("--end", type=float, help="... to this second")
    p.add_argument("--offset", type=float, default=None, help="add to every time (default: --start or 0)")
    p.add_argument("--check", help="check_script.py report: its not_spoken passages are left out of the alignment")
    a = p.parse_args()

    t0 = time.time()
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model, tokenizer = load_alignment_model(device, dtype=torch.float32)
    wav = load_audio(a.audio, a.start, a.end).to(device)
    emissions, stride = generate_emissions(model, wav, batch_size=4)
    emissions = emissions.cpu()
    fps = 1000 / stride  # emission frames per second (50)

    script = open(a.script, encoding="utf-8").read()
    all_words = list(re.finditer(r"\S+", script))
    skip = [(n["from"], n["to"]) for n in json.load(open(a.check))["not_spoken"]] if a.check else []
    unspoken = lambda m: any(f <= m.start() and m.end() <= t for f, t in skip)  # noqa: E731
    words = [m for m in all_words if not unspoken(m)]  # what the audio actually contains
    # Pass 1: find where each piece of the script lies in the audio, moving
    # forward from where the previous piece ended.
    windows, cursor = [], 0  # cursor: first emission frame not yet used
    plan = pieces(script, words)
    for i, j in plan:
        text = " ".join(m.group() for m in words[i:j])
        last = j == len(words)
        span = int((len(text) / SPEECH_CHARS_PER_SECOND * 1.5 + 30) * fps)
        stop = emissions.shape[0] if last else min(emissions.shape[0], cursor + span)
        if stop - cursor < len(text) // 4:
            sys.exit(f"The audio ran out at {cursor / fps:.0f}s with {len(words) - i} script words left: does this audio match this script?")
        res = align_piece(tokenizer, emissions[cursor:stop], stride, text, "edges")
        if len(res) != j - i:
            sys.exit(f"Alignment returned {len(res)} words for {j - i} script words (piece {i}-{j}).")
        first, end = cursor + int(res[0]["start"] * fps), cursor + int(res[-1]["end"] * fps)
        windows.append((0 if i == 0 else first, emissions.shape[0] if last else end))
        cursor = end
    # Pass 2: align each piece precisely inside its own stretch of audio
    # (plus half a second either side).
    pad = int(0.5 * fps)
    result = []
    for (i, j), (w0, w1) in zip(plan, windows):
        text = " ".join(m.group() for m in words[i:j])
        lo, hi = max(0, w0 - pad), min(emissions.shape[0], w1 + pad)
        res = align_piece(tokenizer, emissions[lo:hi], stride, text, "segment")
        if len(res) != j - i:
            sys.exit(f"Alignment returned {len(res)} words for {j - i} script words (piece {i}-{j}).")
        base = lo / fps
        for m, r in zip(words[i:j], res):
            result.append({"w": m.group(), "from": m.start(), "to": m.end(), "start": base + r["start"], "end": base + r["end"], "score": r["score"]})

    offset = a.offset if a.offset is not None else (a.start or 0.0)
    for r in result:
        if r.get("source") == "not_spoken":
            continue
        r["start"] = round(r["start"] + offset, 3)
        r["end"] = round(r["end"] + offset, 3)
        r["score"] = round(float(r["score"]), 3)
        r["source"] = "aligned"
    # Times must run forward: of two words out of order, the less certain one loses its time (timing_order.py).
    kept = in_order(result)
    untimed = len(result) - len(kept)
    result = kept
    # Words the audio skipped stay in the output, without times, so the app
    # knows they exist and does not highlight them.
    timed = {r["from"]: r for r in result}
    result = [timed.get(m.start()) or {"w": m.group(), "from": m.start(), "to": m.end(), "start": None, "end": None, "score": None, "source": "not_spoken"} for m in all_words]
    low = sum(r["score"] is not None and r["score"] < -2 for r in result)
    json.dump(
        {
            "aligner": "ctc-forced-aligner/MahmoudAshraf/mms-300m-1130-forced-aligner",
            "audio": a.audio,
            "script": a.script,
            "audio_seconds": round(wav.shape[0] / SR, 3),
            "low_confidence_words": low,
            "not_spoken_words": len(all_words) - len(words) + untimed,
            "untimed_words": untimed,
            "words": result,
        },
        open(a.out, "w"),
        indent=0,
    )
    print(f"{len(words) - untimed} of {len(all_words)} words aligned in {time.time() - t0:.1f}s ({device}); {low} low-confidence; {untimed} left untimed (out of order); wrote {a.out}")


if __name__ == "__main__":
    main()
