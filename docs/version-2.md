# Version 2: the goal

Written for: Samuel, and every Claude session that decides what to build next.
Written 2026-11-10 by the session Samuel handed the codebase to ("this
codebase is yours: what it's for and how it's built are your call"). He can
overrule any line of it.

## Why this page exists

Version 1 was milestones M1 to M12 (`docs/done.md`). It was finished in
October. Since then the plan has grown to M43, one request at a time: X-ray,
papers, genealogy, e-ink, the open shelf. Each was worth building. But nothing
said what the whole thing is for now, so nothing said what to finish first or
what to leave out. This page says it.

## What Neolibrary is

A study reader for one serious reader and a few invited guests.

Samuel reads hard books outside his field, mostly on an iPad. The library
exists so that reading one of them ends with understanding he keeps: he reads
or listens, marks what matters, asks when he is lost, and is asked again later
so it stays.

It is not a public product, a bookshop, or a general AI chat. A feature
belongs if it helps one of five things: **read, listen, note, understand,
remember**. If it helps none, it waits.

## Version 2 is done when

Each line has a check a session can run. "Done" means the check passes on
main and the result is pasted in the ledger.

1. **Nothing a reader writes is lost or shown to someone else.** Every way of
   saving a note, highlight, drawing or recording does one of three things:
   saves, waits on the device where the reader can see it, or says it failed
   and keeps the words. Check: a browser test for each save path with the
   library answering an error.
2. **It works where it is read.** Every change the reader can see is checked
   on the live site in the iPad's browser engine (WebKit) at iPad size, and in
   the e-ink mode once the Boox arrives. The open shelf shows every cover
   within 5 seconds there (2026-11-10: about 30). Check: the live check's
   output in the pull request.
3. **Offline is trustworthy.** A downloaded book opens with no network after
   any number of deploys, and nothing of one reader's stays readable or
   sendable by the next person on the device once they are online. Check: the
   offline browser tests.
4. **Money is bounded.** Every paid call is counted against the spending cap,
   including one that failed after it was billed. Every upload has a ceiling.
   No script spends or touches the live database unless asked by name.
   Check: unit tests for the cap and the ceilings.
5. **The reader page can be changed safely.** `Reader.tsx` is under 1,500
   lines (2026-11-10: 3,271), with notes, focus, reading aloud and full
   screen each in their own file. "May this reader see this book" is decided
   in one place. Check: `wc -l`, and one function that every book lookup
   calls.
6. **The loop is fast.** A pull request's checks finish in 12 minutes or less
   (2026-11-10: about 20, down from 25). A session reads at most 400 lines
   before it can start work (2026-11-10: about 10,000 across the ledger, the
   learning log, the plan and the handoff). Check: CI's times; line counts of
   what `CLAUDE.md` tells a session to read.
7. **The audit list is empty.** Every item of the 2026-11-09 audit and the
   2026-11-10 sweep is fixed, or dropped with a one-line reason in the
   ledger's Decisions.

## The rule while version 2 is open

Lines 1 to 4 come before any new feature, because each is about losing a
reader's work, privacy or money. A feature Samuel asks for by name is still
built: it goes in `docs/plan.md` as usual, says which of the five things it
helps, and takes its turn after any open item under lines 1 to 4.

## What is left out, on purpose

- Sign-up for the public, payments, and anything that needs moderation.
- A native app. The site in a browser, installed to the home screen, is the app.
- More kinds of AI answer before the present ones are checked by eye on
  Samuel's real books (the standing verdicts under "Waiting on Samuel").

## Where it stands (2026-11-11)

| Line | State |
|---|---|
| 1. Nothing lost or leaked | Recounted on 2026-11-11 by listing every place a page sends a note or a recording. Each of these now has a browser test with the library answering an error: a note on a passage, a note about the book, a sticker, a bookmark, an edited note, a removal and its Undo, a drawing, a voice note on a passage, Explain it back by voice, a pinned picture, a note on a Path. The recount found three that said nothing or lost the words, now fixed: a failed bookmark and a failed removal showed nothing, and a failed note on a Path replaced the page with "This page couldn't load" and lost the words. Earlier: #330, #332, #334, #350. Not tested separately: Think aloud in the mini-player (it uses the same recorder as a voice note). Recounted on 2026-11-14: a rating in Review, an answer typed in "Where were we?" and a question in Ask each already said so and kept the words or the card when the library refused; each now has a browser test with the library answering an error. A Path note's Remove button replaced the page with "This page couldn't load" when the library refused (shown by its test on the old code); now it says "Not removed" beside the note, which stays listed. None left that the recount found. |
| 2. Works where it is read | The rule is written (2026-11-11): `CLAUDE.md` asks for `scripts/live-webkit-check.mjs` on the live site after every change a reader sees, its output pasted in the pull request or the Log. Not yet done: the e-ink mode on the Boox (not arrived). Covers: the 5-second target is met from the laptop's network (2026-11-11). All 129 covers on the live open shelf, signed out, at iPad size, in WebKit: 43 to 46 s on 2026-11-10; 12.1 s once covers were kept in the server's memory (#347); 2.5 to 3.5 s once the page stopped sending a "Link" header that made WebKit fetch pictures two at a time (#348) and the server read every cover into memory at start (#349), also straight after a deploy and after a quiet spell. Real Safari in Xcode's iPad simulator: the cover requests reach the server within 1.2 s (12.1 s before). Not yet timed on the real iPad. The time depends on the connection: the covers are 4.7 MB in all, and on a laptop connection that measured 1 MB a second the same check took 10 to 16 s with 100 covers fetched at once. |
| 3. Offline | Done (#330, #331); the signed-in live check of download-then-offline is still to do. 2026-11-14: a signed-out page removed downloaded books only once the app's scripts had loaded and run, which on a slow connection can be seconds; now a small script written into the page removes them as the page loads (#359; tested with the app's scripts held back; on the live site in WebKit and Chromium, 2 to 24 ms). The test's failures on CI had another cause, the visitor limit answering 429 (docs/ci-flakes.md). |
| 4. Money | Done: scripts (#333); a billed AI answer that fails now counts against the cap, and read-along audio has one ceiling per reader (migration 0040, #337, live). Nothing known is left: the Batch API path for scanned pages was listed here as not recording a billed failure, but it has done so since #186 (a declined, cut-off or empty page that was billed is stored and counted toward the limits; `lib/library/text-edition.test.ts`, "counts a page Claude declined but was billed for"). Found by the audit recount (2026-11-14) and fixed: typing a percentage in Rewrite asked for a rewrite at each key (typing "85" asked for STE light, then STE: two requests, the first paid for unless already saved); it now asks once, on Enter or on leaving the box. |
| 5. Reader page | `Reader.tsx` is under 1,500 lines (#336, #338 to #343, and the full-screen cut), with notes, focus, reading aloud, the ruler and full screen each in their own file. Ownership ("this book, of this reader, not removed") is one function, `isOwnBook`, called by 44 single-book lookups; 7 lookups stay by hand, each with its reason in `lib/library/own-book.test.ts`, which fails on a new one (#344, #345). Not under it: lists of books, raw SQL, and the rules for visitors and shared papers. |
| 6. The loop | CI's unit tests 815 s to 236 s (#329). Reading at the start of a session (2026-11-11): `CLAUDE.md` now asks for `PROGRESS.md` and this page only: 363 lines, about 14,000 words (the ledger's lines are long). Before, the same rule asked for `PROGRESS.md`, `docs/handoff.md`, `docs/done.md` and this page: 5,694 lines, about 196,000 words. (The 10,000 lines above also counted the learning log and the plan, which are not read at the start.) The ledger's older Log entries are in `docs/ledger-archive/`. Pull request checks, measured on #352 (2026-11-11): 16.6 minutes from start to the last check; the browser tests themselves 12.7 minutes on the slowest machine, and 152 s publishing screenshots (it downloaded every earlier pull request's pictures; changed to download none). After #353 the publish step takes 12 to 15 s and the last job 30 s. The slowest machine's tests are now divided between two machines ("behavior" and "behavior-2"); measured on #354 (2026-11-11, machines at normal speed): 12.0 minutes from start to the last check (16.6 on #352); browser test steps 641 s and 546 s for the two halves (the second without the screenshot tests), 592 s for read-along, 396 s for the branches. At the line, not safely under it: a change to a page adds the screenshot tests (about a minute and a half), and main's run of the same code had the first half at 13.9 minutes. Each machine builds the site first (two to three minutes); building once for all would be the next step. |
| 7. Audit list | Recounted 2026-11-14 against main (each verdict checked in the code, not the ledger): 43 items, 12 fixed, 28 open, 3 that need one look at the live site or at Railway. The list names security weaknesses, so it stays on the laptop (Open unknowns row 35). Being fixed in version 2's order: money and privacy first. |
