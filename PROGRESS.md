---
project: Neolibrary
status: active
owner: Samuel Ahuno
team: Claude cloud sessions (builders)
next_action: Sessions loop through docs/done.md on their own; next is M4 (reader + section model + search).
blockers: none for building; live deploy waits on Samuel (see Waiting on Samuel).
updated: 2026-10-04
shared_copy: none
---

# Neolibrary

A private, beautiful web library for independent study: Samuel's own ebooks
on a shelf, read and listen together, with AI help on every section
(rewrites, prerequisites, question banks, images), open only to invited
people. Goals are in `docs/vision.md`; the milestone plan is in `docs/plan.md`.
"Done" for version 1 means milestones M1 to M12 in the plan are merged and deployed.

## Exact next steps

The goal and the loop are in `docs/done.md`. Samuel is not watching; work alone.

1. **M4 (c) · full-text search** across books and (later) notes. The
   `sections.search` column (a Postgres full-text index) already exists.
   Build a search page `/search?q=` with results grouped by book, each
   showing the paragraph with the match highlighted and linking into the
   reader at that paragraph's CFI (`/books/[id]/read?at=<cfi>`, which the
   reader must accept). Playwright: search a phrase from a fixture book,
   then open the result at the right place. Then tick M4 in `docs/done.md`
   (Samuel's real-book verdict is recorded as "awaiting", not blocking).
   PDF reading (pdf.js) is still to do, in its own PR.
2. Then M5, M6, … in order, per `docs/done.md`.

## Waiting on Samuel

Never blocks the loop. Newest first.

- **Owner account** (after the Railway deploy, about 2 minutes): open
  `https://<railway-url>/setup`. The setup code is in Railway → `web` →
  Deployments → View logs (line "Neolibrary setup: …"), or set your own as
  the variable `SETUP_CODE` on `web`. Then invite people from "Invite".
- **Railway deploy** (about 3 minutes): Railway → project `neolibrary` →
  service `web` → Settings → Source → connect `sahuno/neolibrary`, branch
  `main`; then Settings → Networking → "Generate domain". Railway reads
  `railway.json`. Paste the URL anywhere a session will see it (e.g. a
  GitHub issue titled "Railway URL").
- **Branch protection** (optional second lock): GitHub → Settings →
  Branches → rule for `main` requiring `Lint, types, unit tests`,
  `PR hygiene (PROGRESS.md Log entry)`,
  `Browser tests (screenshots + accessibility)`.
- **Design references** (any time): 5–10 screenshots you love and 3 you
  dislike in `docs/design/refs/`, one line each on why.
- **Keys, later:** `ANTHROPIC_API_KEY` (M6), `OPENAI_API_KEY` (M9) on
  Railway `web`.
- **Spending caps** (open unknown 1): until set, defaults of $5 per book
  and $20 per month per provider.

## Open unknowns

| # | Question | Owner | Decide by | Status |
|---|---|---|---|---|
| 1 | Spending cap per month for Claude + ElevenLabs + OpenAI + Railway? Default until Samuel sets one (docs/done.md): $5 per book, $20 per month per provider, as environment variables. | Samuel | before M6 | open (default applies) |
| 2 | Can a cloud session merge its own PR? Plan answer: auto-merge GitHub Action (added in M1, needs Samuel's two repo settings). Partly answered 2026-10-04: this session was told by its environment to push only to its assigned `claude/…` branch, so branches are `claude/…`, not `m<N>-…`; the auto-merge Action accepts both. A browser download was not needed (Chromium is preinstalled; Playwright pinned to 1.56.1 to match it). Answered 2026-10-04: yes, the session merged PR #2 with its GitHub tools (`merge_pull_request` → `merged: true`). | first M1 session | during M1 | closed |

## Decisions

- 2026-10-04 · Samuel stops supervising; sessions work alone to the goal in `docs/done.md` (implement → verify → merge → loop). Items only Samuel can give go under "Waiting on Samuel" and never block · by Samuel
- 2026-10-03 · Add STE (Simplified Technical English) to M6: a rewrite option with a strictness dial (default Standard ≈80%) and a reading preference for all AI explanations, using Samuel's skill copied to `prompts/ste/` · by Samuel
- 2026-10-03 · Anthropic key needed only from M6, OpenAI key only from M9; voice-note transcription uses ElevenLabs · because cloud sessions build and test with fakes · by Claude
- 2026-10-03 · Full self-merge kept: no PR category needs Samuel's approval (Fable's CODEOWNERS tiers declined) · by Samuel
- 2026-10-03 · Plan revised with Fable's review: study Paths (Path → Pillar → N/E slots) are the core of the shelf; W3C annotation anchors with quoted text; provenance on AI output; export round-trip tests; hard spending caps; DRM-free files only; design tokens + screenshot checks + Samuel's reference images; handwriting kept but last in M8 · because Fable judged these cheap now and expensive later · by Claude, at Samuel's request
- 2026-10-03 · Cloud sessions merge their own PRs when every required check is green and no test was skipped or weakened; `main` gets branch protection · because Samuel wants autonomous progress · by Samuel
- 2026-10-03 · Images: Wikipedia/Wikimedia Commons by default, OpenAI image generation when nothing fits · by Samuel
- 2026-10-03 · Defaults accepted for the other open questions: EPUB + text-based PDF first (scanned PDFs later); each reader sees only their own uploads unless the owner shares a shelf; Railway's free URL until a domain is chosen · by Samuel
- 2026-10-03 · First "To read" shelf = the Hidden Machinery reading list, copied to `docs/reading-lists/hidden-machinery.md` (original in secondBrain) and seeded in M3 · by Samuel
- 2026-10-03 · Stack: Next.js + TypeScript, foliate-js reader, Postgres/Drizzle, Railway hosting + bucket, Vitest + Playwright · because these are well documented, deploy from GitHub, and let unattended sessions test their own work · by Claude (default; Samuel can overrule)
- 2026-10-03 · Invite-only personal accounts instead of one shared password · because each reader needs their own highlights and notes, and public sign-up later then needs no rewrite · by Claude (default)
- 2026-10-03 · Design system written in M1 and checked in every milestone · because aesthetics is the top requirement in the vision · by Claude (default)

## Log

### 2026-10-04 04:45 · Claude (cloud) · M4 (b): section model with stable ids and CFIs
- **Done:** `lib/library/sections.ts` splits every EPUB, in reading order, into chapters (one per chapter file, labelled from the contents), sections (headings inside a chapter) and paragraphs (leaf text blocks). Each gets a stable id built from the chapter path, its position and a hash of its text, so the same file always gives the same ids. Each also gets an EPUB CFI, written the way foliate-js writes them. New table `sections` (migration `0006_sections`, with a reverse step) holds the text plus a generated full-text search column, ready for M4 (c). Sections are built at upload and backfilled at server start for EPUBs uploaded earlier. Fixed a contents-label bug found along the way: labels with inline markup came out scrambled ("Mr. Search forHyde"); the contents are now read with a DOM parser (linkedom).
- **Key paths:** `lib/library/sections.ts`, `lib/library/sections-store.ts`, `db/migrations/0006_sections.*`, `lib/library/ebook.ts` (contents parsing), `instrumentation.ts` (backfill)
- **Commands that worked:** Vitest: library tests `93 passed`. Includes: *Jekyll and Hyde* gives over 200 paragraphs in order; re-extraction gives identical ids; **every 7th paragraph's CFI, resolved with foliate-js's own `epubcfi.js`, returns exactly that paragraph's text**; rebuild and backfill keep the ids. `npx playwright test` → `94 passed (1.3m)`.
- **Known issues / blockers:** Front matter (titlepage, imprint, colophon) is included as chapters; the AI features may want to skip it. PDFs have no sections yet (needs pdf.js text extraction). Sections are derived from the file, so they are not in the library export; they rebuild from the file.
- **Exact next steps:** M4 (c), per "Exact next steps".

### 2026-10-04 04:20 · Claude (cloud) · M4 (a): the reader (foliate-js), reading position, security policy
- **Done:** A Content Security Policy (a browser rule listing which scripts may run) on every page, set in `proxy.ts`. Only Next.js's own scripts, carrying a per-request nonce, may run; books open in `blob:` frames that inherit the policy, so scripts inside a book are blocked (foliate-js requires this). The reader at `/books/[id]/read` (EPUB) uses foliate-js 1.0.1 (MIT): Pages or Scroll layout, text size, line spacing, typeface (Serif, Sans or the book's own), contents panel, side buttons and arrow keys to turn pages, and chapter plus progress at the foot. Book pages get the app's colours (read from the design tokens at run time) and fonts (copied to `public/fonts/`, OFL). The position (EPUB CFI, a standard address for a spot in a book) and progress are saved while reading (`PUT /api/books/[id]/position`) and restored on reopen; settings are kept on the device. Migration `0005_reading` adds `books.position`, with a reverse step; the position is also in the library export (ground rule 7). Book pages got a "Read" / "Continue reading" button.
- **Key paths:** `proxy.ts`, `app/(reader)/`, `app/(reader)/books/[id]/read/{Reader.tsx,settings.ts,reader.module.css}`, `app/api/books/[id]/position/route.ts`, `lib/library/reading.ts`, `public/fonts/`, `e2e/reader.spec.ts`, `lib/library/test-epub.ts`
- **Commands that worked:** `npm run check` → Vitest passing; `npx playwright test` → `94 passed (1.2m)`, including: open *Jekyll and Hyde*, turn 4 pages, text size 120%, wait until the server has the position, reload → same CFI start and size still 120%; contents jump to "Search for Mr. Hyde"; switch to Scroll; axe on the reader shows no violations. **Script safety:** an EPUB with `<script>` and `onerror` that rename the page fails to run. Checked by turning the policy off once: the test then fails with title "pwned", so it really detects scripts.
- **Known issues / blockers:** PDFs cannot be read in the app yet (foliate's PDF support needs pdf.js). Reader screenshots are saved for the PR grid but not compared pixel-for-pixel (book text renders inside a frame). The browser warns that the book frame allows both scripts and same-origin; that is foliate's documented setting, and the policy is what blocks scripts.
- **Exact next steps:** M4 (b), per "Exact next steps".

### 2026-10-04 03:45 · Claude (cloud) · M3 (c): shelf search, sort, collections, progress; library export/import
- **Done:** Shelf search (title or author, case-insensitive; `%` and `_` treated literally) and sort (recent, title, author, progress), both kept in the address bar so a view can be bookmarked. Collections are user-made groups of books: create on the shelf, add or remove from each book's page, filter the shelf by collection, delete. They use new tables `collections` and `collection_books` (migration `0004_collections`, with a reverse step). Each book on the shelf shows Unread / N% read / Finished. **Ground rule 7, which M3 (a)/(b) had missed:** `lib/library/export.ts` exports the whole library (books, paths with pillars and slots, collections) as one JSON file (`/api/export`, "Download your library"). Import (`/api/import`, the new "Your data" page at `/data`) works only into an empty library, so nothing is overwritten. A unit test runs export → wipe → import and checks the second export is identical. The browser's file button is styled with the app font (a system font would differ between machines). All reference screenshots were regenerated from scratch. M3 ticked in `docs/done.md`.
- **Key paths:** `lib/library/shelf.ts`, `lib/library/export.ts`, `db/migrations/0004_collections.*`, `app/(app)/shelf/{Controls,NewCollection}.tsx`, `app/(app)/data/`, `app/api/export/`, `app/api/import/`, `e2e/uploads.spec.ts`
- **Commands that worked:** `npm run check` → Vitest `91 passed`; `npx playwright test` → `90 passed (58.5s)`, including sort by title, search "wells", collection "Gothic" (create, add two books, filter, delete), export download (4 owned books, the hidden-machinery path), import into a non-empty library refused (409), import into a new account restoring a book and a collection.
- **Known issues / blockers:** The export holds book details, not the files. A restore into a different server needs the files copied too; a full backup (zip with files) can come with M5's annotation export. Import keeps ids, so it restores into the same server or a fresh one, but cannot copy one person's export into a second account on the same server (ids would clash). Collection names are unique per person only when spelled identically.
- **Exact next steps:** M4, per "Exact next steps".

### 2026-10-04 03:20 · Claude (cloud) · M3 (b): upload EPUB and PDF, covers, attach to wanted books
- **Done:** New `/shelf` page with drag-and-drop or "Choose files" upload (several files at once) through `POST /api/books`. `lib/library/ebook.ts` reads EPUBs (title, author, language, publisher, description, cover via EPUB 3 `cover-image` or EPUB 2 `meta name=cover`, table of contents from the nav document or NCX) and PDFs (title and author from metadata, else the file name, plus page count). It refuses DRM: EPUB `rights.xml` or encryption other than font obfuscation, and encrypted PDFs (ground rule 1). `lib/library/import.ts` attaches a file to a wanted book with the same title, so it lights up in its Path and keeps the list's wording; reports a book already on the shelf as a duplicate; otherwise adds a new book. Files are stored at `books/<owner>/<book>.<ext>`, covers at `covers/<owner>/…`. Production uses the Railway bucket (`lib/storage/s3.ts`, when `S3_BUCKET` is set); development and tests use local disk or memory. File links now also check the file belongs to the signed-in user, and are served with a sandbox policy so an SVG cover cannot run scripts. Covers show on the shelf, the Path and book pages; book pages list format, chapters, publisher, description and contents. Nav: Path · Shelf · Invite · Sign out. Migration `0003_book_files` (adds `toc` and `page_count`, with a reverse step). Test books: three Standard Ebooks EPUBs (Jekyll and Hyde, Frankenstein, The Time Machine) built from their GitHub source (standardebooks.org itself is blocked here), plus a generated Descartes PDF. Details in `fixtures/README.md`.
- **Key paths:** `lib/library/ebook.ts`, `lib/library/import.ts`, `lib/storage/s3.ts`, `app/api/books/route.ts`, `app/(app)/shelf/`, `app/api/files/[...key]/route.ts`, `fixtures/`, `scripts/build-fixture-epubs.py`, `scripts/make-fixture-pdf.mjs`, `e2e/uploads.spec.ts`
- **Commands that worked:** `npm run check` → Vitest `83 passed`; `npx playwright test` → `79 passed (53.5s)`, including: three EPUBs upload and appear with their titles and loaded cover images; *The Grid: The Fraying Wires…* attaches to the wanted *The Grid* and the Path shows "1 owned"; a duplicate, a .txt and a DRM EPUB are refused with clear messages; cover links give 403 when tampered with and 401 when signed out.
- **Known issues / blockers:** PDFs get typographic covers, because drawing the first page needs pdf.js (M4). S3 storage is not exercised in tests (no bucket access here); it runs when deployed with the `S3_*` variables. Uploads are read fully into memory (200 MB limit per file).
- **Exact next steps:** M3 (c), per "Exact next steps".

### 2026-10-04 02:50 · Claude (cloud) · M3 (a): study Paths, Hidden Machinery seed, Path view
- **Done:** New tables `books`, `paths`, `pillars`, `slots` (migration `0002_library`, with a reverse step). Every row belongs to one user, so each person sees only their own library. `data/paths/hidden-machinery.ts` holds the reading list as data: Deedy's 18 pillars, 2 finance pillars, 9 blindspots, the reader suggestions, 3 agent-suggestion pillars (marked "not catalog-checked") and the master key last. A test checks it against the markdown list. `seedPath` adds a Path once per user and reuses a book the user already has with the same title (titles compared without case, punctuation or subtitle). The owner's Path is added at setup; other readers get an "Add this path" button. The home page is now the Path view: pillar columns, N then E covers, extras folded away, unowned books dimmed, a pillar track, "You are here", and the master key set apart at the end. Each book has a page saying where it sits in the Path. Cover gained a small size, links, a progress bar and a "current" ring.
- **Key paths:** `db/migrations/0002_library.*`, `data/paths/`, `lib/library/paths.ts`, `components/PathView.tsx`, `components/Cover.tsx`, `app/(app)/page.tsx`, `app/(app)/books/[id]/`, `e2e/paths.spec.ts`
- **Commands that worked:** `npm run check` → Vitest `70 passed`; `npx playwright test` → `66 passed (50.5s)`. These include the Path showing every pillar title in reading-list order, N before E in each pillar, the master key after all pillars, "You are here" on pillar 01, agent suggestions labelled, and another user's book id giving 404.
- **Known issues / blockers:** First CI runs failed on the book page only: `.gitignore` had `books/` (meant for book files), which also hid `app/(app)/books/`, so the page never reached GitHub and CI screenshotted a 404. Fixed by anchoring the rule (`/books/`, `/uploads/`), plus `lib/repo.test.ts` (fails if any source folder is ignored) and `lib/glyphs.test.ts` (fails if page text uses a character missing from the bundled fonts, e.g. "←", which would render differently per machine). CI now also publishes expected/actual/diff images of failed screenshot comparisons to the `ci-screenshots` branch (`pr-N/<sha>/failures/`), since sessions cannot download CI artifacts. The Path page is long (29 pillars); collapsing groups may help later. The test timeout was raised to 30 seconds because each database test starts its own in-process Postgres.
- **Exact next steps:** M3 (b) upload, per "Exact next steps".

### 2026-10-04 02:25 · Claude (cloud) · M2: invite-only accounts
- **Done:** Postgres through Drizzle (a TypeScript layer for database queries), with PGlite (Postgres running inside Node) when `DATABASE_URL` is absent, so tests and CI need no database server. Hand-written migrations (scripts that change the database layout), each with a `.down.sql` reverse step, run at server start (`instrumentation.ts`). Accounts: no public sign-up. The owner account is created once at `/setup` with a one-time code (from `SETUP_CODE`, or printed in the server log); everyone else joins through a single-use, 7-day invite link that only an admin can make. Passwords use scrypt hashes; sessions are random tokens in an httpOnly cookie, and the database stores only their hash. Sign-in is rate-limited. Every page and API sits behind a two-step gate: `proxy.ts` checks the cookie is present, then pages and routes check the session against the database. File links are short-lived and signed (HMAC, 5 minutes) and also need a signed-in user; the signing key is generated and kept in the database, so no new variable is needed. Storage interface with a memory fake (S3 comes in M3). Pages: sign-in, setup, invitation, home, invite management; `/design` moved behind login. Fixed a React 19 behaviour that wiped the email field after a wrong password. Covers now shrink long titles instead of overflowing.
- **Key paths:** `lib/auth/`, `lib/db/`, `db/migrations/0001_accounts.{up,down}.sql`, `proxy.ts`, `instrumentation.ts`, `app/(public)/`, `app/(app)/`, `app/api/me/`, `app/api/files/[...key]/`, `lib/signed-url.ts`, `lib/storage/`, `e2e/flows.spec.ts`, `e2e/auth.setup.ts`
- **Commands that worked:** `npm run check` → lint clean, types clean, Vitest `58 passed`; `npx playwright test` → `54 passed (36.3s)`, including: logged-out → `/`, `/design`, `/admin/invites` and an unknown page redirect to sign-in; `/api/me` and `/api/files/...` answer 401 (also with a forged cookie); an invited user joins, signs out, fails with a wrong password, signs back in; the invite link then shows "closed"; a reader gets 404 on `/admin/invites`. Manual: `curl` against `next start` with a fresh PGlite gave the same codes (307 to sign-in, 401 for API).
- **Known issues / blockers:** No password reset yet (an admin can make a new invite); add it with email in a later step if needed. The rate limiter lives in memory (one server process). Production database is empty, so no backup is needed before this first migration; later migrations need one (CLAUDE.md).
- **Exact next steps:** M3, per "Exact next steps".

### 2026-10-04 02:40 · Claude (cloud) · Defined "done" and the autonomous loop
- **Done:** Samuel asked for a clear definition of done so sessions can work without supervision. Wrote `docs/done.md`: what makes a milestone done (built, proved by CI tests, merged green, looks right, ground rules kept, recorded), a checklist M1–M12 plus "live" checks, how to handle things only Samuel can give (list them, never block), and the loop. CLAUDE.md now points to it. `PROGRESS.md` gained "Waiting on Samuel"; open unknown 2 closed (a session can merge its own PR directly; it merged PR #2). M1 ticked as built; its live check waits on the Railway connection.
- **Key paths:** `docs/done.md`, `CLAUDE.md`, `PROGRESS.md`
- **Commands that worked:** PR #2 merge via GitHub tools → `{"merged":true,"sha":"f64ebe3…"}`; CI on PR #2 head `8b458e7`: 3/3 checks success.
- **Known issues / blockers:** live deploy still waits on Samuel (Railway connection).
- **Exact next steps:** M2, per "Exact next steps".

### 2026-10-04 02:20 · Claude (cloud) · Fixed auto-merge: it merged PR #1 before CI finished
- **Done:** PR #1 (M1 skeleton) was merged by `github-actions[bot]` 9 seconds after it opened, before the browser tests finished. Cause: "Allow auto-merge" is already on but `main` has no required checks yet, and `gh pr merge --auto` then merges at once. Rewrote `.github/workflows/auto-merge.yml` to wait for the CI workflow itself (`workflow_run`), and to merge only if CI passed on the PR's latest commit (`--match-head-commit`). This holds even without branch protection. Because GitHub runs `workflow_run` workflows from main's copy, this fix PR is merged by hand once green.
- **Key paths:** `.github/workflows/auto-merge.yml`, `PROGRESS.md`
- **Commands that worked:** GitHub API: PR #1 `merged_by: github-actions[bot]`, `created_at 01:57:44Z`, `merged_at 01:57:53Z`; CI run 37169580122 on that commit: `Lint, types, unit tests` success, `PR hygiene` success, browser tests still running at merge time.
- **Known issues / blockers:** main received M1 before its browser tests finished, but they then passed on that same commit (job `Browser tests (screenshots + accessibility)` → success at 01:59:13Z; screenshots match the references made in the cloud container), so main is green on every check. Branch protection on `main` is still needed (Samuel) as a second lock.
- **Exact next steps:** see "Exact next steps".

### 2026-10-04 02:10 · Claude (cloud) · M1 skeleton: Next.js app, design tokens, CI, screenshot grid, auto-merge
- **Done:** Built the M1 skeleton on `claude/magical-bardeen-fpwlg1`. Next.js 16 + TypeScript app with a plain sign-in page (`/sign-in`, `/` redirects there; the button stays disabled until M2) and a design-system sample page (`/design`) showing the reading style, a highlight, the spoken-word mark, machine-written text, covers, type, colours and buttons. Wrote `docs/design.md` and `app/tokens.css` (light + dark, from the Codex prototypes; Samuel's refs not yet in). Checks: ESLint; stylelint rule that rejects colours, sizes and spacing not taken from tokens (proved by `lib/token-guard.test.ts`); contrast test of every token pair in both themes; Vitest; Playwright screenshot comparison (2 pages × phone/desktop × light/dark) and axe-core accessibility. GitHub Actions: `ci.yml` (checks, PR hygiene = new Log entry required, browser tests, screenshot grid comment via a `ci-screenshots` branch) and `auto-merge.yml`. `railway.json` + `/api/health` for deploy. Not done: Railway deploy (needs Samuel to connect the repo) and the "Railway URL loads" part of M1's Done-when.
- **Key paths:** `app/tokens.css`, `app/sign-in/`, `app/design/`, `components/Cover.tsx`, `components/Mark.tsx`, `docs/design.md`, `stylelint.config.mjs`, `lib/tokens.test.ts`, `e2e/`, `e2e/__screenshots__/`, `.github/workflows/ci.yml`, `.github/workflows/auto-merge.yml`, `scripts/check-pr-hygiene.mjs`, `railway.json`, `.env.example`
- **Commands that worked:** `npm run check` → lint clean, `tsc` clean, Vitest `41 passed`; `npx playwright test` → `24 passed (19.0s)`; changing `--accent` on purpose made `toHaveScreenshot` fail on both pages (`17162 pixels (ratio 0.02 …) are different`), restoring it passed again; `npx next build` → routes `/`, `/sign-in`, `/design`, `/api/health`.
- **Known issues / blockers:** Reference screenshots were made in this cloud container; GitHub's runner may draw text slightly differently (allowance 0.2% of pixels), so the first CI run may need new reference images. The grid comment links to images on the `ci-screenshots` branch; in a private repo they show only to people signed in to GitHub with access. The auto-merge Action does nothing until Samuel turns on "Allow auto-merge" and branch protection. Fonts are Source Serif 4 / Source Sans 3 (my pick, open licence); Samuel can overrule.
- **Exact next steps:** see "Exact next steps" 1–3.

### 2026-10-03 21:55 · Claude (laptop) · Pushed prototypes/STE; cloud-environment steps; auto-merge plan
- **Done:** Committed and pushed `155bdc5`. Got cloud-session setup steps from Claude Code docs (claude-code-guide agent; doc URLs: code.claude.com/docs/en/web-quickstart.md, cloud-environments.md, claude-code-on-the-web.md, routines.md). The docs say sessions can open but not merge PRs, so M1 now includes an auto-merge GitHub Action; CLAUDE.md notes it. New open unknown 2 for M1 to verify.
- **Key paths:** `/Users/sahuno/projects/personal/Neolibrary/docs/plan.md`, `/Users/sahuno/projects/personal/Neolibrary/CLAUDE.md`, `/Users/sahuno/projects/personal/Neolibrary/PROGRESS.md`
- **Commands that worked:** `git push` → `## main...origin/main` (in sync) after `155bdc5`
- **Known issues / blockers:** Self-merge is unproven until M1 builds the auto-merge Action. Docs claims came from a sub-agent and were not opened by me.
- **Exact next steps:** 1) Samuel installs Claude GitHub App and creates the environment. 2) First cloud session: "Start M1 per PROGRESS.md".

### 2026-10-03 21:40 · Claude (laptop) · Added STE mode to the plan; deferred API keys
- **Done:** Copied Samuel's STE skill (SKILL.md, rules.md, substitutions.md, ste_check.py) to `prompts/ste/` with a README; M6 now has an STE rewrite option, strictness dial and STE reading preference with a score badge. M0 no longer asks for Anthropic/OpenAI keys (needed before M6 and M9). M8 voice-note transcription set to ElevenLabs.
- **Key paths:** `/Users/sahuno/projects/personal/Neolibrary/prompts/ste/`, `/Users/sahuno/projects/personal/Neolibrary/docs/plan.md`, `/Users/sahuno/projects/personal/Neolibrary/PROGRESS.md`
- **Commands that worked:** `cmp` of each copied file vs the skill → identical (4/4); `python3 prompts/ste/ste_check.py --text "Light transfers a pattern onto the wafer. Each layer adds another part of the circuit."` → `0 errors · 0 warnings · compliance 100%`
- **Known issues / blockers:** `prompts/ste/` will drift if the skill changes; re-copy. Prototypes, STE files and ledger changes not yet committed or pushed.
- **Exact next steps:** 1) Commit + push (awaiting Samuel's go-ahead). 2) Samuel: Claude cloud environment, design refs. 3) Cloud session: M1.

### 2026-10-03 21:25 · Claude (laptop) · Railway set up; Codex made 9 design prototype images
- **Done:** Railway project `neolibrary` created with `Postgres` (running), bucket `neolibrary-files` (US East), empty service `web` holding `DATABASE_URL` (reference to Postgres), six `S3_*` bucket variables and `ELEVENLABS_API_KEY` (copied from Keychain, never printed). Repo not connected to `web` yet (would fail to build until M1). Railway MCP installed for Claude Code (loads after restart). Codex (OpenAI image generation) made 9 prototypes in `docs/design/prototypes/`; prompt in `PROMPT.md`, and Codex's exact per-image prompts are in this session's transcript. Plan M1 now points to them.
- **Key paths:** `/Users/sahuno/projects/personal/Neolibrary/docs/design/prototypes/` (01–09 PNG + PROMPT.md), `/Users/sahuno/projects/personal/Neolibrary/docs/plan.md`, `/Users/sahuno/projects/personal/Neolibrary/PROGRESS.md`
- **Commands that worked:** `railway init --name neolibrary`; `railway add --database postgres --json`; `railway bucket create neolibrary-files --region iad --json`; `railway add --service web --json`; `railway variable set KEY --stdin --service web --skip-deploys`; check: DATABASE_URL starts with `postgresql://` = True, ElevenLabs key equals Keychain = True; `railway mcp install --agent claude-code`
- **Known issues / blockers:** Prototype 01/02 progress line shows 20 dots for 18 pillars. The wafer card is a generated picture labelled with a prototype Wikimedia credit. Prototype images (~15 MB) not yet committed. Anthropic/OpenAI keys not yet on Railway.
- **Exact next steps:** 1) Commit + push `docs/design/prototypes/` and ledger. 2) Samuel: Anthropic + OpenAI keys onto Railway `web`; create Claude cloud environment; add design refs. 3) Cloud session: M1.

