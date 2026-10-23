# Neolibrary build plan

Written for: the Claude cloud sessions that will build this, and for Samuel
(owner, a scientist, not a software engineer). Jargon is defined on first use.
Source of the goals: `docs/vision.md` (Samuel keeps editing it; if the two
disagree, the vision wins and this plan gets updated). Revised 2026-10-03
with advice from a review by Claude Fable; tagged *(Fable)* where it changed
the plan.

## What we are building, in one paragraph

A private web app that is a personal library: a beautiful bookshelf of
Samuel's own ebooks, a reader where you can read and listen at the same time,
and AI help attached to every section (rewrite a paragraph at your level,
"what do I need to know first", a question bank, a picture of the thing being
described). A few trusted people get invited; strangers cannot get in. Later,
other people may get their own libraries.

**Why it exists.** Study material is scattered: text, audio, notes and
highlights are split across separate stores and apps that don't talk to each
other, audio and text are sold separately, notes are hard to get out, and
books are written for one generic reader. Neolibrary puts one person's study
in one place, and everything in it can be exported.

## The library comes first; Paths are one way to study it (Samuel, 2026-10-05)

This replaces "The core idea" below, which made a study path the front door.
Samuel's words: "this is a digital library that holds books, audiobooks,
annotations, many learning materials … not a hidden machinery library."

- **Neolibrary is a library.** It holds ebooks, PDFs, audiobooks, your
  annotations (highlights, notes, voice notes) and the learning materials the
  app makes from them (rewrites, pictures, question banks).
- **Home, after sign-in:** "Continue" at the top (what you are reading or
  listening to now, with its progress), then your whole library, with
  Import (drag and drop) right there.
- **Apple Books is the model for structure, not for looks.** From a screenshot
  Samuel shared (Apple Books on the Mac, 2026-10-05): a sidebar with Search
  and Home; a *Library* group that filters everything by kind and status (All,
  Want to Read, Finished, Books, Audiobooks, PDFs); a *My Collections* group
  with "New Collection"; Home with "Continue" cards ("Audiobook · 69%") and
  titled rows of covers; a mini-player (a small audio bar at the bottom) that
  keeps an audiobook playing while you browse. There are no stores here:
  Import takes their place. The look stays ours (`docs/design.md`: warm
  paper, cloth covers, serif type), and Samuel asked that the experience be
  innovated, "not just copy cat" (see M14).
- **Paths are curricula: ordered reading plans** such as Hidden Machinery
  (pillars, a narrative book first, a deeper book second). A Path may list
  titles that have no book file or audio yet: they show greyed out and
  become fully visible when you add the file. A Path is one group in the
  sidebar, not the home page. Notes can still attach to a Path or a Pillar.
