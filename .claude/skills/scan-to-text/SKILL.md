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
- **Only DRM-free files Samuel owns** (ground rule 1). The PDF must be the very file on the shelf: `send` refuses a page count that differs from the book's.
- **Deploy only when the code changed.** Sending pages needs no deploy. A change to `prompts/transcribe-page.md` does: the server refuses pages read with other instructions than its own.

## The workflow

`S=scripts/text-edition-on-subscription.ts` and `F=~/Documents/neolibrary-text-edition/<book>` below. Every command runs from the repository root with `npx tsx`.

1. **Find the book and its file.** Look the book up with the token, and note its id:
   ```bash
   curl -s -H "authorization: Bearer $NEOLIBRARY_AGENT_TOKEN" "<site>/api/agent/books?q=<title>"
   ```
   The PDF is the one Samuel added. *The Pay Off*'s copy is at `~/Documents/neolibrary-ocr-test/book/the-pay-off.pdf`.
2. **Read every page.** About 25 pages a minute with 4 at a time; run it in the background.
   ```bash
   npx tsx $S read <pdf> $F --jobs 4
   ```
   - Pages with almost no ink are skipped as blank. An answer in which Claude declines and offers a summary is a failed try; it happened once in 360 pages.
   - Stopped part-way, the same command reads only the pages still missing.
3. **Check, then look.**
   ```bash
   npx tsx $S check <pdf> $F
   ```
   It lists:
   - pages to look at: Claude's reading and the scan's hidden text disagree, letters lined up both ways;
   - pages where Claude declined, and pages neither read nor blank;
   - every chapter heading, and any gap in the chapter numbers.

   Then look at every flagged page against its picture:
   ```bash
   npx tsx $S pictures <pdf> <scratch folder> <pages>
   ```
   Open each picture with the Read tool next to the page's Markdown.

   Expect contents and index pages, sideways tables, figures and tables to be flagged; they usually read right, and the hidden text is the faulty one. Check a table number by number. A page that is wrong, or a heading that lost its number or level, is read again:
   ```bash
   npx tsx $S reread <pdf> $F <pages>
   ```
   After two wrong readings, add `--model claude-opus-5-5` (`read` with `--pages`).
4. **Preview and over-text check.**
   ```bash
   npx tsx $S preview $F <out.epub> --title "<title>" --author "<author>"
   ```
   It builds the EPUB the server will build and prints its contents list. Compare that list with the printed contents page: parts with their names, every chapter numbered, nothing split or doubled.

   It also lays out every chapter at a phone's and a desktop's column width, and lists anything wider than the column: text over text in the reader. It exits with code 2 if any is found. A table that scrolls sideways is fine; a table wider than the column is not.
5. **Send.**
   ```bash
   npx tsx $S send $F <site> <book id>
   ```
   The token is read from the environment; on the laptop, run it through `zsh -ic '…'` so the Keychain loads it. Sent again, it adds only what changed, and the edition keeps its id, so readers' notes and places stay.

   The answer's `read`, `blankPages` and `toCheck` must match step 3's.
6. **Hand over to Samuel.** Claude cannot sign in. Samuel opens the book: it opens as text. He checks the contents list and a chapter on his phone, and looks at the flagged pages ("About this edition" links them).

## Done when (the quality bar)

- Every page is read or blank: `check` says "0 neither" and "Declined: none".
- Chapter numbers have no gap or double, unless the printed book has one; check its picture.
- Every flagged page has been looked at against its picture, and each is either right or read again.
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
- a heading's level or a chapter number lost (use `check`'s heading list);
- a table's numbers (look at the picture);
- layout faults (use `preview`).

## Files

- `scripts/text-edition-on-subscription.ts`: `read`, `check`, `pictures`, `reread`, `preview`, `send`.
- `prompts/transcribe-page.md`: the reading instructions. Changing them changes every page's fingerprint; read `references/prompt.md` first.
- `scripts/eval-transcribe-prompt.ts`: compares two versions of the instructions on chosen pages (words wrong against a checked text, refusals, flags, headings).
- `lib/library/page-check.ts`: the check. `lib/library/text-epub.ts`: pages to chapters to EPUB. `lib/library/text-edition.ts`: `savePagesReadElsewhere`, the server side of `send`.
- `app/api/agent/books/[id]/text-edition/route.ts`: the route `send` posts to.
- `docs/scan-to-text-plan.md`: the plan (M25) and its decisions.
