# What "done" means for Neolibrary version 1

Written for: Claude sessions working alone (no one is watching), and Samuel
when checking progress. Agreed 2026-10-04: Samuel set the goal and stepped
back; sessions implement, verify and loop until this file's checklist is
complete. `docs/plan.md` describes each milestone; this file decides when
one counts as finished.

## The goal

Version 1 is **done** when every box in the checklist below is ticked on
`main`, each tick backed by evidence pasted into the `PROGRESS.md` Log
(command + output, PR link, screenshot path or URL).

## When a milestone is done

A milestone (M1 to M12 in `docs/plan.md`) is done when **all** of these hold:

1. **Built.** Every bullet in its plan section is implemented, or the bullet
   is explicitly moved to "Later" in `docs/plan.md` with a one-line reason
   in the Log (allowed only for nice-to-haves, never for a "Done when" item).
2. **Proved by tests.** Each sentence of its "Done when" has an automated
   test (Vitest or Playwright) that runs in CI. Tests use fakes for every
   paid or outside service (ground rule 3) and public-domain fixture books
   (ground rule 1).
3. **Merged green.** Its PRs are merged to `main` with every CI check
   passing on the PR's last commit; no test was skipped, deleted or
   weakened to get there.
4. **Looks right.** Every new page is in `e2e/pages.ts`, so it has reference
   screenshots (phone and desktop, light and dark) and passes the axe-core
   accessibility check. New styles use design tokens only.
5. **Ground rules kept.** Anything it adds that stores user data has an
   exporter and an export → wipe → import test (rule 7); AI output stores
   provenance (rule 5); annotations are never overwritten (rule 9); paid
   calls are behind a spending cap (rule 8).
6. **Recorded.** A Log entry in `PROGRESS.md` with the evidence, and the
   checklist below ticked.

## What needs a person, and how sessions handle it

Some checks can only be done by Samuel or need something only Samuel can
give. **These never block the loop.** A session builds and tests everything
around them with fakes, lists what is waiting under "Waiting on Samuel" in
`PROGRESS.md` (newest first, each with the exact steps), and moves on to
the next milestone.

| Waiting item | Needed for | Until it arrives |
|---|---|---|
| Connect the repo to Railway `web` and generate a domain | live deploy (M1 onward) | everything is tested in CI; the "live" boxes stay open |
| `ANTHROPIC_API_KEY` on Railway | real Claude calls (M6, M11) | fake Claude in all tests |
| `OPENAI_API_KEY` on Railway | image generation (M9) | fake image provider |
| Spending caps (open unknown 1) | M6, M7, M9 | built-in defaults: $5 per book, $20 per month per provider, set by environment variables |
| Real-book verdicts (M4, M6) | Samuel's taste | recorded as "awaiting verdict"; not blocking |
| Branch protection on `main` | a second lock on merging | auto-merge already waits for green CI |

Version 1 is **"done (built)"** when every milestone box is ticked, and
**"done (live)"** when the live boxes are ticked too. Sessions aim for
"done (built)" on their own; "done (live)" needs the waiting items.

## Checklist

Milestone boxes: tick when the milestone meets every point in "When a
milestone is done". Live boxes: tick when the check passes against the
deployed Railway URL.

- [x] **M1** Skeleton, design system, CI, screenshot grid, auto-merge (PRs #1, #2)
- [x] **M2** Invite-only accounts; a logged-out visitor gets nothing (pages, API, files)
- [x] **M3** Bookshelf + study Paths; Hidden Machinery Path seeded; upload attaches to a wanted book (PRs #5, #6, #7)
- [x] **M4** Reader, section model with stable ids, reopen at the same spot, full-text search (PRs #8–#11; real-book verdict awaiting Samuel)
- [x] **M5** Highlights, bookmarks, notes; Markdown + W3C export; export → wipe → import identical (PRs #12–#14)
- [x] **M6** Rewrite with versions + provenance, STE mode with TypeScript checker matching `ste_check.py`, prerequisites, question bank, cross-book links (fake Claude) (PRs #15–#21)
- [x] **M7** Provider-neutral audio tracks, word highlight follows timings, cost estimate + caps (fake voice) (PRs #22–#24)
- [x] **M8** Voice notes with transcripts, stickers, handwriting saved and redrawn (PRs #25–#27)
- [x] **M9** Wikimedia image search + generated-image fallback, pinned image cards (fakes) (PRs #28, #30 and the M9 (c) PR)
- [x] **M10** Reading time and words-per-minute from a scripted session; own trends; per-chapter suggestions (PRs #34, #35 and the M10 (c) PR)
- [x] **M11** Token-protected API + MCP server; a test agent lists books and adds a note (PRs #38, #39 and the M11 (c) PR)
- [x] **M12** Installable offline app; offline highlight syncs when the network returns (PR #41 and the M12 (b) PR)

Live (needs the waiting items):

- [ ] Railway URL serves `/api/health` and `/sign-in`
- [ ] Samuel can sign in on the live site and invite someone
- [ ] One real Claude call per M6 feature pasted into the Log
- [ ] One real section narrated by ElevenLabs and played on the live site
- [ ] Real-book verdicts for M4 and M6 recorded

## The loop every session follows

1. Read `PROGRESS.md` → "Exact next steps", then this checklist; pick the
   first unticked milestone (or the next step inside it).
2. Make the smallest PR that moves it forward (one milestone step).
3. Verify locally: `npm run check` and `npx playwright test`; read your own
   diff for anything CI would reject.
4. Push, open the PR, wait for CI. Red → find the root cause, fix, push again.
   Green → merge (the auto-merge Action also does this).
5. Write the Log entry, update "Exact next steps", tick boxes earned.
6. Go back to 1. Stop only when the checklist is complete, or every
   remaining step is waiting on Samuel; then say so plainly at the top of
   `PROGRESS.md`.
