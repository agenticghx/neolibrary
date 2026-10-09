# Hearing PDF books: the plan

Written for: Samuel first, and the Claude sessions that build it. Written
2026-10-09, after Samuel asked to (a) let the AI voice read PDF books in the
app, tested on chapter 1 of *The Grid* (Bakke), and (b) close the gap in
making a PDF audiobook on the laptop and uploading it.

Words used here:
- **AI voice** (or "made voice"): ElevenLabs reads a paragraph aloud the
  first time you play it; the audio is saved and plays free after that.
- **Word times**: for each spoken word, when it starts and ends in the
  audio, and which letters of the text it is. The reader uses them to light
  up the word being said.
- **Text layer**: pdf.js (the program that draws PDF pages in the reader)
  puts an invisible copy of the page's text over the picture of the page.
  The lit word is drawn on it.
- **Read-along package**: an audiobook plus its word times and where each
  paragraph is in the book, made on the laptop by the `readalong-audio` skill
  and uploaded on the book's page ("Your audiobook").

## Where things stand (checked 2026-10-09)

- In a PDF book, Listen plays only an uploaded audiobook. The AI voice is
  switched off for PDFs (`lib/library/listen.ts`, `configured = fileType === "epub"`),
  and the bar says "In a PDF book, Listen plays your own audiobook"
  (`lib/player/session.ts`).
- The reason given in the code: the AI voice's word times "cannot be placed
  on a PDF page yet". That was true before M13 (e). Since M13 (e) (5 October),
  an uploaded audiobook's words *are* placed on PDF pages: the server sends,
  for each word, how many non-space characters come before it on its page,
  and the reader finds the word in the text layer by that count. The AI
  voice's word times are offsets into the same paragraph text, so the same
  count works for them. Nobody has connected the two yet.