### 2026-10-03 21:15 · Claude (laptop) · Git repo created and pushed to private GitHub
- **Done:** Recorded Samuel's decision: full self-merge, no approval tiers (open unknown 2 closed). `git init`, first commit, private repo `sahuno/neolibrary` created and pushed. Added `.claude/scheduled_tasks.lock` to `.gitignore`. `demo/books/Descartes_1641Meditations.pdf` (added by Samuel) is excluded by the `*.pdf` rule and was not committed.
- **Key paths:** `/Users/sahuno/projects/personal/Neolibrary/.gitignore`, `/Users/sahuno/projects/personal/Neolibrary/PROGRESS.md`
- **Commands that worked:** `git init -b main && git add . && git commit`; `gh repo create neolibrary --private --source . --push`
- **Known issues / blockers:** Railway, API keys, cloud environment, branch protection and design refs still to do (Samuel).
- **Exact next steps:** see "Exact next steps" 2–3, then a cloud session starts M1.

### 2026-10-03 21:00 · Claude (laptop) · Folded Fable's "A-class" advice into the plan
- **Done:** Fable (claude-fable-5-1) reviewed vision, plan, ledger and reading list. Added to `docs/plan.md`: "Why it exists" and "The core idea: study paths" sections; ground rules 7–9 (export round-trip, spending caps, notes never overwritten) and stronger 1, 4, 5 (DRM-free only, quote anchors, provenance); M0 design refs; M1 screenshot/accessibility/token checks and PR screenshot grid, landing page cut; M3 Paths model with the reading list as main fixture; M4 search + real-book check; M5 W3C export; M6 cross-book links + real-book check; M7 provider-agnostic audio + cost cap; M8 handwriting last; M10 own trend first; M12 smaller. Fable's advice tagged *(Fable)* inline. Not adopted: moving handwriting to Later (it is in the vision); requiring Samuel's approval on some PRs (conflicts with Samuel's self-merge decision; logged as open unknown 2).
- **Key paths:** `/Users/sahuno/projects/personal/Neolibrary/docs/plan.md`, `/Users/sahuno/projects/personal/Neolibrary/CLAUDE.md`, `/Users/sahuno/projects/personal/Neolibrary/PROGRESS.md`
- **Commands that worked:** `grep -c Fable docs/plan.md` → 19; `grep -nwiE 'he|his|him' docs/plan.md CLAUDE.md PROGRESS.md` → no matches
- **Known issues / blockers:** M0 still Samuel's (GitHub repo, Railway, keys, branch protection, design refs). Fable's [fact] claims (W3C TextQuoteSelector, Playwright toHaveScreenshot, axe-core, Standard Ebooks, DMCA §1201, ElevenLabs per-character billing) were not re-checked against sources this session.
- **Exact next steps:** 1) Samuel does M0 steps 1–3 in "Exact next steps". 2) Samuel answers open unknown 2 before M2. 3) Cloud session starts M1.

