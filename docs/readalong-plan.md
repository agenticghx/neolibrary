# Read-along with your own audiobooks: plan

Written for: Samuel, and for any Claude session picking this up. Plain English;
terms are defined where they first appear. Started 2026-10-04.

## The goal

Upload an audiobook (made anywhere: an app like Muse, a TTS service, or made
here with a voice from the library) and read along in Neolibrary: press play,
the word being spoken is highlighted on the book's page (PDF or EPUB), pages
turn by themselves, and you can jump, change speed and resume.

## How it works (decided)

1. **A reusable skill makes a "read-along package"** on the laptop:
   `~/.claude/skills/readalong-audio/` (call it as `readalong-audio`). The
   package is a folder with the audio, the scripts that were read aloud, the
   word timings and a map of where each paragraph is in the book. Format:
   `references/package-format.md` in the skill (`neolibrary-readalong/1`).
2. **Timings are always measured from the final audio** by *forced
   alignment* (a speech model listens while holding the known script and
   marks where each word starts). Timings supplied with an audiobook are not
   trusted; the Kuhn ones were estimates.
3. **The script is checked against the audio first** (a free local
   transcription, compared word by word). Words the narrator skipped are
   kept but marked "not spoken" so they are never highlighted.
4. **The alignment runs on the laptop**, not on Railway (Samuel, 2026-10-04).
5. **Neolibrary gets an importer** that takes the package (to build; see
   step 4 below).
6. **No default voice** until Samuel picks one from the voice library.
7. **Paid voices are capped at $3 in total** for testing, enforced by the
   skill's spending log. Spent so far: $0.4272 (ElevenLabs only).

## What is done (2026-10-04)

Measured numbers, each from a run on 2026-10-04:

- **Accuracy:** aligner word starts vs ElevenLabs' own timings: 90% within
  0.037 s, worst 0.098 s (98 words).
- **Speed:** Kuhn ch. 1 part 1 (18 min) aligned in ~8 s; ch. 10 (45 min)
  in 20 s. The transcript check is slower: ~1/8 of real time (45 min → 5.7
  min); a whole 6.6-hour book ≈ 50 min of laptop time.
- **Kuhn findings:**
  - the scripts contain text never read: ch. 10 has 7 passages, 522 words.
    Marking them cut low-confidence words from 1,077 to 63.
  - ch. 1 opens "Preface", not the script's heading, and the narrator read
    the PDF's page footer ("Volume 2, Number 2…") at 70–79 s.
  - `kuhn-ssr-audiobook.m4b` is damaged ("moov atom not found"); the
    manifest names it, but its times match `kuhn-ssr-audiobook-fixed.m4b`.
  - 451 of 475 script paragraphs found in the PDF; the 24 misses are spoken
    headings.
- **Voices tried:**

  | Voice tool | Result |
  |---|---|
  | ElevenLabs | works ($0.16 test) |
  | Kyutai 1.6B (local, free) | works |
  | Kyutai Pocket (local, free) | works; a 15-min chapter in 1.6 min. It once skipped two phrases; the check caught them. |
  | OpenAI | refused: no API credit |
  | Muse | waiting on Samuel (no command line) |
- **Voice library:** 82 voices (35 ElevenLabs, 27 Pocket, 9 Kyutai 1.6B, 11
  OpenAI), 70 with samples: `~/.local/share/readalong/voices/index.html`.
- **Skill test, round 1** (each prompt run with and without the skill):
  results in `~/.claude/skills/readalong-audio-workspace/iteration-1/`.

## Waiting on Samuel

| # | What | Why it matters | Decide by |
|---|---|---|---|
| S1 | Make the Muse clip: paste `~/projects/sandbox/muse-test/muse.parts/00.txt` into Muse, save as `00.m4a` next to it | the "app with no command line" path is untested | 2026-10-11 |
| S2 | Add OpenAI API credit (platform.openai.com → Billing), or say to drop OpenAI | the OpenAI path is untested | 2026-10-11 |
| S3 | Pick a default voice from the library page (`voices.py choose <key>`) | narration defaults | before step 5 |
| S4 | Review the skill test results in the viewer and leave comments | drives skill round 2 | 2026-10-07 |
| S5 | ~~OK to build the importer~~ **approved 2026-10-04**: now M13 in `docs/plan.md` | | done |
| S6 | ~~Fix the Kuhn scripts~~ **approved 2026-10-04**: corrected copies made by `fix_script.py` from a check of all 17 chapters; originals untouched | | in progress |

## Next steps, in order

Each step has a "done when" check; tick it with the command and its output.

### 1. Skill round 2 (laptop, free)

Fix what round 1 found, then re-run the same three tests plus the old ones:
- [ ] Say in the skill that Neolibrary cannot import packages yet (until step 4).
- [ ] `check_script.py`: also list single misread words ("Greek God" for
      "Great God", found by the no-skill run), not only skipped runs of 3+.
- [ ] `map_to_book.py`: drop PDF running headers/footers (lines repeated on
      many pages) before quoting, so quotes are the paragraph's own words.
- [ ] Package format: paragraph numbers count from 0 (fix the example).
- [ ] `narrate.py --redo N`: remake one chunk (for a skipped or misread phrase).
- [ ] Report the highlight's lag against where each word's sound starts
      (the no-skill Kuhn run measured the aligner's starts about 0.1 s
      after the sound; ElevenLabs comparison says 0.017 s; settle which).
