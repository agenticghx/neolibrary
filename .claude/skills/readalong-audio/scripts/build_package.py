"""Build a read-along package: audio + scripts + measured word timings +
where each paragraph is in the book. This folder is what Neolibrary imports.
The format is in references/package-format.md.

    python build_package.py OUTDIR --book BOOK.pdf --chapters chapters.json
        [--title T --author A --voice KEY --made-with "who/what made the audio"]
        [--skip-check] [--app-text PARAGRAPHS.json]

chapters.json is a list, in reading order, of
    {"title": "...", "script": "path.txt", "audio": "path", "start": s, "end": s}
("start"/"end" only when several chapters share one audio file, as in an
.m4b with chapter marks; leave them out for one file per chapter). A Kuhn-style
sync manifest ({"chapters": [{"title","text_file","start_secs","end_secs"}]})
is accepted too, with --audio and --scripts-dir.

For each chapter: check_script.py (what was actually said; skipped with
--skip-check), then align.py (measured timings). Then map_to_book.py, then
validate_package.py. Runs entirely on the laptop and costs nothing.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
VENV_PY = Path.home() / ".local/share/readalong/venv/bin/python"
FORMAT = "neolibrary-readalong/1"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def duration(f):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], capture_output=True, text=True, check=True).stdout)


def run(*cmd):
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"{Path(str(cmd[1])).name} failed:\n{(r.stdout + r.stderr)[-1500:]}")
    return [l for l in r.stdout.splitlines() if l.strip()][-1]


def read_chapters(a):
    data = json.load(open(a.chapters))
    if isinstance(data, dict) and "chapters" in data:  # sync-manifest style
        return [
            {"title": c["title"], "script": str(Path(a.scripts_dir) / c["text_file"]), "audio": a.audio, "start": c["start_secs"], "end": c["end_secs"]}
            for c in data["chapters"]
        ]
    return data


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("out")
    p.add_argument("--book", required=True)
    p.add_argument("--chapters", required=True)
    p.add_argument("--audio", help="sync-manifest style: the one audio file")
    p.add_argument("--scripts-dir", help="sync-manifest style: folder with the scripts")
    p.add_argument("--title")
    p.add_argument("--author")
    p.add_argument("--voice", help="voice library key, or a description for audio made elsewhere")
    p.add_argument("--made-with", help='e.g. "Muse (Meta), voice X" or "kyutai-pocket via narrate.py"')
    p.add_argument("--skip-check", action="store_true", help="skip the transcript check (faster; only if the script is known to match)")
    p.add_argument("--app-text", help="a PDF's paragraphs as Neolibrary reads them (its scripts/pdf-paragraphs.mjs), for map_to_book.py")
    a = p.parse_args()

    out = Path(a.out)
    for d in ("audio", "scripts", "timings", "checks"):
        (out / d).mkdir(parents=True, exist_ok=True)
    chapters = read_chapters(a)

    audio_files = {}  # source path -> packaged name
    manifest_chapters = []
    t0 = time.time()
    for n, c in enumerate(chapters, 1):
        src = str(Path(c["audio"]).expanduser())
        if src not in audio_files:
            name = f"{len(audio_files) + 1:02d}{Path(src).suffix.lower()}"
            shutil.copyfile(src, out / "audio" / name)
            audio_files[src] = name
        script_name = f"{n:02d}.txt"
        shutil.copyfile(c["script"], out / "scripts" / script_name)
        span = ["--start", str(c["start"]), "--end", str(c["end"])] if c.get("start") is not None else []
        check = out / "checks" / f"{n:02d}.json"
        if not a.skip_check:
            print(f"[{n}/{len(chapters)}] {c['title']}: checking the script against the audio …", flush=True)
            print("   ", run(VENV_PY, HERE / "check_script.py", out / "audio" / audio_files[src], out / "scripts" / script_name, check, *span))
        print(f"[{n}/{len(chapters)}] {c['title']}: aligning …", flush=True)
        print("   ", run(VENV_PY, HERE / "align.py", out / "audio" / audio_files[src], out / "scripts" / script_name, out / "timings" / f"{n:02d}.json", *span, *(["--check", check] if check.exists() else [])))
        manifest_chapters.append({
            "n": n,
            "title": c["title"],
            "audio": f"audio/{audio_files[src]}",
            "start": c.get("start", 0.0),
            "end": c.get("end") if c.get("end") is not None else round(duration(out / "audio" / audio_files[src]), 3),
            "script": f"scripts/{script_name}",
            "timings": f"timings/{n:02d}.json",
            "check": f"checks/{n:02d}.json" if check.exists() else None,
        })

    print("Finding each paragraph in the book …", flush=True)
    app_text = ["--app-text", a.app_text] if a.app_text else []
    print("   ", run(sys.executable, HERE / "map_to_book.py", a.book, out / "book-map.json", *sorted((out / "scripts").glob("*.txt")), *app_text))

    manifest = {
        "format": FORMAT,
        "title": a.title,
        "author": a.author,
        "book": {"file": Path(a.book).name, "sha256": sha256(a.book)},
        "audio": [{"file": f"audio/{name}", "sha256": sha256(out / "audio" / name), "seconds": round(duration(out / "audio" / name), 3)} for name in audio_files.values()],
        "voice": a.voice,
        "made_with": a.made_with,
        "timings": {"source": "aligned", "aligner": "ctc-forced-aligner, MMS-300m (MahmoudAshraf/mms-300m-1130-forced-aligner)", "checked_against_transcript": not a.skip_check},
        "chapters": manifest_chapters,
        "book_map": "book-map.json",
        "built": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "build_seconds": round(time.time() - t0, 1),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(run(sys.executable, HERE / "validate_package.py", out))


if __name__ == "__main__":
    main()