### 2026-10-03 20:44 · Claude (laptop) · Applied Samuel's decisions; added the reading list
- **Done:** Self-merge on green checks (CLAUDE.md rules + branch protection step in M0). Images = Wikipedia/Wikimedia first, OpenAI generation fallback (plan table, M9). ElevenLabs key confirmed present in Keychain (service name `ELEVENLABS_API_KEY`, value not printed); copy command added to next steps. Reading list copied into repo; M3 now seeds a "To read" shelf from it. Other open unknowns closed with defaults; only spending cap remains. Fable (claude-fable-5-1) asked for "A-class" advice; still running at time of entry.
- **Key paths:** `/Users/sahuno/projects/personal/Neolibrary/docs/plan.md`, `/Users/sahuno/projects/personal/Neolibrary/CLAUDE.md`, `/Users/sahuno/projects/personal/Neolibrary/PROGRESS.md`, `/Users/sahuno/projects/personal/Neolibrary/docs/reading-lists/hidden-machinery.md`
- **Commands that worked:** `security find-generic-password -s ELEVENLABS_API_KEY >/dev/null && echo found` → found by service name; `diff <(tail -n +3 docs/reading-lists/hidden-machinery.md) <secondBrain original>` → identical
- **Known issues / blockers:** Repo not on GitHub yet (M0). Reading-list copy will drift if the secondBrain original changes; re-copy by hand. Fable advice not yet folded in.
- **Exact next steps:** 1) Fold Fable's advice into `docs/plan.md`. 2) Samuel does M0 (steps 1–3 above). 3) Cloud session starts M1.

### 2026-10-03 · Claude (laptop) · Wrote the build plan, session rules and this ledger
- **Done:** Read `docs/vision.md` (10 features). Wrote a 13-milestone plan (M0 set-up to M12 offline), the rules every cloud session follows, and this ledger. No code yet; not a git repo yet.
- **Key paths:** `/Users/sahuno/projects/personal/Neolibrary/docs/plan.md`, `/Users/sahuno/projects/personal/Neolibrary/CLAUDE.md`, `/Users/sahuno/projects/personal/Neolibrary/PROGRESS.md`, `/Users/sahuno/projects/personal/Neolibrary/.gitignore`
- **Commands that worked:** `ls -la . docs` (4 files present); `grep -c "^### M" docs/plan.md` → 13 (M0–M12)
- **Known issues / blockers:** Cloud sessions need a GitHub repo (M0, Samuel only). Open unknowns 1 and 5 should be answered before M3.
- **Exact next steps:** see "Exact next steps" above, starting at 1.
