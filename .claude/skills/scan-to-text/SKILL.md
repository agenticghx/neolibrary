---
name: scan-to-text
description: Turn a scanned book (a PDF of page photographs) in Samuel's Neolibrary into a faithful flowing text edition beside the scan, read on his Claude subscription, checked page by page, and put on the live site. Use for any work on scanned or image-only books - converting one, finding or fixing faults in a text edition (words, headings, tables, text over text), reading pages again, or changing the page-reading instructions - including when Samuel only sends a screenshot of the text edition.
---

# Scan to text

Written for Claude sessions working on Neolibrary (`agenticghx/neolibrary`, public). Samuel, the owner, is a scientist: tell him in plain English what was done, what was checked, and what is his to do. Its figures come from the first whole book, *The Pay Off* (388 pages).

## What this makes

A **text edition** is a second book linked to the scan (`books.edition_of`). It is an EPUB made from each page's Markdown, read by Claude from the page picture. It is hidden from the library's lists, and it opens by default when the scan is opened. The scan stays the original: every page of the edition carries a marker back to its printed page, and its first page ("About this edition") names the model, the date and the pages to check.

The server could read pages itself through the Batch API, but it has no Anthropic key and Samuel's API budget is small. So pages are read **on the laptop, on Samuel's subscription** (`claude -p`, $0), then sent to the live site with his API token. Same picture code, same instructions (`prompts/transcribe-page.md`, byte for byte), same model (Claude Sonnet 5.5), so the server treats the pages as its own and never reads them again.

## Rules that bound everything

