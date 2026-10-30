"""Make one chapter of audio from its script, with a voice from the library.

    python narrate.py SCRIPT.txt OUT.m4a --voice <library key> [--yes]
    python narrate.py SCRIPT.txt OUT.m4a --voice manual:<app name>    # e.g. manual:muse
    python narrate.py SCRIPT.txt OUT.m4a --voice <same key> --redo 3,7  # remake chunks 3 and 7 only

The script is split at paragraph ends into chunks the service accepts, each
chunk is spoken, and the pieces are joined into one AAC file (.m4a). The
chunk list with each chunk's start time is written next to it (OUT.chunks.json).

Paid voices: the whole chapter's cost is estimated first and checked against
the spending cap (spend.py) before anything is sent; without --yes it only
prints the estimate. "manual:" voices (apps with no command line, like Muse)
print the chunks to paste into the app and wait for you to save each one as
OUT.parts/NN.<any audio extension>.

Each chunk's audio is kept in OUT.parts/NN.wav (or .mp3), numbered as in
OUT.chunks.json ("n", counting from 0). --redo N[,M...] remakes only those
chunks (for example one where the voice skipped or misread a phrase), keeps
the other part files as they are, and rejoins OUT.m4a and OUT.chunks.json.
Use the same script and voice as the first run. A paid --redo is estimated
and checked against the cap for just those chunks.

Word timings are not taken from here: run check_script.py and align.py on
OUT.m4a afterwards, the same way for every voice.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import spend  # noqa: E402
import voices  # noqa: E402

MAX_CHARS = {"elevenlabs": 4500, "openai": 4000, "kyutai-pocket": 1200, "kyutai-16b": 900, "manual": 3000}


def chunks(text, limit):
    """Paragraphs grouped up to `limit` characters; a too-long paragraph is split at sentence ends."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    units = []
    for p in paras:
        if len(p) <= limit:
            units.append(p)
            continue
        cur = ""
        for s in re.split(r"(?<=[.!?])\s+|(?<=[.!?][\"'”’)])\s+", p):
            if cur and len(cur) + len(s) + 1 > limit:
                units.append(cur)
                cur = s
            else:
                cur = f"{cur} {s}".strip()
        units.append(cur)
    out, cur = [], ""
    for u in units:
        if cur and len(cur) + len(u) + 2 > limit:
            out.append(cur)
            cur = u
        else:
            cur = f"{cur}\n\n{u}".strip()
    return out + [cur] if cur else out


def duration(f):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], capture_output=True, text=True, check=True).stdout)


