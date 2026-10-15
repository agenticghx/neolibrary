# M25 · Scanned books become flowing books (plan)

Written for: Samuel, and the Claude sessions that build this. Written
2026-10-15. Plain English first; jargon is defined where it first appears.

## The goal, in Samuel's words

A scanned book (a PDF where each page is a photograph of the printed page,
such as *The Pay Off* from the Internet Archive) should also be readable as
a **flowing book**, like an EPUB: your font size, Focus, Night, comfortable
on a phone. Samuel chose this on 2026-10-15 ("2", over "better text behind
the page"), and chose how ("a, go with Sonnet batched").

The flowing text sits **beside** the scan, never in place of it. The scan
stays the original, and every word can be checked against the printed page.

## What the 5-page test showed (2026-10-15)

Eight readers turned the same five pages of *The Pay Off* into text: the
contents page, an ordinary page, a chapter opening with a large first letter
and a footnote, a heading with a footnote, and a table printed sideways.
Results are on the laptop in `~/Documents/neolibrary-ocr-test/report.html`
(not in git: it holds the book's text). Out of about 1,140 words:

| Reader | Words wrong | Headings, paragraphs, footnotes, table |
|---|---|---|
| Claude Opus 5.5, Claude Sonnet 5.5, Gemini 3.8 Flash (each reads the page picture) | 0 | all right |
| Marker (free, on the laptop) | 5 | right, but every table column labelled wrong |
| The Archive's own hidden text, tidied by Claude (no picture) | 152 | right, but the table could not be rebuilt |
| Tesseract, Apple's OCR, the Archive's hidden text as it is | 166 to 184 | none: lines of text only |

OCR (optical character recognition): software that reads the words off a
picture of a page. The answer key was written by Claude from the page
pictures, so Claude's 0 is not independent proof; Gemini, from another
company, agreed on every word, and every place a plain OCR reader disagreed
was checked against the page and was the reader's mistake. Five pages
cannot show how often an AI reader rewords a sentence across a whole book,
which is why step S3 checks every page against a second reading.

**Cost, measured:** Claude Sonnet 5.5 used about 4,270 tokens in (a page
picture is 3,920 tokens: one per 28 x 28-pixel square) and about 700 out
per page. With the **Batch API** (Anthropic's half-price queue: requests
are sent together and answered within 24 hours, usually within 1) that is
$1 per million tokens in and $5 out, so **about $0.0078 a page, $3.01 for
*The Pay Off*'s 388 pages**. The app's AI limit is $5 per book
(`AI_CAP_PER_BOOK_USD`), shared with every other Claude use on that book;
on 2026-10-15 *The Pay Off* had none.

**Found on the way:** the Archive's hidden text for page 51 (the sideways
table) is gibberish, so Listen, search and the AI tools read nonsense on
that page today. It is the only such page of 388.

## How it will work

1. **The owner starts it, on purpose.** On a scanned PDF's book page:
   "Make a flowing text edition", with the page count, the estimated cost
   and what is already spent on the book against its limit. Nothing starts
   until the owner ticks "I understand this reads all N pages with Claude
   and costs about $X". Owner only, like whole-book narration.
2. **The server draws each page as a picture** at the scan's own size
   (which already fits Claude's high-resolution limit of 2,576 pixels on
   the long edge), skipping pages with almost no ink so nothing is invented
   for a blank page.
3. **The pictures go to Claude Sonnet 5.5 in batches** of about 100 pages
   (a batch may hold at most 256 MB; 388 pictures are about 230 MB), each
   with the tested instructions (`prompts/transcribe-page.md`, word for
   word what was tested). The batch numbers are kept in the database, so a
   redeploy or restart while Anthropic works does not lose them; the server
   checks on them every minute and on start-up.
4. **Each page's answer is stored like every other AI answer** (a
   `generations` row: kind `transcribe`, the page as its section, the model,
   fingerprints of the prompt and the picture, tokens, and the cost at the
   batch price). So it counts toward the limits, carries its provenance
   (ground rule 5), is never paid for twice, and goes into the export.
5. **Every page is checked against a second reading.** Each page's text is
   compared word by word with the scan's own hidden text (free; already
   read by `lib/library/pdf-sections.ts`). Pages that agree less than a set
   threshold are listed as "Check these pages", each linking to the scan.
   Page 51 will be on that list, correctly: there the hidden text is the
   wrong one.
