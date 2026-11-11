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

## Where it stands (2026-11-10, evening)

| Line | State |
|---|---|
| 1. Nothing lost or leaked | Most paths done today (#330, #332, #334). Left: removing a sticker or drawing leaves its mark until reload; double-saved notes. |
| 2. Works where it is read | Not started as a rule. Covers, all 129 on the live open shelf, signed out, at iPad size, from the laptop's network: 43 to 46 s in WebKit on 2026-11-10; 12.1 s once covers were kept in the server's memory (#347); 3.2 to 3.5 s once the page stopped sending a "Link" header that made WebKit fetch pictures two at a time (#348, 2026-11-11). Real Safari in Xcode's iPad simulator: the cover requests reach the server within 1.5 s (12.1 s before). Still slow after #348: a visit that found the server's memory empty (after a deploy or ten quiet minutes) took about 30 s; the change that reads every cover into memory at start and keeps it there is to be measured live. Not yet timed on the real iPad. |
| 3. Offline | Done today (#330, #331); the signed-in live check of download-then-offline is still to do. |
| 4. Money | Done: scripts (#333); a billed AI answer that fails now counts against the cap, and read-along audio has one ceiling per reader (migration 0040, #337, live). Left: the Batch API path for scanned pages does not record a billed failure. |
| 5. Reader page | `Reader.tsx` is under 1,500 lines (#336, #338 to #343, and the full-screen cut), with notes, focus, reading aloud, the ruler and full screen each in their own file. Ownership ("this book, of this reader, not removed") is one function, `isOwnBook`, called by 44 single-book lookups; 7 lookups stay by hand, each with its reason in `lib/library/own-book.test.ts`, which fails on a new one (#344, #345). Not under it: lists of books, raw SQL, and the rules for visitors and shared papers. |
| 6. The loop | CI's unit tests 815 s to 236 s (#329). Reading load not started. |
| 7. Audit list | Open unknowns row 35. |