- How the app splits *The Grid* (run on Samuel's copy, pages 22–41, with the
  app's own `extractPdfSections`): 23 paragraphs, one per page plus the
  chapter title. A page is about 2,800 characters (largest 2,865) and starts
  and ends mid-sentence. The book was made by calibre from an ebook. It has
  no running headers or page numbers, so the voice would not read them out.
  Chapter 1 is 48,526 characters.

## Part A: the AI voice reads PDF books (build now)

**What changes (one pull request):**
1. The server offers the AI voices in a PDF book, as in an EPUB.
2. With each made paragraph's audio, the server also sends where each of its
   words sits on the page (`inPage`, the same count the uploaded audiobook
   uses). It is worked out when asked, not stored, so the database does not
   change.
3. The player passes that place to the reader when it lights a word (today
   it passes it only for an uploaded audiobook).
4. The bar shows the paragraph's cost, as in an EPUB, instead of "In a PDF
   book, Listen plays your own audiobook". The library counts a PDF as
   "Read and listen" when the AI voice is set up.
5. **Not changed:** narrating a whole book on the Import page stays EPUB
   only. Your rule stands: no whole-book ElevenLabs until you say so.

**Known limits of Part A (fixed later, in Part C):**
- The voice reads every "paragraph" the app found, so in a PDF that prints a
  running head ("Introduction") or a page number on each page, it reads those
  out too. *The Grid* has neither. Kuhn's PDF has a journal footer.
- A page is read as one piece, so the voice stops at the foot of each page,
  often mid-sentence, while the next page's audio is made (see Part B).
- Library labels and Home's "Listen from here" still treat a PDF without an
  uploaded audiobook as "Read only". That changes in a second small pull
  request (Part A2), because it changes several browser tests and reference
  screenshots.

**Cost, and the cap (read before pressing Listen):** one page of *The Grid*
is one paragraph, about $0.85 at the default price setting ($0.30 per 1,000
characters; your plan's real price may differ). The voice cap per book is
$5 by default, so the AI voice stops after about 6 pages of one book.
Chapter 1 would cost about $14.56 and the cap would stop it. I will not raise
the cap. The test is two or three pages, not the chapter.

**How it is tested:**
- Unit tests: a made track in a PDF carries each word's place on the page,
  and in the right order; the voices are offered in a PDF.
- Browser test (CI), with the fake voice on the public-domain PDF the tests
  already use: Listen in a PDF plays the AI voice, and every word lights up
  in order on the page, as the uploaded-audiobook tests check.
- By hand, on the laptop, with the fake voice on *The Grid* pages 22–24
  (Samuel's copy; never in git): words light over the right printed words,
  and the page turns at the end of a page. A screenshot goes in the PR.
- Real voice: after the deploy, Samuel presses Listen on page 22 of *The
  Grid* on the live site (about $0.85 a page) and says whether it sounds
  right and keeps time.

## Part B: no pause at every page turn (after measuring)

The player asks for the next paragraph's audio only when the current one
ends. A PDF page is a long paragraph, so making it takes ElevenLabs several
seconds, and the voice would stop mid-sentence at each page turn while it is
made. Fix: start making the next paragraph while the current one plays.
That spends money on one paragraph you may never hear if you stop, so first
measure how long the pause is with the real voice (Part A's live test), then
decide. If it is built: one paragraph ahead at most, and only after the
current one is half played.

## Part C: real paragraphs in PDFs (later)

The root fix for long, mid-sentence "paragraphs": split a PDF page where a
line starts indented (pdf.js gives each line's left edge), not only where
there is extra space. Shorter paragraphs would make the voice start sooner
and cost less per press. The catch: it changes only PDFs added from then on.
Re-reading the text of a book already in the library changes its paragraph
ids, which would cut loose any audio already made for it and any audiobook
uploaded for it (Kuhn's). So "re-read this book's text" is its own step,
allowed only for a book with no uploaded audiobook, and it keeps notes
(they are anchored by quoted text and page, ground rule 2).

## Part D: making a PDF audiobook on the laptop (plan; close the gap)

Today `book-chapters` splits EPUBs by script and PDFs only by hand, and
`readalong-audio` then narrates (Kyutai runs free on the laptop; paid
voices sit under a $3 cap) and lines the words up with the book. The gap is
the PDF side. Good tools exist; use them:

1. **Chapters from the outline.** PyMuPDF (`fitz`, installed) reads the PDF's
   bookmarks: *The Grid* has one per chapter (chapter 1 = pages 22–41). With
   no outline, find chapter starts from large or bold heading lines
   (PyMuPDF gives each line's font size and weight).
2. **Clean text for the voice.** PyMuPDF's text blocks in reading order;
   drop running headers and footers (a line repeated at the top or bottom of
   most pages, page numbers); join words broken by a hyphen at a line end or
   a page end; start a paragraph where a line is indented; drop footnote
   markers ("research.2") from what is spoken; keep a report of every change.
   For scanned PDFs (pictures, no text), OCR first (`ocrmypdf`) or skip.
   Two-column or very messy layouts: try `marker` or `docling`, which
   rebuild a document's structure, and compare.
3. **Same text as the app for lining up.** The narration script can come from
   any of these tools, but the step that finds each spoken paragraph in the
   book (`map_to_book.py`) must use the text exactly as the app reads it
   (pdf.js with the same character maps, `lib/library/pdf-sections.ts`).
   Otherwise words are lost when the package is uploaded, as with Kuhn (451
   of 475 script paragraphs found). So: export the app's own paragraphs for
   the PDF (a small script that runs `extractPdfSections`) and match against
   those.
4. **Script it.** A `pdf_chapters.py` in the `book-chapters` skill doing 1–2,
   with tests on a public-domain PDF, and `map_to_book.py` reading the app's
   paragraphs (step 3). Then the round trip: chapter 1 of *The Grid* with
   the free Kyutai voice, uploaded on the book's page on the local app, words
   lit in order.

## Part C also: leave running heads and page numbers unread

When the app splits a PDF (Part C), mark a short line that sits at the very
top or bottom of most pages (a running head, a page number) as "not read".
It stays in the page's text, so every word's place on the page is unchanged,
but the voice skips it. Same rule as Part D step 2, in the app.

Order: Part A now (this PR), then A2 (labels). Part D next. Part B after
Samuel's live test of Part A. Part C after that.
