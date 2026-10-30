"""The voice library: every voice you can narrate with, a sample of each, and
the one you chose as default.

    python voices.py build [--providers elevenlabs,kyutai-pocket,kyutai-16b,openai]
                           [--paid-samples N]
    python voices.py choose <voice key>     # e.g. kyutai-pocket:javert
    python voices.py show

Lives in ~/.local/share/readalong/voices/ (READALONG_VOICES to move it):
  library.json   every voice: key, provider, id, name, description, sample
                 file, cost per 1,000 characters, whether timings come from
                 the engine; and "default" (null until you choose).
  samples/       one short clip per voice.
  index.html     open in a browser to listen and compare.

Samples say the same public-domain sentence wherever it is free to do so,
so voices can be compared fairly. ElevenLabs' own preview clips are free but
say ElevenLabs' sentences; --paid-samples N also makes the shared sentence
for N ElevenLabs voices, behind the spending cap (about $0.03 each). OpenAI
samples are paid too (cents) and are made only with --paid-samples.
There is deliberately no built-in default voice: the reader picks.
"""
import argparse
import html
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import spend  # noqa: E402

HOME = Path(os.environ.get("READALONG_VOICES", Path.home() / ".local/share/readalong/voices"))
KYUTAI = Path(os.environ.get("READALONG_KYUTAI", Path.home() / ".local/share/kyutai"))
SENTENCE = (
    "It was on a dreary night of November, that I beheld the accomplishment of my toils. "
    "With an anxiety that almost amounted to agony, I collected the instruments of life around me."
)
# OpenAI's built-in voices for gpt-4o-mini-tts (check the API docs if one is refused).
OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"]
KYUTAI_16B_VOICES = [  # a starter set from the kyutai/tts-voices repository (free to download)
    "expresso/ex03-ex01_happy_001_channel1_334s.wav",
    "expresso/ex04-ex02_confused_001_channel1_499s.wav",
    "vctk/p228_023.wav",
    "vctk/p254_023.wav",
    "vctk/p339_023.wav",
    "vctk/p360_023.wav",
    "voice-donations/Selfie.wav",
    "voice-donations/Butter.wav",
    "alba-mackenna/announcer.wav",
]


def load():
    f = HOME / "library.json"
    return json.loads(f.read_text()) if f.exists() else {"default": None, "sentence": SENTENCE, "voices": {}}


def save(lib):
    HOME.mkdir(parents=True, exist_ok=True)
    (HOME / "library.json").write_text(json.dumps(lib, indent=1))
    write_index(lib)


def write_index(lib):
    rows = []
    for key, v in sorted(lib["voices"].items(), key=lambda kv: (kv[1]["provider"], kv[1]["name"])):
        sample = f'<audio controls preload="none" src="{html.escape(v["sample"])}"></audio>' if v.get("sample") else f'<em>{html.escape(v.get("note", "no sample"))}</em>'
        star = " ★ default" if lib.get("default") == key else ""
        cost = "free" if not v["usd_per_1k_chars"] else f'${v["usd_per_1k_chars"]:.3f} / 1,000 chars'
        rows.append(
            f'<tr><td><code>{html.escape(key)}</code>{star}</td><td>{html.escape(v["name"])}</td>'
            f'<td>{html.escape(v.get("description", ""))}</td><td>{cost}</td><td>{sample}</td></tr>'
        )
    (HOME / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><title>Voice library</title>"
        "<style>body{font:15px/1.4 system-ui;margin:2rem;max-width:72rem}td{padding:.35rem .6rem;border-bottom:1px solid #ddd;vertical-align:middle}"
        "code{font-size:13px}</style><h1>Voice library</h1>"
        f"<p>Samples read: “{html.escape(lib['sentence'])}” (ElevenLabs previews read ElevenLabs’ own text unless marked otherwise.)</p>"
        "<p>To choose: <code>python voices.py choose &lt;key&gt;</code></p>"
        f"<table><tr><th>Key</th><th>Name</th><th>About</th><th>Cost</th><th>Sample</th></tr>{''.join(rows)}</table>"
    )


def fetch(url, dest, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=120) as r:
        dest.write_bytes(r.read())


