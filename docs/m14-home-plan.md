# M14 · Home is the library: the build plan

Written for: the Claude session that builds M14 starting from a fresh context.
That session has not seen the conversation where Samuel chose this design.
Also written for Samuel, who will review the pull requests. Plain English;
jargon is defined the first time it appears (and in §3).

Status: final plan, 2026-10-05. Samuel's choices are recorded in
`docs/plan.md` (section "The library comes first" near the top, and M14) and
in `PROGRESS.md` (Decisions, 2026-10-05). If this file and those disagree,
Samuel's recorded words win; fix this file.

---

## 0. Start here

1. Read `PROGRESS.md` (header, "Exact next steps", the 2026-10-05 Log
   entries), then this file from top to bottom, then `docs/plan.md` M14.
2. **Create `LEARNING_LOG.md` at the repo root before changing any code**,
   in the format in §7, and write Iteration 1 (the baseline run, step 3
   below). Keep it up to date through the whole session (rules in §7).
3. Baseline: on a fresh branch from `origin/main`, run `npm run check` and
   `npx playwright test --ignore-snapshots` (on the Mac; reference
   screenshots are Linux images, see §8). Paste both summary lines into
   Iteration 1. Do not start a step on a red baseline.
4. Work the steps in §5 in order. **One step = one branch = one pull
   request.** Branch names start with `m14-` so the auto-merge Action takes
   them (it only merges branches starting with `m` or `claude/`).
5. For every step, follow the loop in §9 (implement, verify, review, merge),
   and write a `PROGRESS.md` Log entry (the CI hygiene check fails a PR
   without one).
6. Anything only Samuel can decide goes to `PROGRESS.md` "Open unknowns" with
   a decide-by date. Use the default given in §4 and keep going. Never stop
   and wait.

---

## 1. What Samuel asked for (his words where it matters)

- **Neolibrary is a library**: "a digital library that holds books,
  audiobooks, annotations, many learning materials … not a hidden machinery
  library." After sign-in, Home is the library.
- **Home** = "Continue" at the top, then the whole library, with Import.
- **Apple Books is the model for structure, not looks.** Samuel: "there's a
  lot we can learn from apple books but we are customizing our experiences";
  "we have to think how to innovate the ux/ui so its not just copy cat." The
  look stays Neolibrary's (`docs/design.md`: warm paper, cloth covers, serif).
- **His picks** (2026-10-05, on the mockups):
  - Home on desktop: **A**, covers in a grid.
  - Home on a phone: **A**, a grid, "with a feature to toggle spine view".
  - Mini-player: **B**, "but i include the play speed users can choose".
  - Progress on covers: **A**, "a bar under the cover fills".
  - Continue card: **B**, "also shows your last note, with 'Read from here'
    and 'Listen from here'".
- **Every mini-player has back 15 s, play/pause and forward 15 s.** The first
  mockup's phone player lacked the skip buttons, and Samuel was angry
  ("wtf is this?").
- **No ribbon** for progress: "the ribbon for completion status won't work.
  use the fill percentage for progress."
- **Never say "owned" or "not owned"**: "stop with book you own and do not
  own bs! a book i upload is book i own! uploaded books titles can still
  appear they are just unavailable to read or listen or both!" Label each
  title by what is available (§4, D1).
- **Paths are curricula** (ordered reading plans, like Hidden Machinery);
  titles with nothing to read or listen to yet show greyed out and take
  their colour when a file is added. **Collections** are unordered groups.
