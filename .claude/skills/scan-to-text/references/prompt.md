# Changing the page-reading instructions

Written for Claude sessions about to edit `prompts/transcribe-page.md`.

## Why to be careful

Every page read is stored with a fingerprint of the instructions it was read with:

- the server reads a page again only when that fingerprint changes;
- the server takes pages from the laptop only when they were read with its own current instructions;
- `send` leaves out pages read with an earlier version, and the site keeps what it already has of them.

So a change to the instructions is a change to every book read after it, and it needs a deploy before pages read with it can be sent.

## How to change them

1. **Name the fault.** Change the instructions for a fault seen on real pages, with the page numbers, not for wording that merely looks dated. A heading level, or a lost chapter number, can often be fixed in the EPUB builder instead (`lib/library/text-epub.ts`), with no new fingerprint. Prefer that when the fix needs no new information from the page picture.
2. **Write the new version beside the old** in the book's eval folder (outside git). Keep the rule list as a format specification: the output is format-sensitive. Give context and reasons, not louder rules.
3. **Measure both on the same pages**, read on the subscription:
   ```bash
   npx tsx scripts/eval-transcribe-prompt.ts <scan.pdf> <out> <spec.json> <old.md> <new.md> --repeats 2
   ```
   The spec lists the pages and gives, for some of them, the checked text and the expected headings. Take pages from four kinds:
   - every page the fault was seen on;
   - pages with a checked answer key (*The Pay Off* has five: `~/Documents/neolibrary-ocr-test/results/truth/`);
   - chapter openings and part pages;
   - notes, sources and index pages.
4. **Keep the new version only if it fixes the fault and loses nothing.** It must have:
   - no more words wrong against the checked text;
   - no new refusals;
   - no more pages flagged by the check;
   - the expected headings on at least as many readings.

   Write the numbers in `docs/audits/` and in the ledger.
5. **Deploy, then read again** the pages that need it (`reread`), and `send`.

## The current instructions, and why each line is there

- **Owner and purpose** (whose book, a private copy beside the scan): Sonnet 5.5 once declined a page as copyrighted without it (p. 213 of *The Pay Off*).
- **"Copy the author's words exactly…"**: the whole point; the page check measures it.
- **Line-end hyphens; one paragraph per printed paragraph**: so pages join into a flowing text.
- **Drop cap**: a layout fact; Apple's OCR lost two lines beside one.
- **Headings rule** (# for part and chapter titles with their printed number; ## inside, including chapter labels in notes and sources): pages are read one at a time, and the level was guessed differently on different pages (p. 23, 45, 358).
- **Footnotes as `[^n]`**: the builder links them both ways. **A note carried over from the page before as `[^0]`**: the builder ends that note with it. Without this rule, Claude wrote such text as an ordinary paragraph at the foot of the page, and it broke the main text (p. 150 and 287); with it, 4 of 4 readings were right.
- **Running head and page number left out**: the builder adds its own page markers.
- **Tables as Markdown; figures as a caption**: a figure's words are kept only as its caption, so pages with figures are flagged by the check.
- **"Output only the Markdown"**: a preamble would become text on the page.

The evaluation behind the current version is in `docs/audits/2026-10-17-scan-to-text-prompt-audit.md`.