def build_elevenlabs(lib, paid_samples):
    req = urllib.request.Request("https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]})
    voices = json.load(urllib.request.urlopen(req, timeout=60))["voices"]
    made = 0
    for v in voices:
        key = f"elevenlabs:{v['voice_id']}"
        entry = lib["voices"].get(key, {})
        labels = v.get("labels") or {}
        entry.update(provider="elevenlabs", id=v["voice_id"], name=v["name"], timings="engine",
                     usd_per_1k_chars=float(os.environ.get("READALONG_ELEVENLABS_USD_PER_1K_CHARS", "0.30")),
                     description=", ".join(str(labels[k]) for k in ("gender", "age", "accent", "descriptive", "use_case") if labels.get(k)))
        dest = HOME / "samples" / f"elevenlabs-{v['voice_id']}.mp3"
        if made < paid_samples and not entry.get("shared_sentence"):
            out = subprocess.run([sys.executable, str(Path(__file__).parent / "tts_paid.py"), "elevenlabs", "--voice", v["voice_id"], str(HOME / "sentence.txt"), str(dest)], capture_output=True, text=True)
            if out.returncode == 0:
                entry["shared_sentence"] = True
                made += 1
            else:
                print(out.stdout + out.stderr)
        if not dest.exists() and v.get("preview_url"):
            fetch(v["preview_url"], dest)  # free
        if dest.exists():
            entry["sample"] = f"samples/{dest.name}"
        lib["voices"][key] = entry
    print(f"elevenlabs: {len(voices)} voices ({made} new shared-sentence samples)")


def build_pocket(lib):
    py = KYUTAI / "pocket/bin/python"
    names = json.loads(subprocess.run([py, "-c", "import json;from pocket_tts.utils.utils import _ORIGINS_OF_PREDEFINED_VOICES as V;print(json.dumps(V))"], capture_output=True, text=True, check=True).stdout)
    for name, origin in names.items():
        key = f"kyutai-pocket:{name}"
        dest = HOME / "samples" / f"kyutai-pocket-{name}.wav"
        if not dest.exists():
            subprocess.run([KYUTAI / "pocket/bin/pocket-tts", "generate", "--text", SENTENCE, "--voice", name, "--output-path", dest, "-q"], check=True, capture_output=True)
        lib["voices"][key] = {"provider": "kyutai-pocket", "id": name, "name": name.replace("_", " ").title(), "timings": "aligned",
                              "usd_per_1k_chars": 0, "description": f"local, free; voice from {origin.split('tts-voices/')[-1]}",
                              "sample": f"samples/{dest.name}", "shared_sentence": True}
    print(f"kyutai-pocket: {len(names)} voices")


def build_16b(lib):
    script = Path(__file__).parent / "tts_kyutai16b.py"
    for voice in KYUTAI_16B_VOICES:
        slug = voice.replace("/", "-").removesuffix(".wav")
        key = f"kyutai-16b:{voice}"
        dest = HOME / "samples" / f"kyutai-16b-{slug}.wav"
        if not dest.exists():
            r = subprocess.run([KYUTAI / "tts16b/bin/python", script, HOME / "sentence.txt", dest, "--voice", voice, "--timings", str(dest) + ".json"], capture_output=True, text=True)
            if r.returncode != 0:
                print(f"kyutai-16b {voice}: {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else 'failed'}")
                continue
        lib["voices"][key] = {"provider": "kyutai-16b", "id": voice, "name": slug, "timings": "engine (checked by alignment)",
                              "usd_per_1k_chars": 0, "description": "local, free (MLX); 1.6B model", "sample": f"samples/{dest.name}", "shared_sentence": True}
    print(f"kyutai-16b: {sum(k.startswith('kyutai-16b:') for k in lib['voices'])} voices")


def build_openai(lib, paid_samples):
    rate = float(os.environ.get("READALONG_OPENAI_USD_PER_1M_CHARS", "30")) / 1000
    for n, name in enumerate(OPENAI_VOICES):
        key = f"openai:{name}"
        entry = lib["voices"].get(key, {})
        entry.update(provider="openai", id=name, name=name.title(), timings="aligned", usd_per_1k_chars=rate, description="gpt-4o-mini-tts built-in voice")
        dest = HOME / "samples" / f"openai-{name}.mp3"
        if n < paid_samples and not dest.exists():
            r = subprocess.run([sys.executable, str(Path(__file__).parent / "tts_paid.py"), "openai", "--voice", name, str(HOME / "sentence.txt"), str(dest)], capture_output=True, text=True)
            if r.returncode != 0:
                msg = re.search(r'"message":\s*"([^"]+)"', r.stdout + r.stderr)
                entry["note"] = "no sample: " + (msg.group(1) if msg else (r.stdout + r.stderr).strip()[-160:])
        if dest.exists():
            entry["sample"] = f"samples/{dest.name}"
            entry["shared_sentence"] = True
            entry.pop("note", None)
        elif "note" not in entry:
            entry["note"] = "no sample yet (paid: run build --providers openai --paid-samples N)"
        lib["voices"][key] = entry
    print(f"openai: {len(OPENAI_VOICES)} voices")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--providers", default="elevenlabs,kyutai-pocket,kyutai-16b,openai")
    b.add_argument("--paid-samples", type=int, default=0, help="per paid provider, behind the spending cap")
    c = sub.add_parser("choose")
    c.add_argument("key")
    sub.add_parser("show")
    a = p.parse_args()

    lib = load()
    if a.cmd == "build":
        (HOME / "samples").mkdir(parents=True, exist_ok=True)
        (HOME / "sentence.txt").write_text(SENTENCE)
        for prov in a.providers.split(","):
            try:
                {"elevenlabs": lambda: build_elevenlabs(lib, a.paid_samples), "kyutai-pocket": lambda: build_pocket(lib),
                 "kyutai-16b": lambda: build_16b(lib), "openai": lambda: build_openai(lib, a.paid_samples)}[prov]()
            except Exception as e:  # one provider failing must not lose the others
                print(f"{prov}: skipped ({e})")
            save(lib)
        print(f"{len(lib['voices'])} voices; listen at {HOME / 'index.html'}")
    elif a.cmd == "choose":
        if a.key not in lib["voices"]:
            sys.exit(f"No voice {a.key!r}. Run 'voices.py show' for the keys.")
        lib["default"] = a.key
        save(lib)
        print(f"default voice: {a.key} ({lib['voices'][a.key]['name']})")
    else:
        for key, v in sorted(lib["voices"].items()):
            print(f"{'*' if lib.get('default') == key else ' '} {key:60} {v['name'][:28]:28} {'free' if not v['usd_per_1k_chars'] else '$%.3f/1k' % v['usd_per_1k_chars']}")
        print(f"default: {lib.get('default') or 'none chosen yet'}")


if __name__ == "__main__":
    main()