def speak(provider, voice_id, text, dest: Path):
    here = Path(__file__).parent
    if provider == "kyutai-pocket":
        subprocess.run([voices.KYUTAI / "pocket/bin/pocket-tts", "generate", "--text", text, "--voice", voice_id, "--output-path", dest, "-q"], check=True, capture_output=True)
    elif provider == "kyutai-16b":
        t = dest.with_suffix(".txt")
        t.write_text(text)
        subprocess.run([voices.KYUTAI / "tts16b/bin/python", here / "tts_kyutai16b.py", t, dest, "--voice", voice_id, "--timings", str(dest) + ".json"], check=True, capture_output=True)
    elif provider in ("elevenlabs", "openai"):
        t = dest.with_suffix(".txt")
        t.write_text(text)
        r = subprocess.run([sys.executable, here / "tts_paid.py", provider, "--voice", voice_id, t, dest], capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(r.stdout + r.stderr)
    else:
        raise SystemExit(f"Unknown provider {provider}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("script")
    p.add_argument("out")
    p.add_argument("--voice", required=True, help="library key (see voices.py show), or manual:<app>")
    p.add_argument("--yes", action="store_true", help="go ahead with a paid voice after the estimate")
    p.add_argument("--redo", help="remake only these chunk numbers (as in OUT.chunks.json), e.g. 3 or 3,7")
    a = p.parse_args()

    text = Path(a.script).read_text(encoding="utf-8").strip()
    provider, _, voice_id = a.voice.partition(":")
    lib = voices.load()
    entry = lib["voices"].get(a.voice)
    if provider != "manual" and not entry:
        sys.exit(f"{a.voice!r} is not in the voice library. Run 'voices.py show' and pick one.")
    rate = (entry or {}).get("usd_per_1k_chars", 0) / 1000
    parts = chunks(text, MAX_CHARS.get(provider, 1000))
    out = Path(a.out)
    folder = out.with_suffix(".parts")
    ext = ".mp3" if provider in ("elevenlabs", "openai") else ".wav"
    redo = None
    if a.redo:
        if provider == "manual":
            sys.exit("For a manual: voice, delete OUT.parts/NN.<audio>, save the new take there, and run again without --redo.")
        redo = sorted({int(x) for x in a.redo.split(",") if x.strip()})
        bad = [n for n in redo if not 0 <= n < len(parts)]
        if bad:
            sys.exit(f"No chunk {bad}; this script has chunks 0-{len(parts) - 1}.")
        old = out.with_suffix(".chunks.json")
        if old.exists():
            prev = json.load(open(old))
            if prev.get("voice") != a.voice or len(prev.get("chunks", [])) != len(parts):
                sys.exit(f"{old} was made with {prev.get('voice')} and {len(prev.get('chunks', []))} chunks; --redo needs the same voice and script.")
        missing = [n for n in range(len(parts)) if n not in redo and not (folder / f"{n:02d}{ext}").exists()]
        if missing:
            sys.exit(f"--redo needs the kept chunk files, but {folder} lacks chunks {missing}. Run without --redo.")
    todo = redo if redo is not None else list(range(len(parts)))
    chars = sum(len(parts[n]) for n in todo)
    est = chars * rate
    if rate:
        print(f"{a.voice}: {chars:,} characters in {len(todo)} chunks, about ${est:.2f}; ${spend.spent():.2f} of ${spend.CAP:.2f} spent so far.")
        spend.guard(provider, est, f"{'redo ' + a.redo + ' of ' if redo else ''}chapter {Path(a.script).name}")
        if not a.yes:
            sys.exit("Estimate only. Run again with --yes to make it.")

    pieces = []
    folder.mkdir(parents=True, exist_ok=True)
    if provider == "manual":
        folder.mkdir(parents=True, exist_ok=True)
        for n, c in enumerate(parts):
            (folder / f"{n:02d}.txt").write_text(c)
        print(f"Paste each of {folder}/NN.txt into {voice_id or 'the app'} and save its audio as {folder}/NN.<ext> (same number). Then run this again.")
        for n in range(len(parts)):
            found = [f for f in folder.glob(f"{n:02d}.*") if f.suffix != ".txt"]
            if not found:
                sys.exit(f"Waiting for {folder}/{n:02d}.<audio>.")
            pieces.append(found[0])
    else:
        if redo is None:  # a fresh run: clear part files left from an older, longer script
            for f in folder.glob("[0-9][0-9]*"):
                f.unlink()
        for n, c in enumerate(parts):
            dest = folder / f"{n:02d}{ext}"
            if n in todo:
                speak(provider, voice_id, c, dest)
                print(f"  chunk {n} made ({len(todo) - todo.index(n) - 1} left)", flush=True)
            pieces.append(dest)

    # Each chunk's length should fit its text (narration runs at roughly 10-20
    # characters a second). A chunk far too long usually means the voice did
    # not stop at the end of the text; far too short, that it skipped some.
    for n, (f, c) in enumerate(zip(pieces, parts)):
        d, expected = duration(f), len(c) / 14
        if d > 2.5 * expected + 5 or d < 0.4 * expected:
            sys.exit(f"Chunk {n} is {d:.0f}s for {len(c)} characters (expected about {expected:.0f}s); listen to {f}, then make it again.")

    # Join, with a short pause between chunks so paragraphs do not run
    # together. Every piece is first converted to the same format (44.1 kHz
    # mono 16-bit WAV): the join step needs identical formats, and mixing
    # 24 kHz chunks with a 44.1 kHz pause stretched a 15-minute chapter to 27.
    work = Path(tempfile.mkdtemp(prefix="join-"))
    silence = work / "gap.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.6", "-c:a", "pcm_s16le", silence], check=True)
    starts, t, lines = [], 0.0, []
    for n, f in enumerate(pieces):
        same = work / f"{n:02d}.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", same], check=True)
        starts.append(round(t, 3))
        lines.append(f"file '{same}'")
        t += duration(same)
        if n + 1 < len(pieces):
            lines.append(f"file '{silence}'")
            t += duration(silence)
    listing = work / "list.txt"
    listing.write_text("\n".join(lines))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listing, "-c:a", "aac", "-b:a", "96k", out], check=True)
    if abs(duration(out) - t) > 1.0:
        sys.exit(f"The joined file is {duration(out):.1f}s but its parts add up to {t:.1f}s; not trusting it.")
    json.dump({"voice": a.voice, "script": a.script, "chunks": [{"n": n, "chars": len(c), "start": s} for n, (c, s) in enumerate(zip(parts, starts))], "seconds": round(duration(out), 3)},
              open(out.with_suffix(".chunks.json"), "w"), indent=1)
    print(f"wrote {out} ({duration(out):.1f}s, {len(parts)} chunks)")


if __name__ == "__main__":
    main()
