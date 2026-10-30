---
name: readalong-audio
description: Turn an audiobook into a read-along package for Neolibrary (audio + the scripts read aloud + word timings measured from the audio + where each paragraph is in the book), so a reader can listen while the spoken word is highlighted on the page. Covers both paths: importing audio made elsewhere (an .m4b/.mp3 from any text-to-speech app such as Muse, with its scripts and possibly untrustworthy timings) and making the audio here with a voice from the voice library (ElevenLabs, OpenAI, Kyutai TTS 1.6B, Kyutai Pocket, or a manual app), under a hard spending cap on paid voices. Use this whenever the user wants to sync, align or time an audiobook with a book's text, add "read and listen" or word highlighting for a book, narrate a book or chapter with TTS for reading along, check whether an audiobook's script matches what was said, build or choose from the voice library, or asks what to request from a TTS tool to get read-along audio — even if they don't say "package" or "alignment".
---

# Read-along audio for Neolibrary

The goal is a **package** Neolibrary imports to give a "read and listen"
experience: press play, the word being spoken is highlighted on the book's
page. The package format is in `references/package-format.md`; provider
details, costs and measured accuracy are in `references/providers.md` (read
the section for the provider you are about to use).

The user is a scientist, not a software engineer: explain in plain English,
define terms like "forced alignment" on first use, and quote real numbers
from the tools' output rather than estimates.

## The one idea behind everything

Word timings are always **measured from the final audio** by forced
alignment (a speech model listens while holding the known script and marks
where each word starts), never trusted from whoever made the audio. Timings
supplied by an app may be estimates, and "polished" scripts often differ
from what was actually read. So every path ends in the same three steps:

1. `check_script.py` — transcribe the audio locally and compare it with the
   script. It lists "differences" by kind: `skipped` (in the script, never
   said), `added` (said, not in the script), `misread` (a word said
   differently, often the transcriber mishearing) and `written` (spelling,
   numbers, Roman numerals; harmless). Feeding skipped text to the aligner is what produces
   squeezed, wrong timings, so do not skip this step on new material.
