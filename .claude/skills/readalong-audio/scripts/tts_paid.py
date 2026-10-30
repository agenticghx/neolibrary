"""Paid text-to-speech, behind the spending cap (spend.py).

    python tts_paid.py elevenlabs --voice <voice_id> text.txt out.mp3 --timings out.engine.json
    python tts_paid.py openai --voice alloy text.txt out.mp3

ElevenLabs returns its own per-character timings (the engine measured them),
saved as word timings. OpenAI returns audio only; its timings come from
align.py. Keys come from ELEVENLABS_API_KEY / OPENAI_API_KEY in the
environment and are never written anywhere.

Prices used for the cap are cautious on purpose (overstating keeps the cap
safe). Override with READALONG_ELEVENLABS_USD_PER_1K_CHARS (default 0.30) and
READALONG_OPENAI_USD_PER_1M_CHARS (default 30, the tts-1-hd list price; the
cheaper gpt-4o-mini-tts is billed per audio token, so this is an upper bound).
"""
import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import spend  # noqa: E402

EL_RATE = float(os.environ.get("READALONG_ELEVENLABS_USD_PER_1K_CHARS", "0.30")) / 1000
OA_RATE = float(os.environ.get("READALONG_OPENAI_USD_PER_1M_CHARS", "30")) / 1_000_000


def post(url, headers, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        # The provider's own explanation (e.g. "insufficient_quota") says more than the status code.
        raise SystemExit(f"{url.split('/')[2]} refused ({e.code}): {e.read().decode(errors='replace')[:400]}")


def words_from_chars(text, chars, starts, ends):
    """Per-character times -> per-word times, keyed by character offsets into `text`."""
    if "".join(chars) != text:
        raise SystemExit("ElevenLabs' alignment does not match the text sent; use align.py for timings instead.")
    return [
        {"w": m.group(), "from": m.start(), "to": m.end(), "start": starts[m.start()], "end": ends[m.end() - 1]}
        for m in re.finditer(r"\S+", text)
    ]


def elevenlabs(text, voice, out, timings, model):
    cost = len(text) * EL_RATE
    spend.guard("elevenlabs", cost, f"{len(text)} chars, voice {voice}")
    raw, headers = post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps?output_format=mp3_44100_128",
        {"xi-api-key": os.environ["ELEVENLABS_API_KEY"]},
        {"text": text, "model_id": model},
    )
    res = json.loads(raw)
    Path(out).write_bytes(base64.b64decode(res["audio_base64"]))
    billed = int(headers.get("character-cost") or headers.get("Character-Cost") or len(text))
    spend.record("elevenlabs", billed * EL_RATE, f"{billed} chars, voice {voice}", model=model, out=str(out))
    a = res["alignment"]
    words = words_from_chars(text, a["characters"], a["character_start_times_seconds"], a["character_end_times_seconds"])
    if timings:
        json.dump({"engine": f"elevenlabs/{model}", "voice": voice, "words": words}, open(timings, "w"), indent=1)
    print(f"wrote {out}; billed {billed} chars (about ${billed * EL_RATE:.3f}); spent ${spend.spent():.3f} of ${spend.CAP:.2f}")


def openai(text, voice, out, model, instructions):
    cost = len(text) * OA_RATE
    spend.guard("openai", cost, f"{len(text)} chars, voice {voice}")
    body = {"model": model, "voice": voice, "input": text, "response_format": "mp3"}
    if instructions:
        body["instructions"] = instructions
    raw, _ = post("https://api.openai.com/v1/audio/speech", {"authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"}, body)
    Path(out).write_bytes(raw)
    spend.record("openai", cost, f"{len(text)} chars, voice {voice} (upper-bound estimate)", model=model, out=str(out))
    print(f"wrote {out}; recorded ${cost:.4f} (upper bound); spent ${spend.spent():.3f} of ${spend.CAP:.2f}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("provider", choices=["elevenlabs", "openai"])
    p.add_argument("text")
    p.add_argument("out")
    p.add_argument("--voice", required=True)
    p.add_argument("--timings", help="ElevenLabs only: write the engine's word timings here")
    p.add_argument("--model", help="default: eleven_multilingual_v2 / gpt-4o-mini-tts")
    p.add_argument("--instructions", help="OpenAI gpt-4o-mini-tts only: how to speak (tone, pace)")
    a = p.parse_args()
    text = Path(a.text).read_text().strip()
    try:
        if a.provider == "elevenlabs":
            elevenlabs(text, a.voice, a.out, a.timings, a.model or "eleven_multilingual_v2")
        else:
            openai(text, a.voice, a.out, a.model or "gpt-4o-mini-tts", a.instructions)
    except spend.CapExceeded as e:
        raise SystemExit(str(e))