- [ ] Optional: split by the app's own paragraphs (`lib/library/sections.ts`
      and `pdf-sections.ts`) so packages match what the importer stores.
- **Done when:** round 2's viewer shows every with-skill check passing, and
  Samuel's comments from S4 are addressed.

### 2. Untested paths (needs S1, S2)

- [ ] Muse clip → `narrate.py --voice manual:muse` → package validates.
- [ ] OpenAI passage (≈ $0.02) → aligned → package validates.
- **Done when:** both give `Package OK`, spend log under $3.

### 3. The whole Kuhn book (laptop, free, ~1 hour)

- [ ] `build_package.py` for all 17 chapters, from the fixed m4b.
- **Done when:** `Package OK: 17 chapters`, with per-chapter match % and the
  not-spoken counts written into the ledger. The package stays on the
  laptop (copyrighted; never in git).

### 4. Neolibrary importer (milestone M13; approved, see `docs/plan.md` M13)

Plan, to refine into `docs/plan.md` when started:
- [ ] Upload a package (zip) on the book's page; check `manifest.book.sha256`
      against the stored book file; store the audio in the bucket.
- [ ] For each chapter, match script words to the app's paragraphs
      (`sections`), using the book map's page and quote, then store word
      timings per paragraph as the existing `audio_tracks` rows with
      `source = 'upload'` (the column already allows it; migration 0011).
- [ ] Player: play a chapter file from a time offset (one long file, not a
      file per paragraph); highlight with the existing frame-by-frame
      follower; skip `not_spoken` words.
- [ ] **Read-along on PDFs (real work, not a check).** Today the Listen
      button is switched off for PDF books (`Reader.tsx` line 796:
      `disabled={… || props.fileType === "pdf"}`, title "Reading aloud
      works for EPUB books"; confirmed 2026-10-04). The highlight must be
      drawn in the PDF viewer's text layer (pdf.js), and pages turned by
      page number. Paragraphs for PDFs exist (`lib/library/pdf-sections.ts`).
      Kuhn is a PDF, so this blocks reading Kuhn along; an EPUB of the same
      book would not need it.
- [ ] Tests: a small public-domain package (Frankenstein, Kyutai voice; check
      the voice's licence first) as a fixture; browser test like the
      highlight test (every word, in order, within 0.1 s).
- **Done when:** in the browser tests, an uploaded package plays and the
  highlight lands on every word in order; deployed; Samuel reads Kuhn ch. 1
  on the live site and says it keeps time.

### 5. Making narration in the app (later)

Use the library's chosen voice for the Listen button; Kyutai voices need a
machine with the model (the laptop), so in-app narration may stay
ElevenLabs while the laptop makes packages.

## Dedicated skills for the AI tools (planned 2026-10-04)

Samuel asked what drives the reading levels "Plain / STE light / STE / STE
strict". Found:
- **STE levels:** Samuel's own STE skill, copied into `prompts/ste/` on
  2026-10-03 and pasted into the instructions sent to Claude
  (`claude-opus-5-5`), with the strictness named; the checker is ported to
  TypeScript (`lib/ai/ste.ts`) and gives the score badge. The copy matched
  the original exactly on 2026-10-04, but nothing keeps it in step.
- **Plain:** no skill. One line ("Write in plain, precise English.") for
  "What do I need to know?", one short paragraph
  (`prompts/rewrite-levels/plain.md`) for rewrites (replaced on 2026-10-10 by the skill itself, `prompts/plain/`, in M17). No method, examples or
  checker.

Plan, each built and tested like `readalong-audio` (runs with and without
the skill, the results viewer for Samuel's comments, a second round):

- [ ] **K1 `plain-english` skill (new)**: method, rules (one idea per
      sentence, everyday words, define a term on first use, keep technical
      names the reader will meet again), before/after examples on science
      text, and a checker script (sentence length, rare words, passive
      voice, undefined jargon). Then the app uses it for "Plain" the way it
      uses STE, with a score like the STE badge.
- [ ] **K2 keep STE in step**: a script that copies Samuel's skill into
      `prompts/ste/`, and a test that fails on the laptop when the copy
      differs from the original.
- [ ] **K3 `book-chapters` skill (new; Samuel will run it with `claude -p`)**:
      splits an uploaded book into chapter scripts for narration: one clean
      text file per chapter plus a `chapters.json` that `readalong-audio`
      reads; front matter, page headers, footnote markers and page numbers
      removed; optional spoken heading per chapter; chapter numbers that
      match Neolibrary's own (spine order for EPUB, pages for PDF). A
      script does the mechanical part (table of contents, file order);
      Claude decides the rest (what is a chapter, what to drop, where to
      split a very long chapter). It runs unattended, so it must never stop
      to ask: it decides, writes down why, and flags doubts in a report.
      First books: Frankenstein and Jekyll and Hyde (public domain, in
      `fixtures/books/`).
      **Done when:** `claude -p "…"` on each book produces scripts that
      `readalong-audio` turns into a package that validates, and Samuel
      agrees with the chapter list.

## Where things are

- Skill: `~/.claude/skills/readalong-audio/` (SKILL.md, scripts/, references/)
- Tools and caches: `~/.local/share/readalong/` (venv, voices/, spend.jsonl, work/)
- Kyutai: `~/.local/share/kyutai/`
- Kuhn inputs: `~/projects/sandbox/` (private; never commit)
- Voice prices: `docs/overviewOfVoiceModelPricing.md`
