# Handoff: where the build is, where it is going, and what to watch out for

Written for: the next Claude session (on Samuel's laptop, or in the cloud) and
for Samuel. Written 2026-10-04 by the cloud session that built M6 to M9.
Read this together with `PROGRESS.md` (the ledger), `docs/done.md` (the goal
and the loop) and `docs/plan.md` (the milestones).

## 1. Where things stand (2026-10-04, about 09:50 UTC)

- **Done (built), merged to `main`:** M1 to M8, M9 (a) and (b), and the
  real-Postgres CI job (PR #32, merged 2026-10-04).
- **Live:** https://web-production-f27a0e.up.railway.app (issue #31). It was
  deployed by hand from the laptop (`railway up`) at `d5ac52f`. Railway does
  **not** auto-deploy yet: its GitHub app has no access to this private repo
  (Waiting on Samuel). Cloud sessions cannot reach the live site (network
  policy), so live checks must be run from the laptop.
- **Branch `claude/magical-bardeen-fpwlg1`** (the cloud session's branch) carries
  two commits on top of `main`, in one open PR titled
  "M9 (c): pin a picture to a passage, plus the handoff to the laptop":
  1. `M9 (c): pin a picture to a passage; tick M9`: complete and tested
     (unit 209 passed, Playwright 139 passed, real Postgres 2 passed).
     It ticks M9 in `docs/done.md`.
  2. `Handoff: …`: this file, the M10 (a) work-in-progress patch, and ledger
     updates.
  The auto-merge Action merges it once CI is green. If it is still open,
  make its checks green first.
- **M10 (a) is in progress** and is **not committed as code**. It is saved as a
  patch: `docs/handoff/m10a-reading-stats-wip.patch`. See §3.

### To resume on the laptop

```bash
git fetch origin
git checkout -B m10-reading-stats origin/main   # after the M9 (c) + handoff PR is merged
# or, before it is merged:  git checkout -B m10-reading-stats origin/claude/magical-bardeen-fpwlg1
git apply docs/handoff/m10a-reading-stats-wip.patch
npm ci
npm run check                       # lint, types, unit tests
npx playwright test                 # browser tests (~3.5 min), builds the app first
```

Then finish M10 (a) as described in §3, and carry on with the loop in
`docs/done.md`.

## 2. How the work is done (the loop that worked)

One milestone step per PR. For each step:

1. Read the milestone in `docs/plan.md` and the "Exact next steps" in `PROGRESS.md`.
2. Build behind interfaces with fakes (ground rule 3). No real keys in tests.
3. Unit tests (Vitest) for the logic. A Playwright test for the "Done when"
   sentence. Screenshots in phone/desktop × light/dark for anything visible,
   plus an axe accessibility check.
4. `npm run check`, then `npx playwright test`. Look at the screenshots
   yourself: several layout bugs were only caught by eye (see §5).
5. Add a Log entry at the top of `## Log` in `PROGRESS.md` (five fields), and
   update "Exact next steps" and the header's `next_action`. CI's hygiene job
   fails a PR without a new Log entry.
6. Commit, rebase onto `origin/main`, push, open the PR. The body is plain
   English for Samuel and pastes the evidence: commands and their output.
7. The **auto-merge** workflow (`.github/workflows/auto-merge.yml`) squashes
   the PR once CI is green. Then rebase the branch onto the new `main` (the
   squash makes your local commit redundant; `git rebase` drops it).

Useful commands:

| What | Command |
|---|---|
| All fast checks | `npm run check` |
| Browser tests | `npx playwright test` (one project: `--project ai`, but projects depend on earlier ones; see §5) |
| Regenerate reference screenshots | `npx playwright test --update-snapshots`, then check `git status e2e/__screenshots__` and look at every changed image |
| Real Postgres tests | `TEST_DATABASE_URL=postgres://user@host:port/postgres npm run test:postgres` (needs a Postgres where you may `CREATE DATABASE`) |
| Local Postgres in a Linux container as root | `su postgres -c "/usr/lib/postgresql/16/bin/initdb -D ~/neolib-test -A trust -U postgres && /usr/lib/postgresql/16/bin/pg_ctl -D ~/neolib-test -o '-p 5433 -k /var/lib/postgresql -c listen_addresses=127.0.0.1' -l ~/neolib-test.log -w start"` |
| Run the app with fakes | `AI_FAKE=1 npm run dev` (fake Claude, voice, transcripts, image search and generation) |

## 3. M10 (a): reading stats, in progress

> **Update 2026-10-04 (laptop session): M10 is done.** (a) was merged as PR #34,
> (b) as #35 and (c) as #36; `docs/done.md` ticks M10. The patch described
> below no longer exists. Skip to §4 for M11; `PROGRESS.md` has the details.

**What the patch contains** (`docs/handoff/m10a-reading-stats-wip.patch`):

- `db/migrations/0016_reading_sessions.{up,down}.sql` and the
  `readingSessions` table in `lib/db/schema.ts`.
- `lib/library/reading-stats.ts`:
  - `recordReading` stores a sitting. It is an upsert by session id: totals
    only grow (`greatest`), unbelievable numbers are capped, and the sitting
    must be the reader's own book.
  - `wordsPerMinute` and `statsByBook` compute the numbers.
- `lib/library/reading-stats.test.ts` (passing), plus additions to
  `lib/library/export.ts` and its test (sessions in the export round trip,
  passing).
- `app/api/books/[id]/reading/route.ts` (POST running totals).
- `app/(reader)/books/[id]/read/useReadingTracker.ts`, wired into `Reader.tsx`.
  - Active time counts only when the tab is visible, there was input or a
    page turn within the last 2 minutes, and read-aloud is not playing.
  - Words are those on each page seen, keyed by the page's start CFI.
  - It sends totals every 30 s and on hide or leave.
- `app/(app)/stats/page.tsx` (`/stats`: time, words and words per minute by
  book), linked from the shelf footer. It is added to `e2e/pages.ts`, with new
  reference screenshots `e2e/__screenshots__/stats-*`.
- `e2e/stats.spec.ts` (project `stats`): a scripted session with
  `page.clock`:
  1. one minute on page 1, turn the page, one minute on page 2;
  2. then five idle minutes. Expected: about 180 active seconds, 2 pages,
     words = words of page 1 + page 2;
  3. `/stats` shows `round(words / minutes)`.

**Status at handoff:**
- The unit tests pass.
- The first Playwright run failed only on `words` (517 counted, against the
  sum of the two pages). Likely cause: foliate reports the first page again
  once layout settles, and the tracker kept the first, smaller count.
- Fix applied in the patch: overwrite a page's count with the latest report.
- **Confirmed before the handoff push (2026-10-04)**, with the patch applied:
  `npx playwright test` reported `148 passed (3.1m)`, the stats test
  included; `npm run check` reported `Tests 212 passed | 2 skipped (214)`
  with lint and typecheck clean. The patch applies cleanly to this branch
  (`git apply --check` passed).

**To finish M10 (a):**
1. Start a branch `m10-reading-stats` from `main` (after the M9 (c) + handoff PR merges),
   then `git apply docs/handoff/m10a-reading-stats-wip.patch` and
   `git rm docs/handoff/m10a-reading-stats-wip.patch` in the same PR.
2. Re-run `npm run check` and `npx playwright test` (both were green).
3. Check `e2e/__screenshots__/stats-*` by eye.
4. Write the Log entry and open the PR.

**Then M10 (b) and (c)** (from `PROGRESS.md`):
- **(b)** `/stats` grows your own trend first:
  - speed by book, by pillar, and N vs E books (from the Path's slots), and
    time read per week;
  - a published adult average only with a cited source on the page; if no
    source can be verified, leave it out and say so.
- **(c)** Simple, honest suggestions from per-chapter speed (needs words and
  time per chapter: extend the sitting with the chapter of each page, or a
  second table), e.g. "your speed drops sharply in chapter 4; try the
  prerequisites panel".
- Then tick M10.

## 4. Plans for the rest

> **Update 2026-10-04 (laptop session): M11 is done and deployed** (PRs #38,
> #39, #40: tokens on the Agent access page, the agent API under
> `/api/agent/*`, the MCP server at `/api/agent/mcp`). M12 (a) (installable,
> downloaded books open offline) is in progress; see `PROGRESS.md`. Read the
> Playwright offline gotcha in its Log before testing anything offline.

**M11 · Agents can use it** (plan: "a test agent, using a token, lists books
and adds a note that shows up in the reader"):
- (a) **Personal API tokens.** A `api_tokens` table holding a sha256 hash of
  each token, a name, created, last used and revoked dates (migration with a
  reverse step). Create and revoke them on a new settings page, or on `/data`.
  Show the token once. Check `Authorization: Bearer` in a small helper used by
  the `/api/agent/*` routes. An agent sees only what its user sees: reuse the
  owner checks in `lib/library/*`.
- (b) **Agent API:** list books, search text (`searchLibrary`), read notes
  (`listAnnotations`), add a note (`createAnnotation`).
- (c) **MCP server.** Use the official TypeScript SDK
  (`@modelcontextprotocol/sdk`); check its current API when building. Run it
  either as a route (Streamable HTTP transport, e.g. `/api/mcp`) or as a small
  stdio script that calls the agent API with a token. Tools: `list_books`,
  `search_text`, `get_notes`, `add_note`.
- Playwright: make a token in the UI, call the MCP tools with an MCP client
  in the test, then open the reader and see the note.
- Remember the CSP and the auth gate in `proxy.ts`: agent routes must accept
  Bearer tokens and not redirect to sign-in.

**M12 · Read anywhere (offline)** (plan: with the network off, a downloaded
book opens and a new highlight is saved, then appears on the server when the
network returns):
- A PWA: a web app manifest and a service worker.
  - Write a small hand-made worker in `public/`. Check whether Next 16 has a
    recommended way first; avoid heavy plugins.
  - The worker's script must be allowed by the CSP: same origin, and the
    nonce does not apply to workers.
- "Download for offline" on the book page: cache the book file (signed URL,
  so cache by key, not by the URL with `exp`/`sig`), the reader page, and the
  fonts.
- **Offline notes:** an outbox in IndexedDB. Annotations are append-only with
  client-chosen ids (`createAnnotation` already accepts an `id`), so syncing
  is "send what the server does not have". This is ground rule 9 paying off.
- Playwright: `context.setOffline(true)`, open the book, highlight, then
  `setOffline(false)` and check the server has the highlight.

**Live checks** (`docs/done.md` "Live" list), from the laptop:
- `/api/health` and `/sign-in` on the Railway URL.
- Samuel creates the owner account at `/setup` and invites someone.
- One real Claude call per M6 feature.
- One real ElevenLabs narration; Commons search and OpenAI pictures on the
  live site.
- Samuel's verdicts for M4 and M6.
- Set the price settings: `ELEVENLABS_USD_PER_1K_CHARS`,
  `ELEVENLABS_STT_USD_PER_HOUR`, `OPENAI_IMAGE_USD`.

## 5. Lessons learnt and gotchas

**Production vs tests**
- **PGlite is not production.** Production uses postgres.js. It refuses a raw
  `BEGIN … COMMIT` on a pool (`UNSAFE_TRANSACTION`), which made every live page
  a 500 (fixed in #29). Run `npm run test:postgres` for anything touching
  migrations or SQL. CI now does it (job "Real Postgres", PR #32).
- **Migrations:** every one needs a `.down.sql`, tested by `migrate.test.ts`
  (up, down, up). When a down step would lose data, convert it instead: voice
  notes become text notes, stickers become highlights, drawings and pictures
  become notes naming them. Extending a CHECK means
  `DROP CONSTRAINT annotations_kind_check` and adding it again; Postgres names
  inline checks `<table>_<column>_check`.
- **Next.js route files may only export route handlers.** Helpers such as
  `byteRange` go in `lib/`, or the build fails.
- **Serve byte ranges for media.** Without `Accept-Ranges`/206, Chromium
  sometimes treats audio as an endless stream: duration is Infinity and
  seeking breaks. It made a test flaky (about 1 in 3) until
  `lib/http-range.ts` was added.

**Browser tests**
- Playwright projects run in a chain (setup → looks → flows → uploads → reader
  → annotations → ai → audio → notes → images → stats). Each builds on data
  from the earlier ones, and the database is fresh per run. `--no-deps` will
  not work on its own. Tests inside a file that depend on each other need
  `test.describe.configure({ mode: "serial" })`.
- `browser.newContext()` inside a test inherits the project's `storageState`.
  For a signed-out context pass `{ storageState: { cookies: [], origins: [] } }`.
- foliate's shadow DOM is closed. Reach the book text with
  `document.querySelector('foliate-view').renderer.getContents()[i].doc`; the
  visible range is `view.lastLocation.range`. Compare positions with foliate's
  `CFI.compare`/`collapse`, never as strings. The reader opens at a
  paragraph's CFI, not at a bare chapter CFI (`epubcfi(/6/14)` puts the
  reader in an error state).
- A "negative" test page may legitimately match: the "rugged countenance"
  page mentions Utterson and the lawyer too. Use invented text for "no match".
- Controlled UI state: a checkbox or button whose state only changes after a
  server reply fails `locator.check()`. Update the state at once, then take
  the server's answer.
- **Fonts and glyphs:** `lib/glyphs.test.ts` fails on any character outside
  the bundled fonts' Latin subset, comments included. "→" in code comments
  broke it three times; write "returns". Monospace `<code>` uses a system
  font; prefer the bundled sans in screenshotted pages.
- **Contrast:** dark-mode `--accent` text on `--paper-raised` is 4.42:1, under
  the 4.5 minimum. Links on raised panels use `--ink-900` with an accent
  underline. axe checks need the panel open and scrolled.
- **Look by eye.** Problems caught only in screenshots:
  - the phone top bar overflowing, and the title vanishing;
  - the close button wrapping;
  - sticker badges covering words: the overlay's rects are the selection's,
    not the line's. `drawBadge` in `Reader.tsx` finds the line start from
    the paragraph and puts badges in the margins: stickers on the left,
    drawings and pictures on the right;
  - the foliate overlay clips about 24 px into the margin, so there is room
    for one badge per side.
- Reference screenshots (`e2e/__screenshots__`) change whenever a page in
  `e2e/pages.ts` changes. Regenerate with `--update-snapshots`, check exactly
  which files changed, and look at them. Never show changing data (month
  names, dates) on those pages.
- The PR screenshot grid shows any `screenshots/<name>-<desktop|phone>-<light|dark>.png`.

**Process**
- Network from the cloud container: npm and GitHub work. Anthropic,
  ElevenLabs, Wikimedia, OpenAI and the Railway site are blocked. So
  adapters are written from the official SDKs' type definitions (in
  `node_modules`) and tested with a stand-in `fetch`. ElevenLabs and OpenAI
  SDKs accept `fetch`; Anthropic accepts `fetch`.
- Current model/API facts used (check again when they matter):
  - **Claude:** `claude-opus-5-5`, with adaptive thinking, `output_config.effort`
    and `output_config.format` for JSON. Server-side fallbacks use beta
    `server-side-fallback-2026-07-01` with `fallbacks: "default"`.
  - **ElevenLabs:** `eleven_multilingual_v2` through `convertWithTimestamps`;
    speech-to-text `scribe_v2`.
  - **OpenAI images:** `gpt-image-2`.
  - **Wikimedia:** the MediaWiki API needs a descriptive User-Agent.
- Issues and PRs share numbers. Do not guess the next PR number (one guess
  subscribed to Samuel's PR #29 by mistake). Read it from the
  `create_pull_request` result.
- When another session's PR (e.g. #29) and yours both add a Log entry, the
  second to merge conflicts in `PROGRESS.md`. Rebase and keep both entries,
  newest first.
- Never put model identifiers in commits or PRs (session rule). The app's
  own model constant in `lib/ai/claude.ts` is code and is fine.
- Costs are the app's own estimates and price settings, not invoices. Every
  paid call goes through `checkCaps` (`lib/ai/generate.ts`, per provider:
  AI_, VOICE_, IMAGE_ caps). Stored answers are always re-served free.

## 6. Waiting on Samuel (summary; details in PROGRESS.md)

1. Give Railway's GitHub app access to `sahuno/neolibrary` (auto-deploy).
2. Create the owner account at https://web-production-f27a0e.up.railway.app/setup.
3. Add `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` on Railway `web`, and set the
   price settings (`ELEVENLABS_USD_PER_1K_CHARS`, `ELEVENLABS_STT_USD_PER_HOUR`,
   `OPENAI_IMAGE_USD`).
4. Verdicts: M4 (reader), M6 (AI tools), M7 (voice and highlight).
