# Instructions for every Claude session on Neolibrary

Written for: Claude sessions working on this repo (especially unattended
cloud sessions). Samuel is the owner: a scientist, not a software
engineer.

## Start of every session

1. Read `PROGRESS.md` and resume from "Exact next steps". Do not ask Samuel
   to repeat what it says. Read `docs/handoff.md` too: the plans for the
   remaining milestones, and the lessons and gotchas earlier sessions hit.
1a. Read `docs/done.md`: it defines when a milestone and version 1 are done,
   and the loop to follow. Samuel is not watching (2026-10-04): work alone,
   implement → verify → merge → loop, and never stop for something only
   Samuel can give; list it under "Waiting on Samuel" and move on.
2. Read the milestone you are working on in `docs/plan.md`, then its own
   build plan in `docs/` (named there, e.g. `docs/scan-to-text-plan.md`,
   `docs/focus-lock-plan.md`), and `docs/design.md`.
2a. Keep `LEARNING_LOG.md` at the repo root for every milestone (format and
   rules in `docs/m14-home-plan.md` §7): one entry per attempt, with its
   hypothesis, the signal, the result as measured, and the lesson. Commit it
   with each PR.
3. If a step is blocked on a decision only Samuel can make, add it to
   `## Open unknowns` with a decide-by date and a default, then pick the next
   step that is not blocked.
3a. **Seven-day defaults** (Samuel, 2026-11-01). An Open unknowns row whose
   default is in force, and that Samuel has not answered 7 days after it was
   written, is closed: set its status to "closed <date>: default stands (no
   answer in 7 days)" and add a line to `## Decisions` ending "· default
   stands". He can still overrule it later; that is a new decision. Never
   closed this way: questions about money (spending, prices, caps, who pays),
   keys, readers' privacy, or who gets access. Sweep the table at the start
   of every session that edits `PROGRESS.md`.
3b. **Small design choices: build the recommended option** (Samuel,
   2026-11-01). For a small choice (a label, an icon, where a button sits, a
   spacing or colour within the design tokens, the order of items in a
   menu), build the option you recommend, show it in the PR's screenshots,
   and say what the other options were in one line. Samuel overrules after,
   if he wants. Keep an options page (2-3 prototypes, desktop and phone, light and dark, as for M34's public showcase)
   only for big visual direction: a new page, the layout of Home or the
   reader, or the look of the whole site.

## While working

- Work on a branch named `m<N>-<short-topic>` (or the `claude/…` branch the
  cloud environment assigns, if it allows no other); never commit to `main`
  directly. Open a pull request when the step's "Done when" check passes.
- If the session cannot merge directly, the auto-merge Action (M1) merges
  once checks pass; your job is to make the checks honest.
- **You merge your own PR** (Samuel's decision, 2026-10-03), but only when all
  of these hold: every required check on GitHub is green; you did not skip,
  delete or weaken a test to get there; the PR description pastes the
  "Done when" evidence. If any fails, leave the PR open, say why in the
  PR and the ledger, and move on.
- Before merging a database migration, make sure it has a reverse step and
  that a backup is taken before it runs in production. Never put real API
  keys in tests; never raise a spending cap yourself. Never call ElevenLabs
  (or any paid voice) to narrate a whole book until Samuel explicitly says so
  (his rule, 2026-10-06): build and test whole-book narration with the fake
  voice only.
- Follow ground rules 1–9 in `docs/plan.md` (DRM-free files only, anchors
  with quoted text, provenance on AI output, export round-trip tests,
  spending caps, notes never overwritten).
- Keep each PR to one milestone step. Small PRs get reviewed; big ones don't.
- To merge PRs (one at a time, rebased onto main), refresh reference
  screenshots from CI, decide whether a red check is a flake, or deploy
  (its step 6), use the `merge-train` skill
  (`.claude/skills/merge-train/SKILL.md`); `docs/ci-flakes.md` lists the
  known flaky tests. Every other skill this project uses sits beside it in
  `.claude/skills/` (index and rules: `.claude/skills/README.md`):
  `scan-to-text`, `xray-on-subscription`, `readalong-audio`,
  `book-chapters`, `plain-english` and `simplified-technical-english`.
  Load the one that fits first.
- Before a PR: `npm run check` (lint, types, unit tests); `npm run
  test:postgres` when SQL or a migration changes; on a Mac, browser tests
  with `npx playwright test --ignore-snapshots` (reference images are Linux
  renders; the merge train refreshes them from CI). A browser test that
  fails on the Mac: load the `browser-test-triage` skill and run it in
  Playwright's Linux image on the branch and on main before calling it
  "Mac-only" or "fails on main too" (a Mac failure on main hid a real
  regression on 2026-11-01).
- Model work outside the app (reading scanned pages, building an X-ray,
  comparing models) runs with `claude -p` on Samuel's Claude subscription,
  not on an API key; when the subscription limit is hit, stop and wait for
  the reset rather than switching to a paid key.
- **Deploys happen on their own** (M40 S2, Samuel 2026-11-01):
  `.github/workflows/deploy.yml` deploys `main` after `main`'s CI passes,
  checks the live site, and writes each deploy on the open issue "Deploy
  log" (read it to know what is live). It refuses a database migration:
  that still needs a backup and Samuel's word, deployed from the laptop.
  Switch it off with the repository variable `AUTO_DEPLOY` (anything but
  "on"). A deploy made by hand from the laptop is recorded by pushing its
  ledger entry straight to `main`: a commit that changes only
  `PROGRESS.md`, on top of `origin/main` (a fast-forward, never a
  force-push); the steps are in the laptop's `CLAUDE.local.md`. Never open a
  PR only to record a deploy (each costs a CI round).
- `docs/handoffs/` (session handoff notes) and `docs/ideasFeaturesSelf.md`
  (Samuel's own notes) are gitignored on purpose: write there, never
  force-add them.
- Follow the ground rules in `docs/plan.md`: no copyrighted books and no
  secrets in git; every outside service (Claude, ElevenLabs, image search,
  storage) behind an interface with a fake used in tests.
- The look and feel is a requirement, not polish. Attach Playwright
  screenshots (phone and desktop, light and dark) to any PR that changes
  what the user sees.
- Do not invent numbers or claim "works". Paste the command you ran and its
  output (test results, screenshot paths, deployed URL).

## Writing for Samuel

PR descriptions, the ledger, docs and commit messages: plain English first,
and define jargon the first time you use it (e.g. "migration: a script that
changes the database layout"). Say who a document is written for.

## End of every session (no exceptions)

On the laptop, the `checkpoint` skill (save mode) writes the handoff note
in `docs/handoffs/` and the ledger entry. Cloud sessions do not have the
laptop's `ledger-append` tool, so edit `PROGRESS.md` by hand:

1. Add an entry at the top of `## Log` with the five fields: Done, Key paths,
   Commands that worked, Known issues / blockers, Exact next steps.
2. Rewrite `## Exact next steps` so the next session can start immediately.
3. Update `updated` and `next_action` in the header.
4. Commit `PROGRESS.md` on the same branch as the work.