- **Subscription only.** Never call the Anthropic API for this, and never set `ANTHROPIC_API_KEY` for it; the script removes it from `claude -p`'s environment. If the subscription limit is reached, stop and say so; do not switch to the API.
- **Never edit a page's text by hand.** A wrong page is read again (`reread`), so every word on the live site came from a model reading the picture (ground rule 5, provenance). Earlier readings are kept, never deleted.
- **No book text in git.** Page files, previews and pictures live under `~/Documents/neolibrary-text-edition/<book>/`. The repository is public.
- **Keys by name only.** The owner's API token is the Keychain item `NEOLIBRARY_AGENT_TOKEN` (`keyls` shows it). Never print it, and never ask Samuel to paste it. If it is missing, ask him to make one at /agents and run `keyadd NEOLIBRARY_AGENT_TOKEN` in Terminal.
- **Only DRM-free files Samuel owns** (ground rule 1). Whether he may keep a copy is his call; if a scan shows signs it may not be his (a library's stamp or barcode), tell him and let him decide. The PDF must be the very file on the shelf: `send` refuses a page count that differs from the book's.
- **Deploy only when the code changed.** Sending pages needs no deploy. A change to `prompts/transcribe-page.md` does: the server refuses pages read with other instructions than its own.

## The workflow

`S=scripts/text-edition-on-subscription.ts` and `F=~/Documents/neolibrary-text-edition/<book>` below. Every command runs from the repository root with `npx tsx`. `read` takes about 15 minutes for a 400-page book (run it in the background); `check`, `pictures` and `preview` take seconds. On the laptop the token loads from the Keychain only in a login shell, so run anything that uses it through `zsh -ic '…'`.

1. **Find the book and its file.** Look the book up with the token, and note its id:
   ```bash
   zsh -ic 'curl -s -H "authorization: Bearer $NEOLIBRARY_AGENT_TOKEN" "<site>/api/agent/books?q=<title>"'
   ```
   The PDF is the one Samuel added. *The Pay Off*'s copy is at `~/Documents/neolibrary-ocr-test/book/the-pay-off.pdf`.
2. **Read every page.** About 25 pages a minute with 4 at a time; run it in the background.
   ```bash
   npx tsx $S read <pdf> $F --jobs 4
   ```
   - Pages with almost no ink are skipped as blank. An answer in which Claude declines and offers a summary is a failed try; it happened once in 360 pages.
   - Stopped part-way, the same command reads only the pages still missing.
   **For the best result, read the book a second time** into another folder (`$F-2`), then compare the two readings:
   ```bash
   npx tsx $S compare $F $F-2
   ```
   Pages read word for word alike twice are very likely right. Look at each page that differs, or read it a third time as a tiebreak (`reread` in the second folder). The differences on *The Pay Off*, 360 pages:
   - 354 pages agreed;
   - hyphens at a line end were guessed both ways: keep the book's usual spelling (count both spellings across the page files), and leave it where the book uses both;
   - a library sticker was read as text: read the page again.

   Send the folder you settle on.
3. **Check, then look.**
   ```bash
   npx tsx $S check <pdf> $F
   ```
   It writes `$F/check.json` and lists:
   - pages to look at, each with why: Claude's reading and the scan's hidden text (the scan's own OCR text) disagree. The number is the share of the words read that the hidden text also has. A page at 1 can still be flagged, for a run of hidden-text words missing from the reading (usually a figure's labels, or a footnote);
   - pages where Claude declined, and pages neither read nor blank;
   - gaps or doubles in the chapter numbers, headings the builder will make level 2 (fine: it evens out levels across pages), and words marked unreadable `[?]` (a sticker or a tear on the scan; reading again cannot fix them);
   - five unflagged pages to look at too, one a chapter opening: the check misses a few words reworded.

   It exits 0 whatever it finds; read its output. Then look at every flagged page and every sampled page against its picture:
   ```bash
   npx tsx $S pictures <pdf> <scratch folder> <pages> --from $F
   ```
   This writes `page-N.png` and, beside it, the reading as `page-N.md`; open both with the Read tool.

   Expect contents and index pages, sideways tables, figures and tables to be flagged; they usually read right, and the hidden text is the faulty one. Check a table number by number. A page that is wrong is read again:
   ```bash
   npx tsx $S reread <pdf> $F <pages>
   ```
   After two wrong readings, add `--model claude-opus-5-5` (`read` with `--pages`).
4. **Preview and over-text check.**
   ```bash
   npx tsx $S preview $F <out.epub> --title "<title>" --author "<author>"
   ```
   It builds the EPUB the server will build (its About page lists the pages from the last `check`) and prints:
   - **The contents list.** Compare it with the printed contents page: parts with their names, every chapter numbered, nothing split or doubled. The title page, the contents and the front matter come first although the printed contents does not list them; that is expected.
   - **Paragraphs that open mid-sentence**, by page. The builder carries a sentence on across pages, tables and figures. What is left is usually a note carried over from the page before and read as text, or a printed block quote; look at the page and the one before it, and read again what is wrong.
   - **The over-text check.** Every chapter is laid out at a phone's and a desktop's column width, with anything wider than the column listed: text over text in the reader. It exits with code 2 if any is found. A table that scrolls sideways is fine; a table wider than the column is not.
5. **Send.**
   ```bash
   npx tsx $S send $F <site> <book id>
   ```
   Run it through `zsh -ic '…'` so the token loads. It sends only pages read with the current instructions (the site refuses others, and keeps what it has of earlier ones); with none, it has the site make the edition again from what it has. Sent again, it adds only what changed, and the edition keeps its id, so readers' notes and places stay.

   The answer's `read`, `blankPages` and `toCheck` must match step 3's.
6. **Hand over to Samuel.** Claude cannot sign in. Samuel opens the book: it opens as text. He checks the contents list and a chapter on his phone, and looks at the flagged pages ("About this edition" links them).

## Done when (the quality bar)

- Every page is read or blank: `check` says "0 neither" and "Declined: none".
- The book was read twice, and every page the two readings disagree on was looked at or settled by a third reading.
- Chapter numbers have no gap or double, unless the printed book has one; check its picture.
- Every flagged page, and the five sampled unflagged pages, have been looked at against their pictures, and each is either right or read again.
- Every paragraph `preview` lists as opening mid-sentence has been looked at, and is right as printed or read again.
- The preview's contents list matches the printed contents page.
- The over-text check finds nothing wider than the column.
- The live answer matches the local check, and the ledger entry says all of the above with the commands run.

## What the checks can and cannot catch

Measured on *The Pay Off* (2026-10-17) by planting faults in 330 good pages (`lib/library/page-check.ts` holds the figures):

| Planted fault | Caught on |
|---|---|
| 6 words reworded | 330 of 330 |
| 8 words left out | 306 of 330 |
| a sentence left out | 186 of 203 |
| 3 words reworded | 6 of 330 |

So a small rewording can slip through. Looking at a sample of unflagged pages by eye is the only guard against it.

The check also cannot see:
- a heading's level or a chapter number lost (use `check`'s chapter numbers and the preview's contents);
- a table's numbers (look at the picture);
- layout faults (use `preview`);
- what a figure shows: only its caption is kept, so a figure the text explains is lost to the reader of the text edition (the scan keeps it);
- the indentation of an index's sub-entries, which comes out flat.

## Files

- `scripts/text-edition-on-subscription.ts`: `read`, `check`, `pictures`, `reread`, `preview`, `compare`, `send`.
- `prompts/transcribe-page.md`: the reading instructions. Changing them changes every page's fingerprint; read `references/prompt.md` first.
- `scripts/eval-transcribe-prompt.ts`: compares versions of the instructions on chosen pages (words wrong against a checked text, refusals, flags, headings, text a page must contain).
- `lib/library/page-check.ts`: the check. `lib/library/text-epub.ts`: pages to chapters to EPUB. `lib/library/text-edition.ts`: `savePagesReadElsewhere`, the server side of `send`.
- `app/api/agent/books/[id]/text-edition/route.ts`: the route `send` posts to.
- `docs/scan-to-text-plan.md`: the plan (M25) and its decisions.