6. **The pages are joined into an EPUB**, the text edition:
   - a paragraph that ends a page without closing punctuation goes on into
     the next page;
   - a `#` heading starts a chapter (front matter before the first one);
   - footnotes are gathered at the end of their chapter, linked both ways;
   - each page boundary keeps an invisible page marker (EPUB's standard
     `epub:type="pagebreak"` with the printed page number, plus a page list
     in the book's contents file), so "Go to page" works and every page can
     link back to its scan;
   - machine-written text looks different (ground rule 5): a line at the
     start says it was read from the scan by Claude Sonnet 5.5 on a date.
7. **The reader offers Scan | Text** for a book with a text edition. Text
   opens the EPUB in the normal reader, with everything an EPUB has.

## Decisions taken, and defaults that apply until Samuel says otherwise

- Model and route: Claude Sonnet 5.5 through the Batch API (Samuel,
  2026-10-15). No server-side fallback (it is for live requests); a page
  Claude declines is listed as "not read" and can be tried again.
- **Notes stay with their edition** (default). A note made on the scan does
  not appear in the text edition, and the other way round. Notes already
  carry the quoted text, so moving them across editions is a later step.
- **Owner only** (default), like whole-book narration.
- **Listen on the scan still reads the Archive's hidden text** (default):
  page 51 stays wrong there until a later step lets the transcription
  replace that text. In the text edition, Listen reads the new text.
- No spending limit is raised. If a book's estimate does not fit its
  remaining limit, the page says so and nothing starts.

## Steps (one pull request each)

- **S1 · This plan** (docs only), with the Open unknowns rows and the
  decision in `PROGRESS.md`. Done when: merged.
- **S2 · A batch adapter for Claude.** A `TextBatchModel` interface (send
  requests, check a batch, read results, cancel) with the Claude version
  (`client.messages.batches.*`, model passed in, images allowed, no
  fallback field) and a fake for tests (ground rule 3). Results are matched
  by each request's `custom_id`; costs at half the `PRICES` rate. Done
  when: unit tests with a stand-in `fetch` cover a finished, an errored, a
  cancelled and an expired request, and the fake returns canned Markdown.
- **S3 · Page pictures on the server.** `@napi-rs/canvas` becomes a direct
  dependency; a function draws one PDF page as a PNG at its own size with
  pdf.js (decoders from the filesystem), and says when a page is nearly
  blank. Done when: `fixtures/books/scanned-meditation.pdf` gives two PNGs
  with ink (JPEG 2000 and JBIG2) in a unit test, and a deploy shows the
  canvas package loads on Railway (one start-up log line).
- **S4 · The job.** Migration 0027 (with its reverse step; a backup before
  it runs in production): a `batch_jobs` table (book, owner, status, the
  Anthropic batch numbers, pages, estimate) and the book's text-edition
  columns. Start (estimate, limit check, confirm), checking every minute
  and on start-up, storing pages as `generations` rows, Stop (cancels the
  batches; pages not yet read are not charged), the agreement check, and
  routes. Done when: unit and route tests with the fake run a book to the
  end, survive a pretend restart mid-batch, stop, refuse without the
  confirm box, refuse a reader who is not the owner, refuse over the limit,
  and list a page whose hidden text disagrees.
- **S5 · The EPUB text edition.** Markdown to XHTML (headings, paragraphs,
  emphasis, tables, footnotes; no Markdown library is installed and none is
  needed), the joining rules above, page markers and page list, a proper
  EPUB (mimetype stored uncompressed first), stored beside the scan; the
  export carries it and an export, wipe and import round trip brings it
  back (ground rule 7). Done when: unit tests on the joining rules (a
  paragraph across a page break, footnotes, a table, a heading mid-page)
  pass, and the scanned fixture's edition opens in the reader.
- **S6 · Scan | Text in the reader.** Shown to Samuel first as 2 or 3
  options (where the switch sits, how a page links back to its scan).
  Done when: a browser test opens the text edition, changes the font size,
  goes to a page by number and back to the same page of the scan, with
  screenshots on phone and desktop, light and dark.
- **S7 · The book page.** "Make a flowing text edition": estimate,
  remaining limit, the confirm box, progress (pages read of N), Stop,
  "Check these pages", owner only. Done when: a browser test with the fake
  runs it end to end, with the four screenshots and the accessibility check.
- **S8 · The real run on *The Pay Off*.** After S4's migration is deployed
  with a backup, Samuel ticks the box himself. Then: count the pages
  flagged, look at them, and read a chapter in the text edition on the
  phone.

## Later, not in M25

- Let the transcription replace a scanned PDF's hidden text for Listen,
  search and the AI tools (fixes page 51 on the scan too).
- Move notes between editions by their quoted text.
- Smaller page pictures to halve the cost (Gemini scored 0 with about a
  quarter of the pixels; untested on Claude).
- Readers other than the owner.
