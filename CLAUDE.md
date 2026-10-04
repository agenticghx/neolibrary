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
2. Read the milestone you are working on in `docs/plan.md`, and
   `docs/design.md` once it exists.
3. If a step is blocked on a decision only Samuel can make, add it to
   `## Open unknowns` with a decide-by date, then pick the next step that is
   not blocked.

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
  keys in tests; never raise a spending cap yourself.
- Follow ground rules 1–9 in `docs/plan.md` (DRM-free files only, anchors
  with quoted text, provenance on AI output, export round-trip tests,
  spending caps, notes never overwritten).
- Keep each PR to one milestone step. Small PRs get reviewed; big ones don't.
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

Cloud sessions do not have the laptop's `ledger-append` tool, so edit
`PROGRESS.md` by hand:

1. Add an entry at the top of `## Log` with the five fields: Done, Key paths,
   Commands that worked, Known issues / blockers, Exact next steps.
2. Rewrite `## Exact next steps` so the next session can start immediately.
3. Update `updated` and `next_action` in the header.
4. Commit `PROGRESS.md` on the same branch as the work.
