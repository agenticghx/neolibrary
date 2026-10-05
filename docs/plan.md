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
  books you do not own yet: they show as greyed-out placeholders and become
  fully visible when you upload them. A Path is one group in the sidebar,
  not the home page. Notes can still attach to a Path or a Pillar.
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

Assumed by Claude, not yet confirmed by Samuel: you can make your own Paths
(today Hidden Machinery is the only one, added from a built-in list); Hidden
Machinery is no longer added at set-up but offered as a starter Path; Path
placeholders also appear under "Want to Read"; the spine view is on the
phone only (Samuel asked for it there).

Steps:
- **(a) Mockups:** done 2026-10-05; Samuel's picks above.
- **(b)** Home on desktop and phone: the sidebar (desktop) and tabs (phone:
  Home, Library, Paths, Search); "Continue" (B); the whole library as a grid
  with fill bars and the marks; Import; the phone's Grid / Spines toggle
  (remembered on that device); Hidden Machinery offered, not added at
  set-up.
- **(c)** Library filters by kind and status.
- **(d)** Paths: their own pages, and making your own Path.
- **(e)** The mini-player (B, with speed) across pages.
- **(f)** Deploy (backup first).

Done when: in the browser tests, after sign-in Home shows "Continue" with the
last-opened book, its last note and both buttons, and the whole library with
Import; on a phone the Grid / Spines toggle switches the view; the sidebar's filters,
Paths and Collections each open the right view; a placeholder on a Path
becomes a full cover after its book is uploaded; audio started in the reader
keeps playing on Home, where the mini-player shows the sentence being read
and its speed can be changed; screenshots on phone and desktop, light and dark; and
Samuel says it feels like his library, not Apple's.

### Later (not planned in detail yet)

Public sign-up with separate libraries, payments if ever needed, mobile
apps, shared reading groups. (Aligning audiobook narration Samuel owns is now
M13.) Note that Audible audio is DRM-protected and can't be used.

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
