---
name: book-chapters
description: Split an uploaded ebook (EPUB or PDF) into clean chapter scripts ready to narrate with the readalong-audio skill — one plain-text file per chapter plus a chapters.json and a report of every decision. Use this whenever the user wants to turn a book into narration scripts, prepare a book for text-to-speech or an audiobook, "split the book into chapters", get chapter text for Muse/ElevenLabs/Kyutai, or start a read-along package from just the ebook — even if they don't say "script" or "split". Built to run unattended (claude -p): it never stops to ask.
---

# Book chapters: ebook to narration scripts

Written for: a Claude session (often unattended, `claude -p`) and for Samuel,
a scientist who reads the report afterwards. Output feeds the
`readalong-audio` skill: `narrate.py SCRIPT.txt OUT.m4a` reads each script,
and `build_package.py --chapters chapters.json` reads the chapter list.

## Rule zero: never stop to ask

This runs with nobody watching. When something is unclear, **decide, write
down why in `report.md`, and flag the doubt** under a "Doubts" heading at the
end of the report. Never end the run with a question. A sensible default plus
a written reason beats a stalled job.

## Quick start (EPUB)

Commands here run from the Neolibrary repository's root folder, where this skill lives (`.claude/skills/book-chapters`).

```sh
S=.claude/skills/book-chapters/scripts
python3 $S/split_epub.py BOOK.epub OUT            # default rules
python3 $S/split_epub.py BOOK.epub OUT --spoken-headings --drop-front-back
```

Writes:
- `OUT/NN-slug.txt` — one script per chapter (or chapter part): paragraphs
  separated by one blank line, nothing else.
- `OUT/chapters.json` — list, in reading order, of
  `{"title", "script", "audio": null, "spine_index", "chars", "kind"}`;
  `kind` is `chapter`, `front` or `back`. Fill `audio` after narrating, then
  hand it to `build_package.py`.
- `OUT/report.md` — one row per spine item: kept/dropped/split and why.

Then check it (this is the acceptance test; do it every time):

```sh
python3 .claude/skills/readalong-audio/scripts/map_to_book.py BOOK.epub /tmp/map.json OUT/*.txt
```

Report its "N of M script paragraphs found" line. Expect a handful of misses
that are only very short lines (dates like "July 7th, 17—.", signatures like
"R. Walton."): the mapper needs about 40 letters to search with. Any long
paragraph not found means the cleaning changed the text; investigate it.

## The rules (why each exists)

1. **Numbering must match Neolibrary's**, or the package will point at the
   wrong part of the book. EPUB: `spine_index` is the 0-based position in the
   OPF spine (the book's reading-order list), the same number Neolibrary
   stores as a section's `chapterIndex` and `map_to_book.py` reports as
   `chapter`. PDF: by page number (record the first and last page of each
   chapter). Script file numbers (`NN-`) are just narration order; never use
   them as the link to the book.
2. **Drop what nobody wants read aloud**: title pages, copyright/imprint,
   table of contents, colophon, endnote lists, index, "uncopyright". Always.
3. **Keep prefaces, introductions, forewords, prologues and epilogues by
   default** and say so in the report. They are part of the reading; the
   user can delete one script file if they disagree.
4. **Dedications, epigraphs, appendices**: kept unless `--drop-front-back`.
   Items under 200 characters (title cards) are dropped either way, noted.
5. **Clean for the ear**: remove footnote markers (`noteref` links,
   superscripts), page-break markers, page numbers and running headers. Do
   not rewrite sentences: every paragraph must still be found in the book.
6. **Spoken headings** (`--spoken-headings`): the script starts with the
   title as its own line ("Chapter V."). Off by default because the heading
   is not a body paragraph; turn it on for narration that should announce
   chapters. If you want "Chapter Five." in words, edit the first line.
7. **Long chapters are split** above `--max-chars` (default 38,000
   characters, about 45 minutes of speech) at a paragraph end, into
   "Title, part 1", "part 2" with the same `spine_index`.

## PDF books

```sh
S=.claude/skills/book-chapters/scripts
python3 $S/split_pdf.py BOOK.pdf OUT                      # default rules
python3 $S/split_pdf.py BOOK.pdf OUT --pages 22-41        # one chapter's pages only
python3 $S/split_pdf.py BOOK.pdf OUT --spoken-headings --drop-front-back
```

Same three outputs, with `"pages": [first, last]` (1-based, as a PDF viewer
counts; Neolibrary's chapterIndex for a page is page − 1) instead of
`spine_index`. Needs PyMuPDF (`import fitz`; in the base `python3`). What it
does, each step listed in `report.md` with page numbers:

- **Chapters from the outline** (bookmarks), its shallowest level with two
  entries or more; without an outline, from lines in type 1.3× the body size
  near a page's top (a Doubt says so). Rules 2–4 above decide what is kept.
- **Running headers, footers and page numbers** go: a line in the top or
  bottom tenth of a page that repeats on 20% of pages (and 5), or on a third
  of one chapter's pages (and 3).
- **Small type** (under 85% of the body size) goes when the page also has
  body text: footnotes and figure captions. A page all in small type (an
  epigraph) stays. `--keep-small-text` keeps them all.
- **Footnote markers** (small digits raised above the line) go; small digits
  set lower (the 2 of CO2) stay, joined to their word.
- **Line-end hyphens**: "frag-" + "ment" is joined only when the book spells
  "fragment" elsewhere; otherwise the hyphen stays ("well-appointed"). A PDF
  made from an ebook (calibre) breaks lines only at real hyphens; *The Grid*
  had 86 such and 2 to join.
- **Paragraphs** start at an indent, at an indented line after one that
  stopped short, or after a gap of 1.5 lines; a page's first line goes on
  with the last paragraph unless indented. Pieces of one line that the PDF
  gives word by word (wide justified spacing) are put back together.
- **Doubts** it writes: no outline, two-column pages (try `marker` or
  `docling` and compare), a scanned book (no text layer: run
  `ocrmypdf BOOK.pdf OUT.pdf` first), hyphens it kept, a lot of small text.

Then check it against the text **as Neolibrary reads it**. The app lines an
uploaded package up against its own reading of the PDF (pdf.js), so check
against that, not against `pdftotext`:

```sh
node scripts/pdf-paragraphs.mjs BOOK.pdf /tmp/app.json
python3 .claude/skills/readalong-audio/scripts/map_to_book.py BOOK.pdf /tmp/map.json OUT/*.txt --app-text /tmp/app.json
```

Tests: `python3 -m pytest .claude/skills/book-chapters/tests -q` (a
made-up PDF with each case above).

## Hand-off

Tell the user: how many scripts, first and last title, total characters and
the rough listening time (about 850 characters a minute), what was dropped,
the "N of M found" line, and the Doubts list. Next step is
`readalong-audio` (choose a voice, narrate, build the package).
