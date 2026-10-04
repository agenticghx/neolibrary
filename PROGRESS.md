---
project: Neolibrary
status: active
owner: Samuel Ahuno
team: Claude cloud sessions (builders)
next_action: Samuel creates the Claude cloud environment and adds design refs; then a cloud session starts M1.
blockers: Claude cloud environment not set up yet (M0).
updated: 2026-10-03
shared_copy: none
---

# Neolibrary

A private, beautiful web library for independent study: Samuel's own ebooks
on a shelf, read and listen together, with AI help on every section
(rewrites, prerequisites, question banks, images), open only to invited
people. Goals are in `docs/vision.md`; the milestone plan is in `docs/plan.md`.
"Done" for version 1 means milestones M1 to M12 in the plan are merged and deployed.

## Exact next steps

1. ~~Put the project on GitHub as a private repo~~ (done 2026-10-03:
   `github.com/sahuno/neolibrary`).
2. ~~Railway~~ (done 2026-10-03): project `neolibrary`
   (https://railway.com/project/25f1488d-3bb6-401c-9b6b-35d08bd93756) with
   `Postgres`, bucket `neolibrary-files` (US East), and an empty service `web`
   that already has `DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`,
   `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_URL_STYLE`,
   `ELEVENLABS_API_KEY`. The app must use exactly these names.
3. **(Samuel)** Still to do:
   - Create a Claude cloud environment for `sahuno/neolibrary`. Tests use
     fakes, so it needs no keys at first.
   - Put 5–10 screenshots you love and 3 you dislike in `docs/design/refs/`
     (Codex prototypes in `docs/design/prototypes/` are proposals to react to).
4. **(Samuel, later)** `ANTHROPIC_API_KEY` on Railway `web` before M6;
   `OPENAI_API_KEY` before M9. Not needed to start.
5. **(Cloud session)** M1 in `docs/plan.md`: Next.js skeleton, tests, CI,
   `docs/design.md`, deploy. Connect the repo to the Railway `web` service
   only once the app builds (connecting earlier makes every push a failed
   build). After M1 merges: turn on branch protection for `main`.
6. **(Cloud session)** M2: invite-only accounts.

## Open unknowns

| # | Question | Owner | Decide by | Status |
|---|---|---|---|---|
| 1 | Spending cap per month for Claude + ElevenLabs + OpenAI + Railway? (Default applies until set: sessions add a cost counter in M6/M7 and stop generating audio/images above a limit Samuel sets in an environment variable.) | Samuel | before M6 | open |

## Decisions

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