- **Everything in the library is yours; never say "owned" or "not owned"**
  (Samuel, 2026-10-05: "a book I upload is a book I own! uploaded books
  titles can still appear they are just unavailable to read or listen or
  both!"). Every title says what is available: **Read and listen**, **Read
  only** (a book file, no audio), **Listen only** (audio, no book file), or
  **Not available yet** (a title with neither: greyed cover, with a way to
  add the file). "Listen" counts ElevenLabs narration too (Samuel,
  2026-10-05: "of course yes"): with narration switched on, every EPUB is
  Read and listen, and every PDF too since 2026-10-10 (the AI voice lights
  each word on the PDF page: docs/pdf-narration-plan.md, Parts A and A2). Titles with nothing available yet appear in the library
  too, not only on Paths. The older sections below that say "owned" or
  "unowned" mean exactly this.
- **Collections are unordered groups of materials**, as in Apple Books.
- **A book and its audiobook are one item** you can read and listen to
  together (M13), not two separate items as in Apple Books.

## The core idea: study paths, not just books *(Fable)* — superseded 2026-10-05

*Superseded by Samuel on 2026-10-05: Paths stay (as curricula, with
placeholders), but the library, not a Path, is the home page. See the section
above and M14. Kept for the history of the data model.*

Samuel's reading list (`docs/reading-lists/hidden-machinery.md`) shows how
Samuel actually studies: a **pillar** (a topic, e.g. "Semiconductors") with a
motivating question, a **narrative book (N)** read first to get curious, an
**engineering/economics book (E)** read second to go deeper, then extras and
rejected picks, and a **master key** read last. Samuel's notes are often about a
*pair* or a *pillar* ("the *Oil 101* of GPS", "read after Mishkin"), not about
a spot inside one book.

So the shelf *is* the curriculum:

- A **Path** (e.g. "Hidden Machinery") holds **Pillars**; a Pillar holds
  ordered **slots** (N, E, extra, master key) pointing at books, owned or not.
- Unowned books show dimmed; each pillar shows "you are here".
- Notes can attach to a Path, a Pillar, a Book or a Passage.
- Later (M6): the margin links across books ("you highlighted this idea in
  *Material World*, ch. 4").

Ordinary features (reader, audio, AI tools) are what make this pleasant;
the study path is what no other reader has.

## Choices already made (and why)

These are defaults so sessions can start. Each is recorded in `PROGRESS.md`
under Decisions; Samuel can overrule any one in a line.

| Area | Choice | Why |
|---|---|---|
| App framework | **Next.js** (TypeScript, App Router) | One codebase for pages and server code; the most documented web stack, so agents make fewer mistakes. |
| Reader engine | **foliate-js** | Open-source engine behind the Foliate reader; renders EPUB and PDF (via pdf.js), gives stable locations (EPUB CFI) that highlights and notes can attach to. |
| Database | **Postgres** with **Drizzle** (a TypeScript layer for writing database queries) | Standard, cheap, and Railway provides it with one click. |
| File storage | An **S3-compatible bucket** (a cloud folder for big files: book files, covers, audio, images) on Railway | Books and audio never go in the database or in git. |
| Hosting | **Railway** | Deploys straight from GitHub on every merge; Postgres and buckets live in the same project. |
| Login | **Invite-only accounts** (email + password or emailed link), no public sign-up | Each reader needs their *own* highlights and notes, which a single shared password can't do. Opening sign-up later is a switch, not a rewrite. |
| Text AI | **Claude API** (Anthropic) | Rewrites, prerequisites, question banks. Check the current model names when building. |
| Voice | **ElevenLabs API** | As stated in the vision. |
| Images | **Wikipedia / Wikimedia Commons images by default** (free, no key); **OpenAI image generation** (the model behind ChatGPT's images) when no good public image exists, behind a swappable interface | Decided by Samuel 2026-10-03. Claude does not generate images. Check OpenAI's current image model name when building. |
| Tests | **Vitest** (small checks of single functions) + **Playwright** (a robot browser that clicks through the app) | Lets an unattended session prove its own work. |
| Look and feel | A design system written as **tokens** (named values for every font, colour and spacing, e.g. `--ink-900`), not adjectives, in `docs/design.md`; built from Samuel's reference screenshots in `docs/design/refs/` | "Aesthetically pleasing" is the first requirement in the vision. Agents can't judge beauty but can match references and pass mechanical checks *(Fable)*. |
| Annotation format | **W3C Web Annotation** model (a published web standard for highlights and notes) with a *TextQuoteSelector*: the quoted words plus a few words before and after | Highlights survive a different edition, a PDF, or a changed location address; it is also the export format *(Fable)*. |

## Ground rules that never change

1. **No copyrighted book ever enters git.** Tests use public-domain books,
   preferably from **Standard Ebooks** (well-typeset, free EPUBs, so test
   screenshots look like a real library) or Project Gutenberg, stored under
   `fixtures/`. The app accepts **DRM-free files only** (DRM = copy protection
   on store-bought ebooks and audiobooks); it never removes DRM and never
   downloads books from anywhere. Removing DRM is restricted by US law (DMCA
   section 1201). *(Fable; not legal advice)*
2. **No secrets in git.** API keys live in environment variables (settings
   given to the app at run time). `.env.example` lists the names with blank
   values.
3. **Every outside service sits behind an interface with a fake.** ElevenLabs,
   Claude, image search and storage each get a "fake" version used in tests,
   because cloud sessions may not be allowed to reach those services and must
   not spend money in tests.
4. **Everything has an anchor.** Highlights, notes, voice notes, rewrites,
   images, questions point to a target: a Path, Pillar, Book, or Passage. A
   Passage anchor stores three things: the *section id*, the *EPUB CFI* (a
   standard address for a spot inside an EPUB, like a page-and-line number
   that survives font-size changes), **and** the quoted text with a few words
   either side (so it can be found again if the other two break). Build this
   once, in M3/M4, and reuse it.
5. **Pay for AI output once, and record where it came from.** Rewrites,
   audio, images and question banks are stored after the first request and
   reused. Each stores its *provenance* (a record of how it was made): model
   name, a fingerprint of the prompt file and of the input text, time and
   cost. On screen, machine-written text always looks different from the
   book's text and from Samuel's own notes. This can't be added later. *(Fable)*
6. Sharing a book file with other people can be copyright infringement even if
   you own it. Default: each person sees only books they uploaded; the owner
   can share a shelf deliberately. AI rewrites of a book stay private.
   A reader whose own copy holds the same text may be given a stored
   rewrite, Need to know or Test yourself as their own copy, without a new
   call (Samuel, 2026-10-17); Ask and Explain it back are never shared.
7. **No lock-in, tested.** Every new kind of data ships with an exporter, and
   a test does export → wipe → import and checks the data comes back
   identical. *(Fable)*
8. **Spending has a hard cap.** Any feature that calls a paid service shows an
   estimated cost before a big job (e.g. narrating a whole chapter) and stops
   at per-book and per-month limits set in environment variables. Tests never
   use real keys. *(Fable)*
9. **Notes are never overwritten.** Annotations are only added; edits make a
   new version and deletes only hide (*soft delete*). This makes offline sync
   (M12) simple and nothing is ever lost. *(Fable)*

## Milestones

Each milestone is sized for one to three cloud sessions. One milestone = one
or more pull requests (a pull request, or PR, is a proposed change that
the session merges into the main code once automated checks pass). "Done when" is the check a
session must pass and paste into its Log entry before calling it done.

### M0 · Set-up (Samuel, on the laptop; about 30 minutes)

Cloud sessions can't start until this exists.

1. Put the folder in git and on GitHub as a **private** repo
   (commands in `PROGRESS.md`, Exact next steps).
2. Create a Railway project with Postgres and a bucket; connect it to the
   GitHub repo.
3. API keys. The ElevenLabs key is already on Railway (done 2026-10-03).
   The app needs two more, later, not for M0: an **Anthropic** key before M6
   (the deployed app calls Claude for rewrites, STE, prerequisites and
   question banks), and an **OpenAI** key before M9 (image generation when
   Wikipedia has no good picture). Cloud sessions write code with their own
   Claude access and test with fakes, so they need neither key.
4. In the Claude cloud environment settings, add the environment variables
   listed in `.env.example` (sessions need the database and bucket only for
   deploy checks; tests use fakes).
5. On GitHub, turn on **branch protection** for `main` (a setting that blocks
   merging until the required checks pass), because sessions merge their own
   PRs.
6. **Design references** *(Fable)*: put 5–10 screenshots of apps, books or
   pages you find beautiful, and 3 you dislike, in `docs/design/refs/`, with
   one line each on why. Without these, "stunning" ends up as a template look.

Done when: a cloud session opened on the repo can read `PROGRESS.md`.

### M1 · Skeleton, design system, deploy pipeline

- Next.js app, linting, type checks, Vitest, Playwright.
- GitHub Actions (automatic checks GitHub runs on every PR): lint, type
  check, tests, plus:
  - **screenshot comparison** (Playwright `toHaveScreenshot`: fails if a page
    changes by more than a few pixels without the reference images being
    updated on purpose);
  - **accessibility and contrast** check (axe-core);
  - a lint rule that rejects colours and sizes not taken from the design tokens;
  - a check that fails a PR with no screenshots or no `PROGRESS.md` Log entry.
  - **auto-merge**: a GitHub Action (an automation GitHub runs itself) that
    merges a session's PR once every required check is green. Claude Code
    docs say cloud sessions can open PRs but not merge them, so this is how
    Samuel's self-merge decision works in practice. Turn on "Allow
    auto-merge" in the repo settings and branch protection on `main` with
    the CI checks required.
- A bot comment on every PR with a 2×2 screenshot grid (phone/desktop ×
  light/dark) so Samuel can judge the look in ten seconds.
- `docs/design.md`, derived from `docs/design/refs/` (Samuel's picks) and
  the Codex prototypes in `docs/design/prototypes/` (proposals: warm paper
  `#F3EDE1`, ink `#243239`, teal `#376963`; dark `#1B282F` / `#E7DDC9` /
  `#6B9F95`; prompts in `PROMPT.md` there): two real text faces,
  line length and line spacing set for long reading, spacing scale, colour
  tokens for light and dark, motion rules.
- No landing-page polish *(Fable)*: put the design effort into the shelf and
  the reader. A plain sign-in page is enough. Deployed on Railway.

Done when: CI is green with all the checks above running; the Railway URL
loads; the screenshot grid is posted on the PR.

### M2 · Lock and key (accounts)

- Invite-only accounts: Samuel is admin and creates invite links; no public
  sign-up page.
- Every page and file behind login; book files served through short-lived
  signed links (a URL that stops working after a few minutes).
- Data model has `user_id` everywhere from day one (makes "everyone gets their
  own library" later cheap).

Done when: Playwright proves that a logged-out visitor gets nothing (pages,
API, file URLs), and an invited user can log in.

### M3 · Bookshelf and study paths

- Upload EPUB and PDF (drag and drop, several at once). Pull out title,
  author, cover, table of contents; store the file in the bucket.
- The data model for Paths → Pillars → slots → Books, and annotation targets
  (Path | Pillar | Book | Passage), per "The core idea" above.
- The shelf is the showpiece: covers or spines on a shelf, sorting, search,
  collections, reading progress shown on each book. The default view is the
  Path view: pillar columns, N → E → extras order, unowned books dimmed,
  "you are here" per pillar. *(Superseded 2026-10-05 by Samuel: the home
  page is the library, not the Path view; see M14.)*
- Book detail page.
- **Import Samuel's reading list as the first Path** (`docs/reading-lists/hidden-machinery.md`).
  This is the main test data for M3, so the first shelf is Samuel's own,
  not a demo *(Fable)*. Turn the list into a seed file of *wanted* books, holding the details only
  (title, author, pillar, slot: N = narrative, E = engineering/economics,
  "master key" and so on) and no book file. Show them as placeholder covers grouped
  by pillar, in the list's reading order (N before E). When Samuel uploads
  the file, it attaches to the existing entry instead of creating a
  duplicate. Rows the list marks as agent suggestions keep that label
  ("not catalog-checked").

Done when: uploading three public-domain books in Playwright shows them on the
shelf with correct titles and covers; the Hidden Machinery Path shows every
pillar in the reading list with N before E and the master key last; uploading a file whose title matches a wanted
book attaches to it; screenshots attached.

### M4 · Reader and the anchor model

- foliate-js reader: paginated and scroll modes, font, size, line spacing,
  themes, table of contents, progress saved and synced across devices.
- **Section model:** split every book into sections (chapter → section →
  paragraph) with stable ids; store the text of each section in Postgres so
  the AI features can use it. This is the backbone for M5 to M10.
- **Full-text search** across all books and notes (needed by M11's agent
  access) *(Fable)*.

Done when: open a book, change font size, reload: it reopens at the same
spot. Unit tests show that section ids stay the same when the same file is
re-imported. Search finds a phrase in a fixture book. **Real-book check:**
Samuel reads an owned book on the deployed site and says it is good enough
(recorded in the Log) *(Fable)*.

### M5 · Ebook basics

- Highlights (colours), bookmarks, typed notes, a notes panel per book.
- Share a passage (a link for logged-in users; an image card).
- Export: Markdown file, W3C Web Annotation JSON (the standard format, so
  other tools can read it), email (opens the mail app with the text), copy to
  clipboard (works with Apple Notes, Obsidian, etc.).

Done when: Playwright makes a highlight + note, reloads, and finds both;
export produces a Markdown file containing them; export → wipe → import
gives back identical annotations.

### M6 · AI understanding tools (Claude)

- **Rewrite with one click:** pick a paragraph → choose a level ("plain
  English", "for a biologist", "add missing background", "shorter",
  **"STE"**). Every rewrite is kept as a version; flip between them; the
  original is never changed.
- **STE mode** (Samuel's request, 2026-10-03). STE = *Simplified Technical
  English* (ASD-STE100), the aerospace standard for writing that has one
  meaning per word, short sentences and active verbs. Source rules:
  `prompts/ste/` (copied from Samuel's skill; see its README).
  - A strictness dial: **Light**, **Standard (≈80%, the default)**, **Strict**,
    or a percentage (90%+ = Strict, 70–89% = Standard, below 70% = Light,
    as the skill defines).
  - STE is also a **reading preference** for every AI explanation, not only
    rewrites: "What do I need to know?", question-bank answers, image
    captions. Set once in settings; can be changed per book.
  - Keep technical names, numbers and units (the skill's "permitted" list);
    never rewrite into baby English.
  - Port `prompts/ste/ste_check.py` to TypeScript (same results on the same
    inputs, checked by a test). Run it on every STE output and show a small
    badge: "STE 92% (full-STE score)". If the rewrite had to pick between two
    meanings, show the skill's "meaning changes" note under the rewrite.
- **What do I need to know?** At the top of each section: the concepts it
  assumes, each with a two-line explanation and a link to read more.
- **Question bank** per section: recall, understanding and application
  questions, with answers hidden until clicked; mark right or wrong to see
  which sections need a re-read.
- **Cross-book links:** when a passage covers an idea Samuel highlighted in
  another book, show it in the margin.
- Prompts live in `prompts/` as files, so they are easy to edit.

Done when: with the fake Claude, tests prove versions are stored with
provenance and re-served without a second call; one real call per feature,
run by Samuel or in a session with network access, is pasted into the Log.
**Real-book check:** Samuel uses rewrite and prerequisites on an owned book
and records a verdict in the Log.

### M7 · Listen and read (ElevenLabs)

- An **audio track** model that does not depend on one provider: a track is
  either text-to-speech (synthetic voice) or, later, narration Samuel
  uploads, plus word timings. ElevenLabs is the first provider, not the
  table design *(Fable)*.
- Read-aloud per section, natural voice, voice picker, speed control.
- Highlight each word or sentence as it is spoken (ElevenLabs can return the
  timing of each character, which makes this possible).
- Audio made one section at a time when first played, then stored in the
  bucket. A running cost counter on the admin page. ElevenLabs bills per
  character, so: a cost estimate before narrating, and a hard per-book and
  per-month cap (ground rule 8).

Done when: with the fake voice service, the word highlight follows the
timing data; one real section narrated and played on the deployed site.

### M8 · Thinking-out-loud notes

- **Voice notes** on a passage: record in the browser, store the audio,
  turn it into text automatically so it is searchable (use ElevenLabs'
  speech-to-text, so no extra provider key is needed).
- **Stickers** on passages.
- **Handwritten notes** (a drawing layer for stylus or finger) come *last*
  in this milestone, as their own PR: hard to test automatically and less
  used than voice notes *(Fable suggested moving them to Later; kept because
  they are in the vision)*.

Done when: Playwright attaches a voice note (using a test audio file) and a
sticker to a passage, reloads, and both are there. Handwriting: a scripted
stroke is saved and redrawn after reload.

### M9 · See it (images)

- Select a word or phrase (e.g. "wafer") → show Wikipedia / Wikimedia
  Commons images first (with credit and licence shown on the card) → if none
  fit, one click generates an image with OpenAI → pin it to the passage as a
  pop-up card. Generated images are labelled as generated.
- Pinned images show as small markers in the margin.

Done when: searching "silicon wafer" against the fake returns results; a
pinned image survives reload.

### M10 · Reading stats

- Track active reading time (pause when the tab is hidden or idle), pages
  and words read, words per minute by book.
- **Your own trend first** (speed by book, by pillar, N vs E books).
  Comparison with a published adult average is secondary, and only with a
  cited source on the page; never a number without one *(Fable)*.
- Simple, honest suggestions (e.g. "your speed drops sharply in chapter 4;
  try the prerequisites panel"), not generic speed-reading tips.

Done when: a test with a scripted reading session produces the expected
words-per-minute number.

### M11 · Agents can use it

- A token-protected API, plus an **MCP server** (Model Context Protocol, the
  standard way Claude and other AI agents plug into a tool) so an agent can
  list books, search text, read highlights and notes, and add notes.
- Per-user tokens that can be revoked; agents can see only what that user can see.

Done when: a test agent, using a token, lists books and adds a note that
shows up in the reader.

### M12 · Read anywhere (offline)

"Anywhere on the planet, even in space" in practice means *works without a
steady connection*. Make the app a **PWA** (progressive web app: a website
you can install on your phone or laptop that keeps working offline).
Downloaded books, notes and stored audio work offline; new notes sync when a
connection returns.

Keep the scope small *(Fable)*: offline reading and offline note-taking
first; offline audio and AI later.

Done when: in Playwright with the network switched off, a downloaded book
opens and a new highlight is saved, then appears on the server after the
network returns.

### M13 · Read along with your own audiobooks (approved by Samuel 2026-10-04)

Upload an audiobook made anywhere, as a **read-along package** made on the
laptop by the `readalong-audio` skill (format: the skill's
`references/package-format.md`; background in `docs/readalong-plan.md`), and
read along: the word being spoken is highlighted on the page, in EPUB and PDF
books, and pages turn by themselves.

Choices *(Claude, 2026-10-04; Samuel can overrule)*:
- **One audio file, many paragraphs.** A package's audio is per chapter or
  per book, not per paragraph. `audio_tracks` rows keep one row per
  paragraph (so the existing player, cache and export keep working) but may
  point into a shared file with `audio_start_ms`/`audio_end_ms` (migration,
  with a reverse step; backup before it runs in production). Playing on into
  the next paragraph of the same file must not stop or reload the audio.
- **The app matches words to its own paragraphs**, on the server, from the
  package's script words and book map. The laptop never needs the app's
  paragraph splitter.
- **Large audio goes in 8 MB parts** through the app to the bucket's own
  multipart upload (decided in (c1), 2026-10-04, instead of a signed upload
  link straight to the bucket: that would need the bucket to accept browser
  uploads from this site, which Railway's bucket settings were not checked
  for). No request carries more than 8 MB of audio, and the bucket joins the
  parts.
- **Tests never use a real audiobook**: a tiny package is built in test code
  (a tone WAV with known word times), like the fake voice in M7.

Steps (one PR each):
- **(a) Read and check a package** (`lib/readalong/package.ts`): unzip, the
  format name, the book's sha256 matches the stored file, every script word
  present in order, times within each chapter. A TypeScript port of the
  skill's `validate_package.py`, giving the same verdict on the same input.
- **(b) Match words to paragraphs** (EPUB and PDF): per chapter, line up the
  script's words with the book's paragraphs (spelling and punctuation
  ignored, the book map's page and opening words as anchors), giving each
  paragraph `[startMs, endMs, from, to]` timings. Words marked `not_spoken`
  and spoken headings that are not in the book are left out. Report coverage
  (share of each paragraph's words that got a time).
- **(c) Upload and store**: migration for the audio offsets; the audio sent
  in 8 MB parts through the app to the bucket's multipart upload;
  `POST /api/books/:id/readalong` with the rest of
  the package; rows with `source = 'upload'`; importing again replaces the
  old import; only the book's owner. (Done as (c1) storage, (c2) API, (c3)
  the "Your audiobook" section on the book page. Offering "Your audiobook" as
  a voice in Listen moved to (d).)
- **(d) Play it (EPUB)** (detailed plan, checked by skeptic agents:
  `docs/m13-player-plan.md`): Listen prefers the uploaded audiobook when there is
  one; continuous playback across paragraphs; the frame-by-frame highlight
  from the 2026-10-04 fix; `not_spoken` words never highlighted.
  *Built 2026-10-04 (branch `m13-epub-player`; what changed from the plan is
  in `docs/m13-player-plan.md`, "What (d) built"):* "Your audiobook" is the
  first voice in Listen when it begins near the reading position, and plays
  with no ElevenLabs key; one audio element plays straight on, its source set
  only when the file changes; the audio comes from an address checked by the
  sign-in cookie, with no link to expire; a closed byte range is answered
  with at most 8 MB, while an open-ended one ("from here to the end") and a
  whole file are sent in full but read 8 MB at a time;
  the page turns as soon as the last word before it is over; the Listen bar
  is a row below the page, so it never hides the word being read.
- **(e) Play it (PDF)**: today Listen is switched off for PDFs
  (`Reader.tsx`: `disabled={… || props.fileType === "pdf"}`). Draw the
  highlight in the PDF viewer's text layer and turn pages by page number.
  Also in Safari's engine.
  *Built 2026-10-05 (branch `m13-pdf-player-v2`; what changed from the plan
  is in `docs/m13-player-plan.md`, "What (e) built"):* Listen in a PDF book
  plays its uploaded audiobook; each word is found in the page's text layer
  (pdf.js's invisible copy of the page's text over its picture) by counting
  non-space characters from the top of the page (the server sends each
  word's count) and lit there over its printed letters; the page turns as
  soon as its last word is over, and a page turned back from while it is
  read comes back; the text layer is built once per page shown and laid out
  again when the size changes, with the picture; the next page's text is
  fetched ahead; the server reads PDFs with pdf.js's character maps, as the
  reader does (for PDFs added from now on); a part of the paragraph list
  stops at about 8,000 words. Words the matcher misses in Kuhn (before
  footnote numbers, broken across pages) are listed there as a follow-up.
- **(f) Live**: deploy (backup first), import the Frankenstein test package
  and the corrected Kuhn package, Samuel reads along.

Done when: in the browser tests (Chrome and Safari engines) an uploaded
package plays across at least two paragraphs without a pause and the
highlight lands on every word in order, each within 0.1 s, in an EPUB and a
PDF; and Samuel reads Kuhn ch. 1 on the live site and says it keeps time.

### M14 · Home is the library (asked for by Samuel 2026-10-05)

Why: the app opens on the Hidden Machinery Path (`app/(app)/page.tsx`), the
top menu's first item "Path" points there (`app/(app)/layout.tsx`), and
setting up the owner account adds Hidden Machinery without asking
(`app/(public)/actions.ts`, "The owner's first shelf is their own reading
list"). Samuel wants a library first; see "The library comes first" near the
top of this plan.

What Samuel confirmed (2026-10-05):
- **Home** = "Continue" at the top, then the whole library, with Import.
- **Sidebar** (on desktop; the phone layout is designed in step (a)):
  Search, Home; *Library* filters (All, Want to Read, Finished, Books,
  Audiobooks, PDFs); *Paths*; *Collections* with "New collection".
- **Paths** are ordered curricula with greyed-out placeholders that fill in
  when the book is uploaded (this already works: `lib/library/import.ts`
  matches an upload to a wanted book by title). Each Path gets its own page
  (today's Path view moves there).
- **Collections** stay unordered.
- **A mini-player**, on desktop and phone, always with back 15 s,
  play/pause and forward 15 s (Samuel, 2026-10-05), keeps the audiobook playing while you move around the
  app. Today the player lives only in the reader
  (`app/(reader)/books/[id]/read/ListenBar.tsx`) and stops when you leave the
  book; the reader is a separate route group (a folder of pages with its own
  layout), so the audio has to move up into the app's root layout.
- **Not a copy of Apple Books**: Apple's structure, Neolibrary's materials
  and features.

**Samuel's picks (2026-10-05)**, made on the mockups
(https://claude.ai/artifact/Bcvw4gq5SeemEQdDPxYDFg, private to him):
- **Home on desktop: A**: covers in a grid, the sidebar, "Continue", Import
  and the mini-player.
- **Home on a phone: A, with a toggle to a spine view**: covers in a grid
  by default; a Grid / Spines switch shows the books as spines on a shelf,
  each spine filling from the bottom as you read (option B on the mockups).
  The same View switch is on desktop too (Samuel, 2026-10-05: "grid is
  default", with a View button to switch between grid and spines on both
  desktop and phone).
- **Mini-player: B, plus a speed the reader chooses**: the sentence being
  read with the word lit, back 15 s, play/pause, forward 15 s, "Go to the
  page", "Think aloud" (records a voice note, M8, on that sentence), and a
  speed menu. The reader's Listen bar already has a speed setting
  (`ListenBar.tsx`, `playbackRate`).
- **Progress on covers: A**: a bar under the cover fills as you read (what
  the app does today). The marks drawn with it on the mockups come along:
  a folded corner when the book has your notes, headphones when it has
  audio, a tick when finished. No ribbon (Samuel: "the ribbon for
  completion status won't work. use the fill percentage for progress").
- **Continue: B**: the card shows your last note or highlight in that book,
  with "Read from here" and "Listen from here", both starting at the same
  paragraph (the app saves the reading position, `books.position`, and
  read-along maps text to audio time).
- **Not picked yet** (one option each on the mockups): the Path page
  layout, and two optional extras for Home: one question from the question
  bank (M6) of a chapter you got wrong, and threads across books (ideas you
  highlighted in more than one book, `lib/library/crosslinks.ts`). They stay
  out of M14 until Samuel asks.

Confirmed by Samuel on 2026-10-05 (they were Claude's assumptions): you can
make your own Paths, as sections of ordered titles, without a "Read last"
marker for now; Hidden Machinery is no longer added at set-up but offered as
a starter Path; "Want to Read" is automatic (everything not started) and
includes Path placeholders; titles not available yet sit in one closed
group at the end of the grid; the View switch (Grid / Spines) is on desktop
and phone, Grid by default.

Steps (the detailed build plan, with files, tests, mutation checks and the
lessons to apply, is `docs/m14-home-plan.md`; one PR per step):
- **(a) Mockups:** done 2026-10-05; Samuel's picks above.
- **(b1)** Label every title by availability (Read and listen, Read only,
  Listen only, Not available yet) and remove the "owned" wording from the
  app, its code names and its tests.
- **(b2)** The sidebar on desktop, bottom tabs and an account menu on a
  phone; the library page moves to `/library` (`/shelf` redirects).
- **(b3)** Home: "Continue" (B), the whole library as a grid with fill bars
  and marks, Import, the Grid / Spines View switch (desktop and phone); titles not available
  yet in one closed group; Hidden Machinery offered, not added at set-up.
- **(c)** Library filters by kind and status.
- **(d)** Paths: their own pages, making your own Path, adding a book file
  to a title that has none.
- **(e)** The mini-player (B, with speed) across pages, in three PRs: one
  player for the whole app with no visible change; the mini-player outside
  the reader; Think aloud.
- **(f)** Deploy (backup first) and Samuel's verdict.

Done when: in the browser tests, after sign-in Home shows "Continue" with the
last-opened book, its last note and both buttons, and the whole library with
Import; on desktop and phone the Grid / Spines View switch changes the view; the sidebar's filters,
Paths and Collections each open the right view; a placeholder on a Path
becomes a full cover after its book is uploaded; audio started in the reader
keeps playing on Home, where the mini-player shows the sentence being read
and its speed can be changed; screenshots on phone and desktop, light and dark; and
Samuel says it feels like his library, not Apple's.

### Later (not planned in detail yet)

Public sign-up with separate libraries, payments if ever needed, mobile
apps, shared reading groups. (Aligning audiobook narration Samuel owns is now
M13.) Note that Audible audio is DRM-protected and can't be used.

Found in M14's step-5 review, kept out of M14 (rare for one reader): two
uploads to the same waiting title at the same moment (two tabs or devices)
can leave a stored file that no book points at, or a book whose file and
details come from different uploads. The race is older than step 5 (it is
in matching an upload to a title by its name too). The fix is small: a
storage name per upload, write the file to the book only while the title
still has none, and delete the losing upload's files.

Also from that review: about twenty older id checks (notes, reading
positions, the agent API, read-along) still accept any 36 characters of
digits, letters a-f and hyphens, so a forged request with a malformed id
reaches the database and gets an error page instead of "not found". Use the
shared `UUID` check from `lib/library/paths.ts` everywhere. Not reachable
from the app's own pages.

### M17 · Read it rewritten (asked for by Samuel 2026-10-10)

The "AI explanations" style (Plain, STE light, STE, STE strict) rewrites the
book paragraph by paragraph, shown in a panel beside the page (under it on a
phone), with a switch between Original, Side by side and Rewritten. The plan,
Samuel's choices and the steps (R1 server, R2 panel and switch, R3 made as
you read, R4 defaults on the account) with their "Done when": `docs/rewritten-view-plan.md`.

### M18 · The account menu (asked for by Samuel 2026-10-10)

The sidebar's foot shows only your initial, name and an arrow; clicking it
opens a card above it (computer) or a sheet from the bottom (phone) with
Account, Reading stats, Your data, Invite and Sign out. Merged as #142 and
live on 2026-10-11.

### M19 · The site review's top 5 (asked for by Samuel 2026-10-11)

An independent review by Fable 5.1 ranked five improvements: panels beside
the book instead of over it, PDF pages dimmed at night, undo for a removed
note and a way to remove a book, cover titles that do not break, and one
Study button with one set of style names. The steps (P1, P1b, P2, P3a, P4,
P5, P3b), their order, their "Done when" and six decisions with defaults:
`docs/review-top5-plan.md`.

### M20 · The site review's other findings (Samuel: "Keep going", 2026-10-11)

The findings outside the top 5 that need no decision from Samuel, one small
pull request each, smallest and surest first:

- **Q1 · HTTPS only.** The site sends `Strict-Transport-Security`, so a
  browser that has visited once never asks for the plain-http address again.
  Done when: a unit test shows the header on https requests and not on http,
  and the live `/sign-in` sends it after the deploy.
- **Q2 · A note the server refuses is kept.** Today the offline outbox drops
  it with no word. Done when: a browser test makes the server refuse a note
  made offline, and the Notes panel then shows it under "Could not be saved"
  with the server's reason and a way to dismiss it.
- **Q3 · Download for offline works after five minutes.** The reader's file
  link lasts five minutes, and the download reused it. Done when: a browser
  test makes the old link fail, and the download still succeeds.
- **Q4 · Jump to a place.** Contents gets "Go to page" for a PDF and a
  percentage for an EPUB. Done when: a browser test types a page or
  percentage and the reader lands there, with the four screenshots.
- **Q5 · Find in this book.** Contents gets a search box that uses the
  library search for this book only and opens a hit in place. Done when: a
  browser test finds a word and lands on its page.
- **Q6 · Path dots are links.** Each dot under a Path's title jumps to its
  pillar. Done when: a browser test clicks a dot and the pillar is in view.
- **Q7 · The margins follow a change of theme** (found while building Q2
  to Q5). With the theme on Auto, a device turning dark left a light frame
  around the dark page until a reload. Done when: a browser test fails
  without the fix and passes with it.
- **Q8 · A large book opens on a slow connection.** The reader gave up 30 s
  after it began opening, download included, so a large PDF on a phone
  could be called broken while still arriving. Now it waits while pieces
  keep coming, gives up after 30 s with nothing, and says "12 of 80 MB
  downloaded". Done when: unit tests show a slow but steady download
  succeeding and a stopped one giving up, and a browser test on a slowed
  connection sees the progress line and the book open.

Left for Samuel (Open unknowns): the view remembered per book (it changes
his 2026-10-10 call that the view is one account setting), "Want to Read"
without the titles not available yet, the phone reader's top bar, and a
password reset he issues. The PDF page-turn pause (row 15) was decided
2026-10-12: make the next page while this one plays (M23).

### M22 · Covers for every title (asked for by Samuel 2026-10-11)

Samuel: "how can I automatically get book covers, starting with the titles in
Hidden Machinery … go build it and test it on all the books." Most titles on
a Path have no file yet, so no cover; nor do most PDFs. Reading apps get
covers from the store (the publisher's feed), from the file, or from public
catalogues by ISBN or title and author. Here: the catalogues, by title and
author, for any title without a cover.

- **C1 · The cover finder** (no change on screen yet). Open Library first
  (free, no key; an English edition's cover before the work's own), then
  Google Books when `GOOGLE_BOOKS_API_KEY` is set. A match needs the title
  (with or without its subtitle) and the author's last name; a bundle of
  several books never matches. The picture must be a JPEG, PNG or WebP of a
  cover's size and shape; it is downloaded once, stored in the bucket, and
  the book records where it came from (migration 0025). A cover inside the
  book's file always wins; a file without one keeps the found cover. The
  server looks covers up by itself 20 s after it starts and every 6 hours,
  one title a second; a title the catalogues lack is asked again after 30
  days. The library export carries it all. Done when: unit tests on real
  catalogue answers pass, and a run on a copy of the live library finds
  covers for most titles with every match checked by eye.
- **C2 · Covers on screen.** A title not available yet shows its found
  cover greyed (it takes its colours with its file); a Covers page lists the
  found covers with "Not this cover" (the next match takes its place) and
  "Find covers now". Done when: a browser test finds, turns down and
  replaces a cover with the fake catalogue, with screenshots on a phone and
  a computer, light and dark.

- **C3a · Choose a cover by hand** (Samuel: "Keep going", 2026-10-11; after
  Google Books left 2 titles without one: *Lift Off* is "Liftoff" in the
  catalogues, *Payments Systems in the U.S.* is listed under its writers).
  On Covers, "Choose another" beside "Not this cover", and "Choose a cover"
  on each title without one, open a search of both catalogues by the words
  the reader types (title and surname to start), with no title or author
  check: the reader judges by eye. The previews come back inside the answer
  (the site shows no pictures from other sites), and the browser sends back
  only a short code for the chosen result, from which the server rebuilds
  the catalogue's address. The picture turned down for it is never offered
  again. Done when: unit tests on real catalogue answers for "Liftoff
  Berger" pass, codes that are not a catalogue's are refused, and a browser
  test gives Oil 101 (none in the fake catalogue) a cover and replaces
  another, with the dialog in four looks.
- **C3b · Upload a picture as a cover** (migration 0026 adds 'upload' to
  `cover_source`, with its reverse; the export carries it). In the same
  dialog, "Or use your own picture": a JPEG, PNG or WebP of at most 3 MB,
  checked by its bytes on the server, in place of a found cover (never
  offered again) or as a title's first; never over a book file's cover.
  Done when: the migration goes up and back down with an uploaded cover
  kept showing, unit tests refuse another reader's book, a file's cover and
  bytes that are not a cover-shaped picture, the export carries it, and a
  browser test refuses a text file called .png, then uploads a picture.

Later: a PDF's first page as its cover.

### M23 · The next PDF page while this one plays (Samuel, 2026-10-12)

A PDF page read by the made voice used to go silent for about half a minute
at each page turn, while the next page was made (measured 32 s and 38 s on
*The Grid*). The player now makes the next paragraph as soon as this one
starts to play. One ahead. The cost counts toward the $1 "Keep reading?"
question. An EPUB and an uploaded audiobook are unchanged. The rules and
the "Done when" are Part B of `docs/pdf-narration-plan.md`.

### M25 · Scanned books become flowing books (Samuel, 2026-10-15)

A scanned PDF can also be read as a flowing book (an EPUB "text edition"
beside the scan): Claude Sonnet 5.5 reads each page picture through the
Batch API (about $3 for a 388-page book, inside the $5 per-book limit),
every page is checked against the scan's own hidden text, and the reader
offers Scan | Text. Plan, steps S1 to S8 and their "Done when":
`docs/scan-to-text-plan.md`.

### M26 · Reading for understanding (Samuel picked these three, 2026-10-16)

Written for Samuel and for the session that builds it. Not started: Samuel
says when, and which step first (Claude's suggestion: R1). These came from
a list of ideas Samuel liked; he chose the top three.

**One rule for all three: the reader writes first, Claude responds
second.** If Claude summarises before you have thought, reading gets
easier and you learn less. So no step here shows Claude's view of a passage
until the reader has put down their own.

- **R1 · Explain it back.** *Built 2026-10-16 (branch `m26-r1-explain-back`):
  the fourth Study tab; a "part" is an EPUB chapter, or one PDF page for now.*
  At the end of a section (an EPUB chapter, or a
  PDF page range), the reader says or types about three sentences on what
  it argued. Speaking uses the voice notes' speech-to-text (M8). Claude then
  compares the summary with the text and quotes the lines the summary
  missed or got wrong, each with a link to its place in the book. Why:
  putting an idea in your own words fixes it in memory far better than
  rereading a summary. The summary is saved as a note on the section (it is
  the reader's, so ground rule 9 applies); Claude's answer is AI output
  with provenance (rule 5), paid once, under the caps (rule 8), with a fake
  in tests (rule 3).
  Done when: with the fake Claude, a browser test writes a summary at the
  end of a chapter of a public-domain book, gets back quoted lines that
  each open the right place, reloads, and both the summary and the answer
  are still there; Claude's answer cannot be seen before a summary exists.
  Samuel tries it on one chapter of a real book and records a verdict.
- **R2 · Links across your own books, by meaning.** Cross-book links exist
  since M6 (`lib/library/crosslinks.ts`, in the reader's links panel), but
  they match on shared word stems, so Kuhn on "paradigms" and a Feyerabend
  note on "anything goes" never meet. This step makes them match by idea,
  and shows them in the margin beside the passage, not only in a panel.
  How to match by meaning, and what it may cost per page, is the first
  question to settle (a cheap first filter, then Claude to judge a few
  candidates, is one way); Samuel decides if it costs money per page.
  Done when: a test library with two books, where a highlight in one shares
  an idea but no key words with a page of the other, shows the link in the
  margin; the word-stem matches still show; a link opens the other book at
  the highlight. Samuel checks it on his own Kuhn and Feyerabend notes.
- **R3 · A focus session with a question.** *Built 2026-10-18 (branch
  `m26-r3-focus-session`): the clock button in the reader's top bar;
  migration 0028 adds the question to a sitting.*
  Before starting, the reader
  writes the question they are reading to answer, and sets a timer (50
  minutes by default). Everything but the page is hidden (M21's Focus is
  the starting point). When the time is up, the app asks "Did you
  answer it?" and saves the answer as a note. That note becomes a Daily
  review card (M21), and the session is one of the reading-stats sittings
  (M10), with its question.
  Done when: a browser test starts a session with a question and a short
  timer, sees only the page while it runs, answers at the end, and then
  finds the answer as a note, as a card in Daily review, and as a sitting
  with the question on the Reading stats page; the session survives a
  reload part-way through. Screenshots: phone and desktop, light and dark.
- **R4 · A focus session you cannot walk away from** (Samuel, 2026-10-18).
  *R4a built and live 2026-10-18 (#203); R4b built 2026-10-19 (branch
  `m26-r4b-ways-out`, no migration).* The running session moves to the server, so every page on every device
  sends you back to the focused book; End now becomes a 10-minute wait or a
  written answer of 40 words; Reading stats shows how each session ended.
  Two pull requests (R4a, R4b), one database migration. Steps, defaults and
  "Done when": `docs/focus-lock-plan.md`.
- **R5 · Whole-book focus** (Samuel, 2026-10-18). One book for days or
  until its last page: the shelf, search and Daily review show only it, and
  its end asks the book's question. Built on R4. Steps and "Done when":
  `docs/focus-lock-plan.md`.

### M27 · Reader requests (Samuel, 2026-10-19)

Written for Samuel and for the session that builds it.

- **Q1 · The selected-text bar gets out of the way.** The bar that opens
  when you select text (highlight, note, copy) closes when you tap or click
  anywhere outside it, or press Escape, as × does; not while a note, voice
  note, drawing or sticker choice is open in it, so nothing half-made is
  lost. Pressing Listen closes it too: it sat on top of the Read aloud bar
  (Samuel's screenshots, 2026-10-19). Done when: a browser test closes the
  bar by a click on the page, by a click outside the book, by Escape and by
  Listen, and a half-written note survives a click outside.
- **Q2 · Pick up where you left off elsewhere** (like Kindle's
  Whispersync). Coming back to an open book (switching back to the tab or
  window), if your place was moved by another device or by listening away
  from this page, a strip offers "Go there". This tab's own saves never
  trigger it. No migration: it compares the saved place with the places
  this tab saved itself, so it cannot yet say which device moved it.
  Done when: a browser test moves the saved place behind the reader's back,
  brings the window back to the front, sees the offer, and Go there opens
  that place; no offer appears after the tab's own page turns.

### M28 · Review what you read, not only what you highlighted (Samuel, 2026-10-19)

Written for Samuel and for the session that builds it.

**Why.** Daily review (M21) brings back only your highlights and notes, and
shows you the highlight itself. So a reader who highlights little gets one
card ("1 of 1", Samuel's screenshot, 2026-10-19), and looking at your own
highlight is rereading. Highlighting and rereading are the two study
methods the best-known review of the research rates lowest; recalling from
memory ("retrieval practice") and spreading it over days ("spacing") are
the two it rates highest (Dunlosky et al., 2013). Recalling a text from
memory beat both rereading and concept maps a week later (Roediger &
Karpicke, 2006; Karpicke & Blunt, 2011).

**The idea: connect what already exists.** The app already has the parts,
but they don't feed each other:

| Part of a review loop | Already in the app | What M28 adds |
|---|---|---|
| Questions about each chapter | Test yourself (M6): recall, understanding and application questions per chapter, answers hidden, marked right or wrong | S1: the questions become Daily review cards |
| Recall at the end of a chapter | Explain it back (M26 R1): you write what the chapter argued; Claude quotes what you missed | S2: each thing you missed becomes a question card |
| A schedule that spaces reviews | Daily review (M21): Again / Hard / Good / Easy, SM-2 | uses it as it is |
| Recall when you come back to a book | nothing | S3: "Where were we?" |
| A purpose before reading | Focus session with a question (M26 R3); Need to know (M6) explains, but asks nothing | Later: prequestions |
| Links across books | word-stem links (M6); links by meaning planned (M26 R2) | Later: rides on R2 |

The rule from M26 still holds: **the reader answers first, Claude second.**
No card shows Claude's answer before the reader has tried. Steps S1 and S2
add no new paid calls (S2 adds one short field to an answer Claude already
writes); S3 reuses Explain it back's call.

- **S1 · Test yourself questions become review cards.** Every question in
  the newest question bank of a chapter (one per chapter: a newer bank, made
  fresh or in another style, replaces the older one's cards) is a card. The
  front is the question; Show gives the bank's answer and a link to the
  chapter. A question card first comes due **the day after its bank was
  made**, never the same day: reviewing a question minutes after answering
  it is rereading again, and the gain from recall comes after a delay. New
  cards of every kind share the 20-a-day limit. Right or wrong marks in Test
  yourself are not read by the schedule yet (Later). Highlights and notes
  stay cards as before. Database: `review_cards` gets a text `card_id` (an
  annotation's id for highlights and notes, so existing schedules are
  kept; `q:<bank id>:<question number>` for a question), with a reverse
  step; backup before it runs in production. The library export carries
  `cardId`, and an export made before M28 still imports.
  Done when: with the fake Claude, a test makes a question bank for a
  chapter of a public-domain book; that day Review does not show its
  questions; the next day (test clock) it does, one card per question,
  with the question on the front and the answer only after Show; rating
  one sets its next date; a fresh bank replaces the old bank's cards;
  existing highlight cards keep their schedules through the migration and
  its reverse; export → wipe → import keeps question schedules, and an old
  export without `cardId` imports. Screenshots of a question card: phone
  and desktop, light and dark. *Built 2026-10-19 (branch
  `m28-s1-question-cards`, migration 0030). The day's wait is checked in
  the unit tests with a test clock; the browser tests' server sets
  `REVIEW_QUESTION_DELAY_DAYS=0`, as its clock cannot be moved.*
- **S2 · What Explain it back found missing becomes a question.** Claude's
  answer to Explain it back gets one more field per item: a question whose
  answer is the point you missed ("What does the author say makes card
  payments two-sided?"), not a sentence that gives it away. Each item of a
  chapter's newest attempt is a card: the question on the front; Show gives
  the book's own line (quoted only when found word for word, as today) and
  a link to it. Older attempts, made before the field existed, give no
  cards. The day-after rule of S1 applies. Note: one Explain it back can
  give up to six cards (your summary note, which is already a card, and up
  to five gaps).
  Done when: with the fake Claude, a test writes a summary, gets back items
  with questions, sees no card that day and one card per item the next
  day, front and back as above; an attempt stored without questions gives
  no cards and still shows in Study as before. *Built 2026-10-19 (branch
  `m28-s2-gap-cards`, no migration: a gap card is named
  `g:<attempt id>:<item number>`, which 0030's check already allows). The
  item number is the item's place in Claude's answer, so a dropped item
  does not move the others' schedules. A question that copies the book's
  line is dropped (it would give the answer away). After a library import,
  gap cards come back once the books' paragraphs are rebuilt (at server
  start), as Study's items do.*
- **S3 · "Where were we?" when you come back to a book.** Opening a book
  you last read on an earlier day shows, above the page, a short box: "Last
  time you read *<chapter>*. What do you remember?" Write (or say) a few
  sentences and it goes to Explain it back for that chapter, so its gaps
  become cards (S2); or press Skip, or just start reading. It shows at
  most once a day per book, never in a focus session, and never for a
  chapter you have already explained back.
  Done when: a browser test reads a chapter, moves the clock to the next
  day, reopens the book, sees the box, answers it, and finds the answer as
  an Explain it back attempt on that chapter; Skip hides it for the day;
  reopening the same day shows nothing. Screenshots: phone and desktop,
  light and dark.
  *Built 2026-10-19 (branch `m28-s3-where-were-we`, no migration). Details
  settled while building: "the chapter" is the one at your saved place;
  "an earlier day" means your latest sitting of a minute or more began on
  an earlier day (UTC), since every opening of a book records a sitting,
  even a glance; a chapter counts as explained back once it has an
  Explain it back answer or the summary note it keeps when Claude cannot
  answer; it is not asked when the book is opened at a place of its own (a
  search result, a review card). The strip sits over the book's column,
  one line until you choose to write.*

**Real-book check for M28 (Samuel, on *The Pay Off*).** A nonfiction book
with chapters (its text edition, M25), so the research above applies to it
directly. Pick two chapters of about the same length that you have not
read yet.
1. Chapter A, with the loop: read it, do Explain it back, open Test
   yourself. Review its cards when Daily review offers them (days 1, 3 and
   7 or so).
2. Chapter B, without it: read it, nothing else.
3. Day 7 after reading B: answer, from memory, a fresh Test yourself bank
   for each chapter (Claude writes it then; you have not seen it). Count
   your right answers.
4. Record both scores and your verdict in the Log. It is one reader and
   two chapters (n = 1): a sign, not proof.
Needs `ANTHROPIC_API_KEY` on Railway `web`: on 2026-10-19 it is not there
(checked by name), so Test yourself and Explain it back cannot run on the
live site yet. Until it is, S1 to S3 are built and tested with the fake
Claude, and the check waits under "Waiting on Samuel".

**Later** (from the same research; not planned in detail):
- Answer first: type or say your answer before Show, and Claude checks it
  against the book and suggests a rating (one cheap call per answer, under
  the caps).
- Book milestones: at a quarter, half, three quarters and the end, four
  questions about the whole book, from Adler's *How to Read a Book* (what is
  it about as a whole; its main arguments; are they true; so what), answered
  in your words and coming back at a week, a month, six months.
- FSRS (the Free Spaced Repetition Scheduler, Anki's default since 2025)
  instead of SM-2: it learns your own forgetting and needs fewer reviews for
  the same memory.
- Test yourself marks as the first rating of a question card.
- Prequestions: two or three of a chapter's questions before you read it
  (helps with the asked content, not the rest: St. Hilaire et al., 2024).
- Within a session, a missed card comes back until you get it (today Again
  puts it at the end of the day's cards once).
- Cross-book questions ("How does this compare with what *Y* said?"), on top
  of M26 R2's links by meaning.
- Novels: questions about plot, characters and your own reactions; the
  research above is almost all on nonfiction.

### M29 · Markdown books, and Chip War rewritten (Samuel, 2026-10-20)

Written for Samuel and for the session that builds it.

- **K1 · A Markdown (.md) file can be added like an EPUB or a PDF.** On the
  Import page, on "Add the book file" for a waiting title, and through the
  agent API (`POST /api/agent/books`, multipart field `file`, optional
  `attachTo`, with the reader's token). At import the file becomes an EPUB
  (`lib/library/markdown-epub.ts`), so from then on it is an ordinary EPUB:
  chapters, Contents, Listen, Study, rewrites, notes. Every `#` or `##`
  heading starts a chapter (a part heading alone is the part's title page);
  text before the first heading is "Opening pages"; Contents nests chapters
  under their part. Title and author come from front matter (`title:`,
  `author:`), else the title from the file name and no author. Nothing in
  the file is passed through as HTML. *Built 2026-10-20 (branch
  `m29-markdown-books`).*
  Done when: unit tests turn an invented Markdown book into an EPUB the app
  reads (title, author, nested Contents, one chapter per heading, escaped
  text) and import it, attached to a waiting title or not; a browser test
  adds one on the Import page, finds its chapters in the reader, adds a
  second with an agent token, and removes both.
- **K2 · Chip War, from Samuel's Markdown (`chip_war.md`, made from his
  PDF), in the library and rewritten paragraph by paragraph in all four
  styles** (Plain, STE light, STE standard, STE strict) with `claude -p` on
  his subscription, by the recipe of The Pay Off and Meditations
  (`docs/handoffs/2026-10-17-1938-rewrites-done-live.md`). Book text stays
  out of git. Checked locally before upload: 67 chapters (opening pages,
  praise, cast, glossary, introduction, 8 parts, 54 chapters), 841
  paragraphs, 95,339 words in paragraphs (the reading index counts 95,753
  with headings).
  Done when: the live book has those chapters, and every paragraph has a
  rewrite in each style, read back from the live database and matched to
  its file.

### M30 · Add books from Google Drive (Samuel, 2026-10-20)

Written for Samuel and for the session that builds it.

- **G1 · A Google Drive link adds its books.** On the Import page, under
  the drop zone: paste a link to a book file, or to a folder of books,
  shared as "Anyone with the link"; "Add from Drive" adds each EPUB, PDF
  or Markdown file in it (not its subfolders, at most 25 at a time), as
  if uploaded, so a title waiting for its file gets it. Other files are
  listed as skipped. No Google account, key or sign-in: the server reads
  Google's public folder view and public download address
  (`lib/drive/drive.ts`), and takes only the id from the pasted link, so
  it never fetches an address the reader gave. A file not shared says
  how to share it. A fake Drive (`lib/drive/fake.ts`, `DRIVE_FAKE=1`) is
  used in every test. *Built 2026-10-20 (branch `m30-google-drive`).*
  Done when: unit tests read file and folder links, refuse other hosts,
  list a folder view's files (not subfolders), download a shared file and
  explain one not shared or too large, and add a folder's books
  (attaching to a waiting title, skipping other files); a browser test
  adds a fake folder's two books on the Import page and sees the skipped
  file and the "not shared" message. Real-book check: Samuel's shared
  folder "LibraryBooks" (Kuhn, *The Structure of Scientific Revolutions*).
- **Later:** private files (not shared by link) would need Google sign-in
  (OAuth, a Google Cloud project: Samuel's to set up).

### M31 · Flowing text from a PDF's own text (Samuel, 2026-10-20)

Written for Samuel and for the session that builds it.

- **P1 · A PDF that has text in it (not a scan) can be laid out again as a
  flowing text edition, with no AI.** Why: Kuhn's *Structure of Scientific
  Revolutions* (added from Drive, M30) could not be read with `claude -p`:
  Anthropic's service blocked nearly every page ("Output blocked by
  content filtering policy", 34 of the first 41 pages), as copying a
  published book. Its PDF already holds its text, so nothing needs
  copying. `lib/library/pdf-text-pages.ts` reads each page's text with
  pdf.js (positions, sizes and real font names) and writes the Markdown
  a scan's page reading gives: running heads and page numbers dropped
  (words in the top or bottom band that recur on 3+ pages), chapter
  headings (a heavier font at the top of a page, followed by prose), section
  headings, paragraphs (indented lines after a sentence's end), italics,
  footnotes (the run of smaller lines at the foot, or a line opening with a
  raised number) with their references, and line-end hyphens mended unless
  the book writes the word with a hyphen elsewhere. The pages go through the
  same chapter builder and EPUB as a scan's (lib/library/text-epub.ts),
  whose "About this edition" says no AI read or wrote it. The book page
  shows "Flowing text from this PDF" (owner only) for such PDFs, needing no
  AI key. *Built 2026-10-20 (branch `m31-pdf-text-edition`).*
  Done when: unit tests on an invented, book-like PDF (running heads, page
  numbers, a bold chapter heading, indented paragraphs, italics, a footnote
  and its reference, broken words) get exactly the expected Markdown; a
  scan is told apart and refused; the edition is linked to its PDF, made
  again under the same id, and its About page says no AI; a browser test
  makes one from the book page and opens it with Scan | Text. Real-book
  check on Kuhn: the contents list matches the printed contents page.
  Known limit: a word broken at a line end that the book never writes
  whole elsewhere is joined ("mid-" "century" became "midcentury").

### M32 · X-ray: who and what is in a book (Samuel, 2026-10-22)

Written for Samuel and for the session that builds it. Not started: Samuel
says when. X-ray is Kindle's name for the panel behind a book: the people,
places and terms in it, each with a description and a bar showing where it
comes up. The ideas, ranked, are in `docs/xray-ideas.md`; the live prototype
Samuel chose from is linked there, with its source in
`docs/design/prototypes/xray/`.

Samuel's picks on the prototype (2026-10-22, "Let's go for this 'C A A A'"):
- C · on the page: a dotted underline on the first mention in each paragraph,
  and an "On this page" strip above the text;
- A · the card: three layers in order (from this book up to here, a quote
  for every fact; from your library; from the world, labelled as AI);
- A · the Who & what list: by how often, with each entry's trail of chapters;
- A · position: a card knows only what the reader has read, with a "Show
  everything" switch; entries not yet met are not listed.

First slice (a working assumption, since the prototype is tier 1 of the
ideas doc): the index itself, the marks and strip, the position-aware card.
Names and their trails come first from the text alone, at no cost (option C
in the doc); the facts from a chapter-by-chapter pass by Claude behind a
"Build the X-ray" button that shows the estimate first. Every fact must
carry a quote found word for word in the stored text, or it is dropped and
counted; facts are stored per chapter, which is what makes "only up to here"
possible. Tiers 2 to 4 wait. The four remaining choices (the name in the
app, the argument X-ray, when to pay, the "from the world" layer) are Open
unknowns row 27, with defaults.

Done when: a browser test opens a public-domain book with the fake Claude,
sees the Who & what tab with entries sorted by how often they appear, taps a
dotted name on the page and gets a card whose facts each open the right
place; a fact from a later chapter is absent until the reader moves there
and present after; the index exports and imports identically; the quote
check drops a planted fact with no quote. Screenshots: phone and desktop,
light and dark. Then Samuel builds the X-ray for *Chip War* on the live site,
checks twenty entries by eye, and records a verdict.

The steps, one pull request each (Samuel: "build the M32", 2026-10-22):

- **X1 · The index from the text alone.** Two tables (`xray_entries`,
  `xray_mentions`, migration 0031): the names the book writes with capitals,
  grouped when they are one name written differently, with every mention as
  offsets into the stored paragraph text. Built at import and on first open
  for older books; entries exported, mentions rebuilt. The Who & what tab:
  names by mentions so far, a trail of chapters, "met in", a search box,
  "Show everything"; a name opened lists where it appears, each chapter a
  link. Unit tests on the Jekyll fixture (the six people lead; every
  mention's slice of the text is an alias; nothing from the publisher's
  pages), the export round trip, and the browser test above's list and
  "met later" sentences. Names only, no AI.
- **X2 · On the page.** A dotted underline on the first mention in each
  paragraph, drawn on foliate's overlay (its own underline drawer, unused
  until now), and the "On this page" strip from the visible range; a tap
  opens the card over the page (a sheet on a phone), with each quote a link
  to its place. No AI, no migration.
- **X3 · Facts from Claude, with the quote check.** `prompts/xray.md`, one
  call per chapter with the entries known so far (so a new name joins an
  old entry), behind a "Build the X-ray" button that shows the estimate and
  a confirm box; a fact whose quote is not found word for word in the
  stored text is dropped and counted; facts stored per chapter
  (`xray_facts`, with provenance), shared like rewrites. The fake Claude
  must always return one planted fact with an invented quote, so the
  dropped count can be asserted from the browser (the fake is one shared
  model in browser tests and cannot be told otherwise).
- **X4 · From your library, from the world.** The same name in the
  reader's other books, with links; Claude's general knowledge on a card,
  labelled and always last. Then Samuel's check on *Chip War*.
- **X5 · Read on the subscription.** The same reading done on the laptop
  with `claude -p` (Samuel's subscription, no API key, no API spending):
  `scripts/xray-on-subscription.ts` and the `xray-on-subscription` skill.
  The site hands out the exact request for the next unread chapter and
  stores the answer as read through the subscription, at $0 to the app's
  limits, after the same quote check. Built in #228.
- **X6 · A praise page is not a chapter.** The endorsements page at the
  front of *Chip War* ("More Praise for…") was read as a chapter and gave
  20 facts about the book's reviewers. The X-ray now skips a praise page as
  it skips the publisher's other pages, and whatever was stored for one
  stays out of the list and the marks.
- **X7 · Alias hygiene.** Claude's aliases on *Chip War* also held quoted
  forms (“chip,”), possessives, descriptions ("TSMC’s chairman", "the island
  of Taiwan"), demonyms ("Japanese") and other entries' names ("Japan" under
  Tokyo): "integrated circuit" counted 832 times, mostly "chip", and Japan
  merged into Tokyo. Rules on the server (`lib/library/xray-aliases.ts`)
  keep an alias only when it is a way of writing the name, on every answer
  and, for a book read before the rules, through `tidy` (the agent route and
  the script); a join by a shared alias needs the same kind. One line in
  the prompt: a different person sharing a surname is a different entry.

Built and live (2026-10-23): X1 to X4 and X1b (the name finder checked on
three real books) in d1632ebd with migrations 0031 and 0032; X5 in 4fcc2154.
The first subscription reading, *Chip War*, is recorded in the ledger.
Samuel's twenty-entry check by eye is still to come.

### M33 · Get help (Samuel, 2026-10-23)

Written for Samuel. A page under the account menu (after Your data) that
explains how to do the important things in the library in plain English:
one card per part (your books, reading, notes, listening, the Study tools,
Who & what, remembering, paths, your data and agents), and a card for the
owner's own tasks that only the owner sees. Samuel's words: "time to have a
`Get Help` under the name settings that spells out how to conduct the
important functionalities on the web app". Built and live in 924f98ff (#229).

## How a cloud session works on this repo

The steps are in `CLAUDE.md`, which every session loads automatically. In short:
read `PROGRESS.md`, take the first unfinished step, work on a branch, prove
it with tests and screenshots, open a PR, merge it once every check is green,
write the Log entry, stop.

**What green checks do and don't prove** *(Fable)*: they prove the agent's
tests pass on the agent's code, nothing more. Extra guardrails for self-merge:
database *migrations* (scripts that change the database layout) must include
a reverse step, and a database backup is taken before each runs in
production; real API keys exist only on the deployed site; spending alerts
are set at each provider. Whether some PRs (logins, migrations, spending,
`CLAUDE.md`, design tokens) still need Samuel's approval is an open
question in `PROGRESS.md`.
