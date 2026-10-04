---
project: Neolibrary
status: active
owner: Samuel Ahuno
team: Claude cloud sessions (builders)
next_action: Sessions loop through docs/done.md on their own; next is M2 (accounts).
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

1. **M2 · accounts** (first unticked box in `docs/done.md`). Plan: Postgres
   via Drizzle; tests on PGlite (Postgres compiled to run inside Node, so no
   database server is needed in tests or CI); invite-only email + password
   accounts (no email service needed); the first admin is created with a
   one-time setup code printed in the server log; sessions in a signed
   cookie; every page and API behind login; Playwright proves a logged-out
   visitor gets nothing.
2. Then M3, M4, … in order, per `docs/done.md`.

## Waiting on Samuel

Never blocks the loop. Newest first.

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