- **When you show Samuel a design choice, show 2–3 real options per part**,
  not one design per part ("you made 1 prototype per segment and asked me to
  pick 1?").

## 2. The mockups to build from

Design canvas (a claude.ai artifact, private to Samuel; a laptop session can
read it with the Artifact tool, `action: "read"`):
https://claude.ai/artifact/Bcvw4gq5SeemEQdDPxYDFg

**Build from the "Your picks" row** (top of the canvas): `PicksHome`
(desktop Home), `PicksPhone` (phone Home in grid and spine view) and
`PicksPlayer` (mini-player B with the speed menu open). The option rows below
it are history. In words, for when the canvas is not reachable:

- **Desktop Home**: a left sidebar (Neolibrary mark; a search box; Home;
  LIBRARY: All, Want to Read, Finished, Books, Audiobooks, PDFs; PATHS: each
  Path with "3 of 18" pillars started, then "+ New path"; COLLECTIONS: each
  collection, then "+ New collection"; at the foot the reader's name and the
  links Reading stats, Your data, Invite (admins only), Sign out). Main
  column: h1 "Home" with an **Import** button; "Continue" (up to two cards);
  "Your library" with a count and a Sort menu; a dashed drop zone ("Drop
  your DRM-free books (EPUB, PDF) … anywhere on this page", button "Choose
  files"); a grid of covers, each with title, author, availability label,
  and a progress bar that fills.
- **Continue card (B)**: cover; title; chapter and percentage with a fill
  bar; a box "Your last note here" (italic serif: the reader's own words) or
  "Your last highlight here" (the quote on the highlight colour); buttons
  **Read from here** and **Listen from here**.
- **Cover marks**: folded top-right corner = the book has your notes;
  headphones = it has an audiobook; amber tick = finished. A title with
  nothing available is a greyed (undyed cloth) cover.
- **Phone Home**: h1 "Home" with a round Import button; Continue (one card,
  B); "Your library" with a **Grid / Spines** switch (two buttons,
  `aria-pressed`); grid of 3 columns, or spines standing on shelves (each
  spine fills from the bottom as you read). Bottom tabs: Home, Library,
  Paths, Search. The mini-player sits above the tabs.
- **Mini-player (B, with speed)**: the sentence being read, with the current
  word lit; under it the book and "Ch. V · 18 min left"; controls: speed
  (e.g. "1.25×", opens a menu of 0.75×, 1.0×, 1.25×, 1.5×, 1.75×, 2.0×),
  back 15 s, play/pause, forward 15 s, "Go to the page", "Think aloud"
  (records a voice note on the sentence being read). On a phone: sentence,
  book line, then one row of speed, back, play/pause, forward, Think aloud.

## 3. Words used

- **Route**: a page address, e.g. `/library`. **Route group**: a folder in
  `app/` in brackets, e.g. `app/(app)` or `app/(reader)`, that shares a
  layout but does not change the address.
- **Root layout**: `app/layout.tsx`, the one layout every page sits in. A
  part placed there stays alive while the reader moves between pages with
  links (Next.js's own docs: a full page load happens only between different
  root layouts).
- **Server component / client component**: Next.js parts that run on the
  server (can read the database) or in the browser (can hold state, play
  audio). Client files start with `"use client"`.
- **CFI**: an EPUB position string (`epubcfi(...)`); the app stores reading
  positions and annotation anchors as CFIs.
- **Read-along package / "Your audiobook"**: an audiobook Samuel made
  elsewhere, uploaded with its word timings (M13). **TTS**: text-to-speech,
  narration made by ElevenLabs on demand, per paragraph, paid.
- **Availability**: whether a title has a book file to read, an audiobook to
  listen to, both, or neither (§4, D1).
- **Unit tests**: Vitest, fast, one function at a time. **Browser tests**:
  Playwright driving the real app in Chromium (Chrome's engine) and WebKit
  (Safari's engine). **CI**: GitHub's run of all checks on each PR.
- **Reference screenshot**: an approved image in `e2e/__screenshots__`; the
  visual test fails when a page changes by more than 0.2% of its pixels.
- **Mutation check**: break a fix on purpose, confirm a named test fails,
  put the fix back. It proves the test guards the fix.
- **Flake**: a test that fails sometimes for reasons outside the code.
- **Draft PR**: a pull request marked "draft"; the auto-merge Action skips
  drafts, so a draft holds the merge while you verify.
- **Skeptic**: a second reviewer agent whose only job is to try to refute
  one finding of the first reviewer.

## 4. Decisions this plan makes (defaults; Samuel can overrule each in a line)

Record each in `PROGRESS.md` Decisions as "by Claude (default)" the first
time the code depends on it, and list D1, D3, D5 and D10 in Open unknowns
(row 4) with decide-by 2026-10-19.

- **D1 · Availability.** *Read* = the title has a book file
  (`books.fileKey` is not null). *Listen* = it has a ready uploaded
  audiobook (a `readalong_imports` row with `status = "ready"`). Labels:
  **Read and listen**, **Read only**, **Listen only**, **Not available
  yet**. ElevenLabs narration does not count as "Listen" (it is paid, made
  on demand, EPUB only, and needs a key); the reader still offers it.
- **D2 · "Listen only" has no source yet.** Today an audiobook can only be
  added to a title that has a book file (the read-along importer matches
  spoken words to the book's paragraphs). The label logic must support
  Listen only, but uploading audio to a title without a book file is **not
  in M14**; add it to `docs/plan.md` "Later" as a candidate for M15.
- **D3 · Titles not available yet in the library.** Hidden Machinery alone
  adds more than 100 such titles, so they must not flood the grid. Home and
  Library "All" show available titles in the grid, then one closed group
  **"Not available yet (N)"** (a `<details>` element) listing the rest as
  greyed covers. They also show on their Paths and under "Want to Read".
- **D4 · Routes.** `/` Home; `/library` the library page with filters
  (`?show=all|want|finished|books|audiobooks|pdfs`, plus the existing
  `sort`, `q`, `c` for collection); `/shelf` redirects to `/library`
  keeping its query; `/paths` the list of Paths; `/paths/[slug]` one Path.
  The reader's back arrow and the book page's back link go to `/`, labelled
  "Back to your library" and "Library".
- **D5 · Library filters.** All = everything. Want to Read = not started
  (`progress = 0` and never opened), including titles not available yet.
  Finished = `progress >= 1`. Books = has an EPUB file. PDFs = has a PDF
  file. Audiobooks = has a ready uploaded audiobook.
- **D6 · Set-up no longer adds Hidden Machinery.** The empty Home offers
  "Add three free classics" (existing samples) and "Start from a reading
  list: Hidden Machinery" (the existing `addPathAction`). `/paths` offers the
  same reading list.
- **D7 · Continue.** Up to two books on desktop and one on a phone: books
  opened before (`lastOpenedAt` set), not finished, newest first. The box
  shows the newest note, voice note (its transcript) or highlight in that
  book, by `updatedAt`; nothing if there is none. Read from here opens the
  reader at the saved position. Listen from here: in step 3 it opens the
  reader with Listen started (`/books/[id]/read?listen=1`); from step 6 on
  it starts the mini-player inside the click and stays on Home.
- **D8 · Spine view** is on the phone only (Samuel asked for it there),
  remembered on the device (`localStorage` key `nl.libraryView`), default
  Grid.
- **D9 · Phone navigation.** Bottom tabs: Home, Library, Paths, Search.
  Collections are the chips on the Library tab. Reading stats, Your data,
  Invite and Sign out sit in an account menu behind a round initial button
  at the top right of Home.
- **D10 · Your own Paths (step 5).** A Path has a name, an optional
  description, and sections (stored as pillars). Each section holds titles
  in order (stored as slots). Each title is a library book, or a new
  title-only entry (title and author). A title may be marked "Story first"
  (N) or "Go deeper" (E); otherwise it is a plain entry (`extra`). Reorder
  with "Move up" / "Move down" buttons (no drag-only controls).
- **D11 · One player for the whole app (step 6).** One audio element lives
  in the root layout. The reader, when open, lends the player its page
  turning and word lighting. Outside the reader the mini-player shows the
  sentence from text the server now sends. Speed is remembered on the device
  (`nl.playerSpeed`). Signing out stops and clears the player.
- **D12 · No database migration is expected in M14.** Custom Paths fit the
  existing `paths` / `pillars` / `slots` tables. If one turns out to be
  needed: a reverse (`.down.sql`) step, `npm run test:postgres`, and a backup
  before it runs in production.

## 5. The steps (one PR each)

Each step lists: goal, changes, tests, screenshots, "Done when", the
mutation checks to run, and gotchas. Line numbers are from `main` at
d5888d0 (2026-10-05); re-find them before editing.

### Step 1 · `m14-b1-availability`: label by availability; remove "owned"

**Goal.** Every title says Read and listen / Read only / Listen only / Not
available yet. No "owned" wording is left in the app, its tests or its code
names.

**Changes.**
- New `lib/library/availability.ts`: `type Availability = { read: boolean;
  listen: boolean }`, `availabilityLabel(a)`, and
  `listenableBookIds(db, ownerId, bookIds): Promise<Set<string>>` (one query
  on `readalong_imports` with `status = "ready"`; today the only helper,
  `readyImport` in `lib/library/audio.ts:280`, is per book and not
  exported). **Every place that draws a Cover or a label must compute
  `listen` with it**: `getPathView` and `getBook` in `lib/library/paths.ts`,
  the shelf grid (`app/(app)/shelf/page.tsx`), the book page and the
  `/design` sample. Today they all derive `owned` from `fileKey` alone; if
  one is missed, its headphones mark never shows and its label always says
  "Read only".
- `components/Cover.tsx`: replace the `owned` prop with `available`
  (`Availability`); the greyed style when neither; the link label says
  "(not available yet)"; the caption shows the availability label. Rename
  CSS `.unowned` and the tokens `--cover-unowned` / `--cover-unowned-ink` to
  `--cover-empty` / `--cover-empty-ink` in all five blocks of
  `app/tokens.css` (light, dark, paper, sepia, night) and in
  `lib/tokens.test.ts:32`.
- `lib/library/paths.ts`: `owned` becomes `available` in `SlotView` (l.69),
  `PathView` counts become `available` / `notYet` (l.93, 181-191), `getBook`
  returns `available` (l.209); fix the header comment (l.8-9).
- `components/PathView.tsx`: "· not owned" (l.117) becomes "· not available
  yet"; the subtitle (l.146) becomes "{available} available, {notYet} not
  available yet"; the `<a href>` at l.115 becomes `<Link>` (a plain `<a>`
  reloads the page, which will kill audio in step 6).
- `app/(app)/shelf/page.tsx:49` "Books you own" becomes "Your library";
  the empty lede (l.52) loses "ones on your path light up there too".
- `app/(app)/books/[id]/page.tsx`: the availability label next to the
  status; l.152 "Not on your shelf yet…" becomes "Not available yet. Add the
  book file (EPUB or PDF) and it attaches here."
- `app/(app)/shelf/Dropzone.tsx:10` "Attached to the wanted book in your
  path" becomes "Added to a title that was waiting for it".
- `app/(app)/design/page.tsx:88` and `app/(app)/page.tsx:44-45`: the new prop.
- `app/(reader)/books/[id]/read/page.tsx:24`: `found.available.read`.

**Tests.**
- Update: `e2e/pages.ts:12` (`book-wanted` → `book-not-available`, link
  "The Grid (not available yet)"), `e2e/paths.spec.ts:30, 33, 41, 51`,
  `e2e/reader.spec.ts:133` (heading "Your library"), `e2e/uploads.spec.ts:
  60-66` (attach message; `/1 available/`), `lib/library/paths.test.ts:
  38-39`, `lib/tokens.test.ts:32`.
- New unit tests: `availabilityLabel` for all four cases;
  `listenableBookIds` (a ready import counts, an "uploading" one does not,
  another owner's never does).
- New check: `grep -rniE "not owned|books you own|unowned|\\bowned\\b"
  app components lib e2e` prints nothing except the unrelated locals
  `ownedBook` / `ownedImport` in `lib/readalong/importer.ts` and the owner
  checks in `annotations.ts` / `voice-notes.ts` (list them in the PR).

**Screenshots.** Reference images change for `book-not-available`,
`shelf-empty`, `design` and `path` (§8 explains how to refresh them).

**Done when.** The grep above is clean; the Path view and a title-only
book page say "not available yet"; unit and browser suites green.

**Mutation checks.** Make `listenableBookIds` ignore `status`: the
"uploading" test fails. Make Cover show the image for a title-only book: a
test fails (add one that checks the greyed cover has no image).

### Step 2 · `m14-b2-shell`: sidebar on desktop, tabs on a phone

**Goal.** Replace the top bar (`app/(app)/layout.tsx:17-27`) with the
sidebar (desktop, at least 48rem wide) and bottom tabs plus an account menu
(phone), as in `PicksHome` / `PicksPhone`.

**Changes.**
- `app/(app)/layout.tsx` + `layout.module.css`: sidebar (search form posting
  to `/search`; Home; Library links to `/library?show=…`; Paths from
  `listPaths` with "N of M" pillars started; "+ New path" to
  `/paths/new`; Collections from `listCollections` showing the name only, no
  count (see the test gotcha); "+ New collection"; foot: name, Reading
  stats, Your data, Invite for admins, the Sign out form). Phone: tabs and
  the account menu (a `<details>` or a button with `aria-expanded`).
- `/library`: move the shelf page to `app/(app)/library/page.tsx` (keep the
  current content for now; filters come in step 4); `app/(app)/shelf/
  page.tsx` becomes a `redirect` to `/library` with the same query.
- **Every `/shelf` reference, not just links**: run
  `grep -rn '"/shelf\|`/shelf' app lib components e2e` and update each hit.
  On 2026-10-05 that was `app/(app)/actions.ts:49-50` (`revalidatePath` and
  the redirect to `/shelf?c=` after making a collection), `:60-61`, `:69`,
  `:117` (a stale `revalidatePath("/shelf")` leaves `/library` showing old
  data), `layout.tsx:19`, `shelf/page.tsx:42`, `Reader.tsx:789`, and 22
  `page.goto("/shelf")` lines in the browser tests (those keep working
  through the redirect, but move them to `/library` so the tests say what
  they mean).
- **Paths pages exist from this step**, because the sidebar links to them:
  `app/(app)/paths/page.tsx` (a plain list of your Paths, plus the Hidden
  Machinery reading list offer) and `app/(app)/paths/[slug]/page.tsx`
  (renders today's `PathView` unchanged; step 5 redesigns it). Until step 5,
  "+ New path" points to `/paths`.
- **No duplicate accessible names.** The sidebar adds a search box and
  collection links to every page. Label the sidebar search "Search your
  library" with no button of its own named "Search" (submit with Enter, or
  a button named "Search the library"), because `e2e/reader.spec.ts:159`
  clicks the `/search` page's button by the unscoped name "Search".
  Collection links show the name only (see Tests).
- Reader back arrow (`Reader.tsx:789`, "Back to your shelf", `/shelf`) →
  "Back to your library", `/`. Book page back link (`books/[id]/page.tsx:
  38-42`, "Path", `/`) → "Library", `/`. Search note results without a book
  (`search/page.tsx:65`) link to the Path (`/paths/<slug>`) or `/`.
- Content must never sit under the phone tabs: give the shell bottom padding
  equal to the tab bar height (a token).

**Tests.**
- Update: `e2e/pages.ts:13` `shelf-empty` → `library` at `/library`;
  `e2e/reader.spec.ts:96-133` (destination and heading),
  `e2e/flows.spec.ts:93-94` (Sign out now in the sidebar or account menu),
  `e2e/uploads.spec.ts:127, 141, 147` (scope collection links to the
  Library page's chips: `getByRole("navigation", { name: "Collections" })`
  on the page, because the sidebar now lists collections too),
  `e2e/agents.spec.ts:35` (`/shelf` → `/library`, still 307 for a bad
  token), and any test that clicks a top-bar link (none click Path, Shelf,
  Search or Invite today; only "Sign out").
- New browser test: on desktop the sidebar has every link listed above and
  each opens its page; on a phone the tabs do; the account menu opens and
  holds Sign out; no sideways scroll at 390 px; axe clean; light and dark.

**Screenshots.** Every signed-in reference image changes (the shell is on
every page). Refresh all of them in this PR, look at each one, and list in
the PR which ones changed and why.

**Done when.** Sidebar and tabs match the mockup; all links work; old
`/shelf` links land on `/library`; suites green.

**Mutation checks.** Remove the tab bar's bottom padding: the new
"nothing under the tabs" test fails (measure the last grid item's bottom
edge against the tab bar's top). Point a sidebar link to the wrong route:
the link test fails.

**Gotchas.** `lib/glyphs.test.ts` rejects characters outside the bundled
fonts (use "+" not a special plus sign; no arrows like U+2192). Contrast:
dark-mode accent text on raised panels is 4.42:1, under 4.5; links on raised
panels use ink with an accent underline (`docs/handoff.md` §5).

### Step 3 · `m14-b3-home`: Home = Continue + the whole library + Import

**Goal.** Home matches `PicksHome` (desktop) and `PicksPhone` (phone),
including the Grid / Spines switch, and set-up no longer adds Hidden
Machinery.

**Changes.**
- New `lib/library/home.ts`:
  - `continueBooks(db, ownerId, limit)`: books with `lastOpenedAt` set,
    `progress < 1`, file present, newest first.
  - `latestNotes(db, ownerId, bookIds)`: for each book, the newest live
    annotation of kind note, voice or highlight by `updatedAt` (latest
    version per `annotationId`, skip `deleted`; same rules as
    `listAnnotations` in `lib/library/annotations.ts:338-351`, which sorts
    by reading order, not time, so it cannot be reused as is).
  - `notYetAvailable(db, ownerId)`: title-only books (no file, no ready
    audiobook). Keep `listShelf` as it is (its unit test
    `lib/library/shelf.test.ts:44` "lists only books with a file" stays
    true).
- A shared server component `components/LibraryGrid.tsx` (covers with
  marks, availability label, progress bar; the closed "Not available yet
  (N)" group) used by Home and `/library`.
- `app/(app)/page.tsx`: h1 "Home", Import button (opens the file picker; the
  existing `Dropzone` upload logic moves to a shared client component so the
  whole page accepts drops), Continue cards (B), Your library (count, Sort),
  the grid. Empty library: lede "Good to see you, {first name}. Your library
  is empty.", buttons "Add three free classics" and "Start from a reading
  list" (the Hidden Machinery card from today's empty Home).
- Phone: the Grid / Spines switch (client component, `aria-pressed`, stored
  in `localStorage` `nl.libraryView`, reading it inside `try/catch`); the
  spine view (spine width from page count, fill from progress, title
  vertical, "New" / "Done" / percentage at the foot; a greyed spine for not
  available).
- Continue's Listen from here: `/books/[id]/read?listen=1`; the reader opens
  Listen when that flag is present (and only for a book with something to
  listen to).
- `app/(public)/actions.ts:56-57`: remove the seed and its comment.

**Tests.**
- `e2e/auth.setup.ts:19`: after creating the owner, expect the h1 "Home";
  then add Hidden Machinery through the new empty-Home offer **only if
  `/paths/hidden-machinery` is missing** (the reused local server branch,
  l.14-18, signs in to an account that already has it). Every later test
  that needs the Path keeps working: `paths.spec.ts`, `uploads.spec.ts:
  53-67, 157`, `annotations.spec.ts:178-203`, `stats.spec.ts:72-98`.
- `e2e/flows.spec.ts:83-87, 105`: the invited reader sees the empty Home
  ("Good to see you, Ada"), adds the reading list, lands on
  `/paths/hidden-machinery` (the page exists from step 2; `addPathAction`
  must redirect there, see gotchas).
- `e2e/pages.ts`: `path` → `/paths/hidden-machinery`; new `home` → `/`;
  new `paths` → `/paths`.
- New `e2e/home.spec.ts` in a new Playwright project `home` placed after
  `stats` (chain: stats → home → agents). By then Jekyll has a saved
  position, highlights and notes (reader and annotations projects). Assert:
  Continue shows Jekyll, its newest note text, both buttons; Read from here
  opens the reader at the saved CFI; Listen from here opens the reader with
  the Read aloud bar present; the grid shows availability labels; the "Not
  available yet (N)" group holds Hidden Machinery titles; on a phone the
  switch toggles grid and spines and is remembered after a reload; axe
  clean and no sideways scroll; screenshots `home-full-<look>.png` with the
  2x2 loop used in `stats.spec.ts:104-116`.
- Unit tests for `continueBooks`, `latestNotes` (newest wins; a deleted
  note is skipped; a later version of an older note counts by its
  `updatedAt`), `notYetAvailable`.

**Screenshots.** `home` (early, nearly empty library) in the looks
projects; `home-full` from `home.spec.ts` with data.

**Done when.** After sign-in Home shows Continue with the last-opened book,
its last note and both buttons, and the whole library with Import; on a
phone the switch works; set-up adds no Path; suites green.

**Mutation checks.** Return the oldest note instead of the newest: the
`latestNotes` test fails. Drop the `progress < 1` filter: a finished book
appears in Continue and a test fails (make sure one does). Forget to
restore the saved view from `localStorage`: the reload test fails.

**Gotchas.**
- The visual and a11y projects run right after `setup` with almost no
  data, so a Home screenshot with Continue must come from `home.spec.ts`.
- The Path view leaves `/` in this step (Home replaces it); its new address
  `/paths/[slug]` already exists from step 2.
- `addPathAction` (`app/(app)/actions.ts:36-41`) only revalidates `/`. It
  must now revalidate `/`, `/paths` and the new Path, and `redirect` to
  `/paths/hidden-machinery`; `flows.spec.ts` and `auth.setup.ts` expect to
  land there.
- `?listen=1` cannot start audio by itself in Safari (`play()` must run
  inside a click; M13 learned this). The reader opens with the Read aloud
  bar ready and the reader presses Play. The home test asserts the bar is
  present, not that time advances. Step 6b removes the detour.
- Remove `isNotNull(books.fileKey)` nowhere; title-only books get their own
  query (D3).

### Step 4 · `m14-c-filters`: Library filters

**Goal.** `/library?show=…` filters by D5; the sidebar links select them;
Collections still filter (`c`), and sort and search still work.

**Changes.** Extend `listShelf` options with `show` (keep the default
behaviour identical); "Want to Read" also lists title-only books (via
`notYetAvailable`). Page h1 follows the filter ("All", "Want to Read", …)
with a count. Phone: the Library tab shows the filters as chips above the
collections.

**Tests.** Unit: each filter on a fixture library (an EPUB, a PDF, one with
a ready audiobook, one finished, one unopened, one title-only). Browser:
each sidebar link shows the expected titles; counts match.

**Done when.** Every filter shows exactly its titles; suites green.

**Mutation checks.** Make Audiobooks count TTS tracks: the unit test with a
TTS-only book fails. Make Finished use `> 0.99` wrongly or `>= 0.9`: the
boundary test fails.

### Step 5 · `m14-d-paths`: Paths pages and your own Paths

**Goal.** `/paths` lists Paths and offers the Hidden Machinery reading list;
`/paths/[slug]` shows one Path with availability labels; you can make and
edit your own Path (D10) and add a book file to a title-only entry.

**Changes.**
- `/paths` page; `/paths/new` and `/paths/[slug]/edit` forms (server
  actions in `app/(app)/actions.ts`; data functions in
  `lib/library/paths.ts`: `createPath`, `addSection`, `addTitle` (existing
  book or new title-only row), `moveTitle`, `removeTitle`, `renamePath`).
- Title-only entries offer "Add the book file": an explicit attach
  (`POST /api/books` with an `attachTo` field naming the title's id;
  `importBook` in `lib/library/import.ts:20-73` today attaches only when the
  titles match).
- Path notes (`TargetNotes`, `addTargetNoteAction`) keep working on the
  new page.
- "+ New path" in the sidebar goes to `/paths/new`.

**Tests.**
- Update: `e2e/paths.spec.ts` (all on `/paths/hidden-machinery`),
  `e2e/annotations.spec.ts:178-203` (pillar and path notes on the Path page,
  scope `header` to the page), `e2e/stats.spec.ts:72-98` if the pillar
  names' places move.
- New: make a Path with two sections and three titles (one title-only),
  reorder with Move up / Move down, the order sticks after reload; add the
  book file to the title-only entry and its label becomes Read only; the
  explicit attach refuses another owner's title (unit test).

**Done when.** Samuel can make "Philosophy of science" with Kuhn and two
not-yet-available titles, in order; suites green.

**Mutation checks.** Skip the owner check in `addTitle` or the attach: the
"another owner" unit test fails. Break `moveTitle` at the first position:
the reorder test fails.

### Step 6 · the mini-player (three PRs)

Read this whole step before starting 6a. Facts from the code (2026-10-05):

- Only `app/layout.tsx` is a root layout; a client component there survives
  link navigation between `(app)` and `(reader)`.
- `ListenBar.tsx` (in `app/(reader)/books/[id]/read/`) owns the audio element
  and stops by unmounting. Its portable parts: the audio element and its
  events, the voice/audiobook choice, tracks and timings, `follow` /
  `afterEnded` / `fileStart` (`lib/readalong/player.ts`), `wordAt`
  (`lib/speech/timings.ts`), speed, errors. Its reader-bound parts (in
  `Reader.tsx`): page turns (`showPassage`), word lighting (`highlightWord`,
  CSS highlights in the book frames), the word CFI, saving the position.
- **No paragraph text reaches the browser.** The lit word's text comes from
  the page (`range.toString()`, Reader.tsx:733). `ListenInfo.passage`
  carries only `characters`; `ReadingParagraph` carries no text
  (`paragraphsOf`, audio.ts:340-393, never selects `sections.text`).
- `onWord` returning null (word not on the page yet) holds progress until
  the page shows it; outside the reader nothing would ever show it.
- Tests assume one audio element (`document.querySelector("audio")`, not
  scoped) and the region `[aria-label="Read aloud"]` with `data-word` and
  `data-passage` (`e2e/listen.ts`); audiobook mode must load each file once
  (`loadstart` count) with no `pause`/`emptied`; TTS reloads per paragraph
  by design.
- Speed: `SPEEDS = [0.75, 1, 1.25, 1.5, 2]`, a `<select>` labelled "Speed",
  reset to 1 each time (ListenBar.tsx:13, 58, 494-513). No skip buttons, no
  Media Session.
- The saved position only moves on the reader's `relocate`, and
  `savePosition` needs a fraction 0..1 (`lib/library/reading.ts:14-30`).
- Two links reload the whole page: `PathView.tsx:115` (fixed in step 1) and
  `CrossLinksPanel.tsx:22`.
- Voice notes need a selection today (`saveVoiceNote`, Reader.tsx:608-623);
  the route `POST /api/books/[id]/voice-notes` needs only a CFI and a quote;
  `VoiceRecorder.tsx` does not pause playing audio.

#### 6a · `m14-e1-player-core`: one player for the app, no visible change

**Goal.** Move playback into a `PlayerProvider` in `app/layout.tsx`
(rendered only for a signed-in reader), with the reader as a client of it.
The reader looks and behaves exactly as today: every existing player test
passes unchanged.

**Changes.**
- `lib/player/` (pure, unit-tested): the state machine now inside ListenBar
  (sources, follow, ended, errors, speed, skip). `components/player/
  PlayerProvider.tsx` owns the single `<audio>` and exposes `start`, `pause`,
  `resume`, `stop` (pause, clear `src`, reset state: what unmounting did
  before), `seekBy(ms)`, `setSpeed`, and `attachPage({ onWord, onPassage })`
  which the reader calls on mount and releases on unmount.
- `ListenBar.tsx` becomes the reader's view of the provider's state (same
  region label and data attributes, same layout as a grid row below the
  book).
- Keep exactly one `<audio>` for the player in the DOM; NotesPanel's own
  `<audio>` is separate and already exists.
- Convert `CrossLinksPanel.tsx:22` to `<Link>`.
- Sign-out stops the player (the provider listens for the signed-out state).

**Tests.** All of `e2e/audio.spec.ts`, `readalong.spec.ts` (Chromium and
WebKit), `safari.spec.ts`, `notes.spec.ts` pass unchanged. Unit tests for
`lib/player/` cover what ListenBar did (port the logic, then test it).
New browser test: start Listen in the reader, click the back arrow to Home,
the audio element is the same node and `currentTime` keeps rising (the
mini-player UI comes in 6b; here just prove it survives).

**Done when.** Unchanged behaviour in the reader, playback survives leaving
the reader, suites green in both engines on CI.

**Mutation checks.** Make the provider set `src` again on navigation: the
"same node, time keeps rising" test fails, and the `loadstart` counts in
`readalong.spec.ts` fail. Make `stop` only pause: `audio.spec.ts:132-134`
(bar gone, highlight cleared) fails.

#### 6b · `m14-e2-mini-player`: the mini-player outside the reader

**Goal.** Outside the reader, a mini-player (B with speed) shows whenever
something is playing or paused: the sentence with the word lit, book and
time left, speed menu, back 15 s, play/pause, forward 15 s, Go to the page.

**Changes.**
- Server: send paragraph text with timings. Audiobook mode: add `text` to
  `ReadingParagraph` (select `sections.text` in `paragraphsOf`; watch the
  part size limit `READING_WORDS = 8000`). TTS mode: add `text` and a
  `prevId` to `ListenInfo.passage`. New pure `sentenceAt(text, offset)`
  returning the sentence and its start/end offsets (`splitSentences` in
  `lib/ai/ste.ts:225` has no offsets).
- Outside the reader the provider computes the word from timings + text
  (no page needed), so progress no longer waits for `onWord`.
- Back 15 s / forward 15 s: within the current file; across a file
  boundary use `follow` / `afterEnded`; back past the first loaded
  paragraph asks the server for the earlier part. In TTS mode, back past a
  clip's start goes to the previous paragraph (`prevId`); forward past the
  end goes on as playing would (paid only if not stored; caps apply).
- Speed: the menu (0.75, 1, 1.25, 1.5, 1.75, 2), stored in
  `localStorage` `nl.playerSpeed`, applied after every `src` change
  (`defaultPlaybackRate` and `playbackRate`). Update `audio.spec.ts:130-131`
  to the new control if the `<select>` is replaced.
- Position while listening outside the reader: save the current paragraph's
  CFI as the reading position as playback moves on (a new
  `savePosition` mode that takes a CFI and computes the fraction from the
  paragraph's place in the book, server side).
- Go to the page: navigate to `/books/[id]/read?at=<paragraph CFI>`; if the
  reader is already open, call its `goTo` (the open-book effect ignores a new
  `?at` when the view exists, Reader.tsx:266).
- Layout: on desktop a bar at the foot of the main column; on a phone above
  the tabs; the page gets bottom padding equal to the bar so nothing hides
  under it. Hidden inside the reader (the reader shows its own bar).
- Continue's Listen from here now starts the player inside the click (Safari
  requires `play()` in the click) and stays on Home.

**Tests.** New `e2e/miniplayer.spec.ts` (Chromium and WebKit): start Listen
in the reader, go Home; the mini-player shows the sentence and the lit word
changes in order; back 15 s moves time back by 15 s (within 0.5 s) and the
lit word moves back; forward 15 s likewise; speed 1.5 sets `playbackRate`
1.5 and survives a reload and a new file; Go to the page opens the reader at
the right paragraph with the word lit; Listen from here on Home starts audio
without leaving Home; nothing sits under the bar (measure); axe clean; 2x2
screenshots. Unit tests: `sentenceAt` (abbreviations like "Dr.", quotes,
the last sentence without a full stop), skip at file boundaries, speed
persistence.

**Done when.** The mini-player matches `PicksPlayer` with every control
working; the saved position follows the audio; suites green on CI in both
engines.

**Mutation checks.** Skip without clamping at 0: the "back 15 s at the
start" test fails. Forget to re-apply speed after a new `src`: the
new-file speed test fails. Compute the word from the page instead of the
timings: the Home test (no page) fails.

#### 6c · `m14-e3-think-aloud`: Think aloud on the sentence being read

**Goal.** "Think aloud" records a voice note anchored to the sentence being
read, from the reader or the mini-player.

**Changes.** Move `VoiceRecorder.tsx` (and its styles) to `components/` so
both can use it; pause the audio while recording and offer to resume after
saving; save with `cfi` = the current paragraph's CFI (the reader may pass a
sentence-precise CFI from `v.getCFI`), `quote.exact` = the sentence text,
`durationMs`, through the existing route. Check what `sectionForCfi`
assigns for a PDF page CFI (the code suggests the page's last paragraph;
prove it with a test before relying on it).

**Tests.** Browser (fake microphone, as `notes.spec.ts` does): Think aloud
from the mini-player on Home saves a voice note whose quote is the sentence
and which opens at that place in the reader; audio was paused during the
recording. Unit: the save path without a selection.

**Done when.** A voice note made while walking (mini-player, no reader open)
lands on the right sentence; suites green.

**Mutation checks.** Anchor to the book start instead of the paragraph: the
"opens at that place" test fails. Do not pause while recording: the paused
check fails.

### Step 7 · `m14-f-deploy`: deploy and Samuel's verdict

- Back up first (recipe: `PROGRESS.md` 2026-10-04 11:40 entry: `pg_dump`
  inside the Postgres container through `ssh.railway.com`, restore-check
  into a local Postgres). M13's migration 0020 is still waiting to run in
  production; it runs at this deploy if M13 (f) has not happened.
- `railway up --service web --ci`, then check `/api/health` and `/sign-in`.
- Open a GitHub issue "M14 verdict" for Samuel with screenshots (phone and
  desktop, light and dark) and the questions in §10 that are still open.
- On the live site, set up nothing for Samuel's account: his existing Hidden
  Machinery Path stays (the change in D6 affects new set-ups only).

## 6. Test impact map (what breaks, and in which step it is updated)

| Test (file:line) | Depends on | Step |
|---|---|---|
| `e2e/auth.setup.ts:19` | h1 "Hidden Machinery" after set-up | 3 |
| `e2e/pages.ts:11` `path` | Path view at `/` | 3 |
| `e2e/pages.ts:13` `shelf-empty` | `/shelf`, "Books you own" | 1 (wording), 2 (route) |
| `e2e/pages.ts:12` `book-wanted` | link "The Grid (not owned)" on `/` | 1, 3 |
| `e2e/flows.spec.ts:23` | "Hidden Machinery" absent when signed out | 3 (keep: still absent) |
| `e2e/flows.spec.ts:83-87, 105` | empty Home greeting, "Add this path", h1 on `/` | 3 |
| `e2e/flows.spec.ts:93-94` | "Sign out" in the top bar | 2 |
| `e2e/paths.spec.ts:10-53` | Path view on `/`, "(not owned)", "Not owned" | 1, 3, 5 |
| `e2e/uploads.spec.ts:60-66` | attach message, `/1 owned/` on `/` | 1, 3 |
| `e2e/uploads.spec.ts:105` | CSS class `itemTitle` on the shelf | 3 (keep the class or update) |
| `e2e/uploads.spec.ts:127, 141, 147` | page-wide collection links "Gothic N" | 2 |
| `e2e/uploads.spec.ts:157, 175` | `paths[0].slug`, guest lands on `/` | 3 (holds if set-up adds the Path) |
| `e2e/reader.spec.ts:96-133` | back to `/shelf`, h1 "Books you own" | 1, 2 |
| `e2e/annotations.spec.ts:178-203` | pillar/path notes on `/` | 3, 5 |
| `e2e/stats.spec.ts:72-98` | Hidden Machinery pillar stats | holds if set-up adds the Path |
| `e2e/agents.spec.ts:35` | `/shelf` gives 307 with a bad token | 2 |
| `e2e/reader.spec.ts:159` | unscoped button "Search" on `/search` | 2 (sidebar must not add another) |
| 22 `page.goto("/shelf")` lines (`reader`, `uploads`, `readalong`, `annotations`, `flows` specs) | the shelf route | 2 (work through the redirect; move to `/library`) |
| `e2e/audio.spec.ts:130-134` | Speed `<select>`; Stop removes the bar | 6a, 6b |
| `e2e/readalong.spec.ts` (all player tests) | one audio element, `loadstart` counts, bar below the book | 6a |
| `lib/library/shelf.test.ts:44` | only books with a file | stays true (D3) |
| `lib/library/paths.test.ts:38-39` | `view.owned`, `view.wanted` | 1 |
| `lib/tokens.test.ts:32` | `cover-unowned` tokens | 1 |
| visual references (all signed-in pages) | the top bar | 2 |

## 7. `LEARNING_LOG.md`: the format

Create it at the repo root in the first session, commit it with each PR, and
keep it until M14 is deployed. Its job: an honest record of what was tried,
what the signal said, and what changed next, so the next session (and
Samuel) can see the reasoning, not just the result. It complements
`PROGRESS.md` (what was done and what is next) and does not replace it.

Start the file with this header, then add iterations at the bottom:

```markdown
# Learning log: M14 (Home is the library)

Written for Samuel and for the next Claude session. One iteration per
attempt judged by a signal: a test run, a CI run, a review, a measurement,
a look at a screenshot, or Samuel's verdict. Plain English; numbers are
quoted from the tool output named, with the commit they ran on.

Outcomes: **success** (the hypothesis held), **failure** (it did not),
**partial**, **flake** (failure not caused by the change; evidence given),
**dead end** (abandoned; why).

## Index

| # | When (UTC) | Step | Hypothesis or goal | Signal | Outcome | Lesson (short) |
|---|---|---|---|---|---|---|

## Lessons so far

Rules learned in this milestone, each with the iterations that taught it
and how to apply it. A lesson seen twice moves to the top.

## Iterations
```

Each iteration:

```markdown
### Iteration 17 · 2026-10-06 14:20 · Step 6a · failure

**Hypothesis.** Moving the audio element to the root layout keeps
`loadstart` at one per file.
**Action.** Moved `<audio>` into `PlayerProvider`; ListenBar reads its
state (commit 1a2b3c4; files: components/player/PlayerProvider.tsx,
app/(reader)/books/[id]/read/ListenBar.tsx).
**Evaluation.** `npx playwright test e2e/readalong.spec.ts --project
readalong` on 1a2b3c4.
**Result.** `1 failed`: "plays straight on across paragraphs" counted
`loadstart` 3 times (expected 1).
**Interpretation.** The provider sets `src` again when the reader
re-renders. Not shown yet: whether WebKit does the same.
**Lesson.** A persistent element must be keyed on the file URL, never on
render state.
**Next experiment.** Set `src` only when the file URL changes; rerun in
both engines.
```

Rules:
1. Write the entry when the signal arrives, before the next change, so a
   failure is never lost.
2. Failures, flakes and dead ends get entries as full as successes.
3. Every number is copied from output in this session, with the command and
   the commit. "I think it passed" is not a result.
4. Every claimed fix names its mutation check (what was broken, which test
   failed) in Evaluation and Result.
5. Reviews count as iterations: the hypothesis is "this PR is ready"; the
   result lists confirmed and refuted findings.
6. Samuel's feedback counts as an iteration, quoted.
7. Keep each iteration to about 15 lines; link to the PR or CI run for the
   rest.
8. At the end of each step, update the Index and "Lessons so far", and copy
   any lesson that will matter beyond M14 into `docs/handoff.md` §5.

## 8. Lessons to apply (from M13's learning loop and this planning session)

From `docs/learning-loop-2026-10-05.md` §B–D, `docs/handoff.md` §5, and the
2026-10-05 design session. Each line says how it applies to M14.

1. **Mutation-check every fix and every new test.** Three M13 tests passed
   with their fix removed. In M14: each step above lists its mutation
   checks; run them all and log them.
2. **Look at every screenshot, then turn what you saw into a measurement.**
   M14 is mostly visual. "Nothing hides under the tabs or the player",
   "all three player controls exist", "the switch changes the view" must be
   assertions, not impressions.
3. **Check controls for completeness before showing anything.** The first
   mockup's phone player had no skip buttons. Before a PR or a screenshot
   goes to Samuel, count the controls each player and each card must have.
4. **Use Samuel's words, not the old model's.** No "owned"; labels by
   availability; show options when asking him to choose.
5. **Start from a green baseline and run the whole suite from a fresh
   database before each PR,** as CI does.
6. **Never run Playwright projects that share data at the same time.** A
   failure that disappears when a project runs alone is a collision, not a
   bug.
7. **On a CI-only failure, read CI's trace first** (`gh run download <run>
   -n playwright-report`): requests, timings, the snapshot at failure.
   Separate a flake from a failure with evidence; remove a flake's cause
   rather than re-running.
8. **Reference screenshots are Linux images.** On the Mac run
   `--ignore-snapshots`; when a page changes, let CI fail once, download the
   report, look at each `*-actual.png`, copy it into `e2e/__screenshots__`,
   and say in the PR which images changed and why.
9. **Scripted edits assert their match count; read the diff before every
   commit.** An M13 Python replace silently removed a layout rule.
10. **Make fixtures deterministic and respect identity rules.** The library
    knows a book by its normalised title (`normaliseTitle`); a changed test
    book needs a new title.
11. **When timing semantics change, test what the reader sees.** Step 6
    moves the player: assert the lit word and the time, not internal state.
12. **Read the library's source (Next.js docs in `node_modules/next/dist/
    docs`) when behaviour surprises you,** before guessing. The layout
    persistence fact in step 6 came from there.
13. **Review the fixes, not just the first draft.** M13's second review
    found a bug a fix had introduced.
14. **Claims follow evidence.** Re-derive every number before writing it in
    a PR, the ledger or this log; label it with its commit; never claim a
    gain from one noisy sample.
15. **Hold the merge with a draft PR while verifying;** mark it ready only
    when the evidence is in; after merging, confirm `main` equals the
    checked commit.

## 9. The loop for each step

1. **Plan** (5 minutes): re-read the step; ask the advisor before writing
   code; write the hypothesis as the next iteration.
2. **Implement** with unit tests first for logic; run only the affected
   test files while working.
3. **Verify locally**: `npm run check`; the affected browser projects
   against a long-running local server; then the whole suite from a fresh
   database (`rm -rf .data/e2e .data/e2e-files && npx playwright test
   --ignore-snapshots`). Look at the screenshots in `screenshots/`.
4. **Mutation-check** each fix and new test (§5 lists them). Log each.
5. **Review by agents**: spawn one reviewer agent per dimension
   (correctness and data; UI against the mockup and §1's rules, including
   the control count and the "owned" grep; accessibility and contrast;
   tests: could each fail?; regressions in other pages). Each finding goes
   to a skeptic agent that tries to refute it. Fix what is confirmed; log
   the counts (confirmed, refuted, fixed). Use the Workflow tool only if
   Samuel says "use a workflow"; otherwise use the Agent tool.
6. **Push as a draft PR.** The body: plain English for Samuel; what changed
   and why; the "Done when" evidence (commands and output, commit); the
   screenshot grid. On a CI failure, read the trace (lesson 7).
7. **Second review** of the fixes; mutation-check new fixes.
8. **Ready and merge** once every required check is green and no test was
   skipped or weakened. Confirm `main` equals the checked commit. Write the
   `PROGRESS.md` Log entry and the iteration.
9. **Ask the advisor before declaring the step done.**

## 10. Open questions for Samuel (defaults apply until he answers)

Put these in `PROGRESS.md` Open unknowns (row 4) and in the M14 verdict
issue. Each has a default in §4.

1. D1: should ElevenLabs narration count as "Listen" for EPUBs? (Default:
   no; only your uploaded audiobook counts.)
2. D3: titles not available yet: one closed group at the end of the grid?
   (Default: yes.)
3. D5: "Want to Read": everything not started, or a list you add to by hand
   like Apple's? (Default: everything not started.)
4. D8: spine view on desktop too? (Default: phone only.)
5. D10: is "sections with ordered titles, each optionally Story first or Go
   deeper" enough for your own Paths? (Default: yes.)
6. Still open from earlier: the Path page layout (one option drawn) and the
   two Home extras (a question; threads), not in M14.

## 11. Risks

- **Step 6 is the hard part.** It moves working, heavily tested audio code
  (M13 (d) and (e)) under a new owner. Do 6a with no visible change and the
  full player suite green in both engines before any new UI.
- **Safari's rules**: `play()` must be called inside the click; WebKit
  seeks take 1.2–1.7 s when the bytes are not downloaded yet (M13 notes);
  a real iPhone has not been tried (M13 step (f)).
- **CI's WebKit page-turn timing** (79, 68, 92 ms against a 100 ms limit in
  one M13 test) may flake; if it does, follow
  `docs/learning-loop-2026-10-05.md` §E.1 before changing anything.
- **Screenshot churn**: step 2 changes every signed-in reference image;
  keep step 2 free of other visual changes so the diff is reviewable.
- **Scope creep**: "Listen only" uploads, a hand-made Want to Read list,
  desktop spines, the Home extras are out of M14 unless Samuel says so.