2. `align.py --check` — measure every spoken word's start and end
   (90% of words within 0.04 s of ElevenLabs' own timings). Skipped words
   stay in the output marked `not_spoken`, so the app never highlights them.
3. `map_to_book.py` — find each script paragraph in the PDF/EPUB (page and
   opening words), so the app can find the words on the page. For a PDF, give
   it the app's own reading of the book with `--app-text PARAGRAPHS.json`
   (`build_package.py --app-text` passes it on): in the Neolibrary repo,
   `node scripts/pdf-paragraphs.mjs BOOK.pdf PARAGRAPHS.json`. The app lines an
   upload up against that text, not against `pdftotext`'s, so the "N of M
   found" line then counts what the app will find.

`build_package.py` runs all three per chapter, writes the package and runs
`validate_package.py`. Everything here runs on the laptop for free; only
making audio with a paid voice costs money.

## Setup (once)

Commands here run from the Neolibrary repository's root folder, where this skill lives (`.claude/skills/readalong-audio`).

```sh
.claude/skills/readalong-audio/scripts/setup.sh
```

Scripts that need the models run with `PY=~/.local/share/readalong/venv/bin/python`
(`check_script.py`, `align.py`). The others run with plain `python3`. Below,
`S=.claude/skills/readalong-audio/scripts`.

## Path A: the audio was made elsewhere (import)

Typical input: an `.m4b` with chapter marks, the scripts, maybe a sync
manifest and a word-timings file.

1. Look before assuming. `ffprobe -v error -show_chapters -of json book.m4b`
   for the chapter marks; count scripts; check they pair up (same number,
   same order). If a manifest exists, check its times against the chapter
   marks and its file names against the files you have. Report mismatches.
2. If supplied timings exist, say whether they look measured or estimated:
   estimated ones have no pauses between words and durations proportional to
   word length. Either way they are not used; the package is re-timed.
3. Measure one chapter first (the shortest substantial one): run
   `check_script.py` and `align.py --check` on it, report time taken,
   match %, skipped passages and low-confidence words. Then do the rest.
4. Build: write a `chapters.json` (see `build_package.py --help`; a
   Kuhn-style sync manifest works directly with `--audio` and
   `--scripts-dir`) and run
   `python3 $S/build_package.py OUT --book BOOK --chapters chapters.json --title … --author … --made-with "…"`.
   About 1/8 of real time (mostly the transcript check): ~50 minutes for a
   6.6-hour book.

## Path B: make the audio here with a voice

1. The reader chooses the voice; there is no default until they do.
   `python3 $S/voices.py show` lists the library; the chosen one is marked
   `*`. If none is chosen, point them to
   `~/.local/share/readalong/voices/index.html` to listen and run
   `voices.py choose <key>`. Do not pick one for them.
2. Write the script per chapter: the book's text as it should be heard,
   paragraphs separated by blank lines. Adding a spoken heading ("Chapter
   Five.") is fine; leave out page headers, footnote markers and page
   numbers.
3. `python3 $S/narrate.py chapter.txt chapter.m4a --voice <key>`. Paid
   voices print an estimate and stop; add `--yes` only within the cap and
   after saying the estimate. For apps with no command line (Muse), use
   `--voice manual:muse` and follow its instructions.
4. Build the package exactly as in path A step 4 (one audio file per
   chapter, no start/end).
5. If the check reports skipped or misread phrases in audio you made, say
   which words and offer to remake that chunk:
   `python3 $S/narrate.py chapter.txt chapter.m4a --voice <same key> --redo 3`
   (chunk numbers are the `n` in `chapter.chunks.json`, counting from 0; the
   chunk with the largest `start` before the phrase's time is the one). Each
   chunk's audio is kept in `chapter.parts/`, so only that chunk is remade and
   the chapter is rejoined. Paid voices go through the same estimate, `--yes`
   and cap, for just those chunks. Or accept the words as `not_spoken`.
   Then run the check again.

## Correcting a script to match the audio

When the audio is right but the script is not (common for imported audio),
make a corrected copy of the script instead of remaking audio:

```sh
python3 $S/fix_script.py chapter.txt check.json chapter.fixed.txt --changes changes.md
```

It never changes the original. It removes passages that were never read,
inserts short additions (3-15 words, such as a heading read aloud), and
completes words cut off in the script. Longer additions and single-word
misreadings are only listed in `changes.md`, for a person to listen to.
Re-run `check_script.py` and `align.py` on the corrected copy.

## Paid voices and the spending cap

All paid calls go through `spend.py`: an estimate is checked before each
call and the billed amount is logged after, in
`~/.local/share/readalong/spend.jsonl`. The cap (default $3.00, all paid
providers together, `READALONG_CAP_USD`) refuses any call that would cross
it; never raise it yourself, and never call a paid API by any other route
(no direct curl), because that would bypass the log. `python3 $S/spend.py`
prints what has been spent. Prefer free voices for tests.

## The voice library

`python3 $S/voices.py build` (re)builds it: ElevenLabs voices with their
free preview clips, Kyutai Pocket and 1.6B voices with a sample of the same
public-domain sentence (free, local), OpenAI's voices listed (samples are
paid: `--paid-samples N`). Add voices from other apps by saving a sample
under `samples/` and an entry in `library.json` with `provider: manual`.

## Getting the package into Neolibrary

Neolibrary has an importer (milestone M13, step c2): send the package zip with
`POST /api/books/:id/readalong`. Large audio can be left out of the zip and
sent in parts: `PUT /api/books/:id/readalong/:importId/parts?file=<name>&part=<n>`
for each part, then `POST /api/books/:id/readalong/:importId/finish`. The
upload page and the player are still being built, so for now the importer
is reached through these addresses only, and the reader cannot yet play the
result in the app.

## Reporting back

End with: what was made (paths), the validation line from
`validate_package.py`, per chapter the match %, skipped passages and
low-confidence share, money spent (from `spend.py`), and anything only the
user can do (choose a voice, add API credit, export audio from an app).
When asked what to request from a TTS vendor, use the checklist at the end
of `references/providers.md`.
