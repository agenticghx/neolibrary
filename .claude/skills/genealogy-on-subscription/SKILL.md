---
name: genealogy-on-subscription
description: Read a book in Samuel's Neolibrary for its genealogy (who founded, led, worked at, left, bought, funded or supplied whom; which company came out of which; each person's life in the order it happened), on his Claude subscription, on the laptop, every link checked against the book's words, and drawn as one private page with a family tree, three views inside a company and three views of one person. Use when Samuel wants the genealogy, family tree, org chart, "who came from where", lineage or a person's timeline of a book, or when the genealogy reading instructions change.
---

# Genealogy on the subscription

Written for Claude sessions working on Neolibrary (`agenticghx/neolibrary`, public). Samuel, the owner, is a scientist: tell him in plain English what was made, what was checked, and what is his to look at. The plan this belongs to is M43 in `docs/plan.md` and `docs/genealogy-plan.md`.

## What this makes

A **link** is one thing the book says between two named people or organisations: "Jerry Sanders founded AMD", "Intel spun out of Fairchild Semiconductor", "TSMC supplied Apple", "Poole worked for Henry Jekyll". This skill reads every link a book states, checks each against the book's own words, and draws them on one page (`genealogy.html`):

- **Family tree:** which organisation came out of which (spun out, bought, part of; dashed when a founder had worked at the older one).
- **Inside a company:** Power map (the company in the middle, people on the inner ring, other organisations on the outer ring), Money and parts (what comes in, what goes out, with the people inside), Who was there when (one row per name, a mark per chapter).
- **One person:** Storyline (one lane per organisation, the person's line moving between them, others at the same place beside them), Read vs happened (where the book tells each step against when it happened), List.
- A **Read up to chapter** slider hides everything after the reader's place; a setting chooses whose lives are rebuilt; years the book leaves out can be filled from general knowledge, always in purple.

Samuel chose to keep all of these views (2026-11-08).

## Rules that bound everything

- **Subscription only.** `claude -p`, never the API; the script removes `ANTHROPIC_API_KEY` from its environment. If the subscription limit is reached, stop and say so; never switch to the API.
- **Never edit an answer by hand.** Every answer is kept raw in the folder, and the checks in `lib/library/genealogy.ts` run again from the raw answers each time the page is built. A poor reading is read again (delete its file), never patched.
- **No book text in git or in a pull request.** The folder and the page quote the book: keep them in the session's scratchpad or `~/Documents/neolibrary-genealogy-<book>/`. Send the page to Samuel with SendUserFile, never publish it. Screenshots for a pull request come from a public-domain book (`fixtures/books/`).
- **Keys by name only.** `fetch` uses the owner's token, the Keychain item `NEOLIBRARY_AGENT_TOKEN`; run it through `zsh -ic '…'` so the login shell loads it. Never print it.
- **Nothing from outside the book, except one marked place.** Every link, year and order comes from the book and is checked. Only the sixth reading uses Claude's general knowledge, for years the book leaves out; the page draws those in purple and can hide them.

## The workflow

`S=scripts/genealogy-on-subscription.ts`; run from the repository root with `npx tsx`. `<folder>` is outside the repository.

1. **Get the book.** From the library: find its id (`zsh -ic 'curl -s -H "authorization: Bearer $NEOLIBRARY_AGENT_TOKEN" "<site>/api/agent/books?q=<title>"'`), then
   ```bash
   zsh -ic 'npx tsx scripts/genealogy-on-subscription.ts fetch <site> <book id> <folder>'
   ```
   A PDF with its own text (not a scan) works: `fetch` splits it as the site did at upload (`extractPdfSections`, so the same paragraph ids) into `<folder>/sections.json`, and its pages are read in groups of about 18,000 characters ("Pages 14–20", `numberChapters`); The Grid's 315 pages read as 41 chapters. A scanned PDF needs its text edition instead: pass the edition's book id (the `textEdition` of `GET /api/agent/books/<id>`), as for The Pay Off. A local EPUB works too: copy it to `<folder>/book.epub` and write `<folder>/meta.json` as `{"title": "…"}`.
2. **Try three chapters first** on a new kind of book, then look at what came out:
   ```bash
   npx tsx scripts/genealogy-on-subscription.ts read <folder> --chapters 3 && npx tsx scripts/genealogy-on-subscription.ts page <folder>
   ```
3. **Read the whole book**, in the background, watching its log. Chip War (58 sections, 54 chapters) took 7.5 minutes for all six readings (2026-11-08). A failed reading is listed and the run stops before the next stage; run the same command again and it carries on.
   ```bash
   npx tsx scripts/genealogy-on-subscription.ts read <folder> > <folder>.log 2>&1 &
   ```
   - `--model claude-sonnet-5-5` (default) for the five readings of the book; `--years-model claude-opus-5-5` (default) for years from general knowledge.
   - `--min-links 3` reads lives only for people the book links at least 3 times (fewer readings); the default reads everyone, so the page's setting works for all.
   - `--known <file>` gives names to use as written (one per line), such as the book's cast of characters.
4. **Build the page** and look at it yourself before sending it: `npx tsx scripts/genealogy-on-subscription.ts page <folder>`. Open the family tree of the most linked organisation, a power map and the storyline of the most linked person, on an iPad-sized window (Samuel reads on an iPad in Chrome, so WebKit).
5. **Send** `<folder>/genealogy.html` to Samuel with SendUserFile, saying it is private because it quotes the book.
5a. **Store it on the site** (M43 S2), so the app can show it:
   ```bash
   zsh -ic 'npx tsx scripts/genealogy-on-subscription.ts send <folder> <site> <book id>'
   ```
   The site checks every quote, year and order quote again against its own copy of the book and prints what it left out and why (nothing, for a book read from the file the site holds). The same send again changes nothing; a new one replaces the book's genealogy. `payload <folder>` writes what would be sent to `<folder>/send.json` without sending. The site refuses a send read with other instructions than its own `prompts/genealogy-*.md`: after a prompt change, deploy first. Once sent, Samuel reads it in the book's reader: Study > Genealogy (M43 S3), with the same seven views; the chapter numbers there are the page's (one rule, `numberChapters`).
6. **Record it in the ledger**: the book, the numbers `page` prints (links offered, quotes not found, second reading's counts, links shown, dated, lives), the time taken, and what was looked at by eye.

## The six readings and their checks

| Reading | Prompt | Per | Check (lib/library/genealogy.ts) |
|---|---|---|---|
| 1. Links | `genealogy-links` | chapter | `checkLinks`: relation from the list, quote found in its paragraph |
| 2. Names | `genealogy-names` | book | `readNames`: only names that were read; vague groups set aside |
| 3. Second reading | `genealogy-check` | chapter | `applyChecks`: a fix names the same two names and a listed relation |
| 4. Dates | `genealogy-dates` | chapter | `checkDates`: the words giving the year found in the paragraph named |
| 5. Lives | `genealogy-life` | person | `checkLife`: a year rests on a checked date; an order clue found in its paragraph |
| 6. Years outside the book | `genealogy-years` | person | `checkYears`: only events the book leaves undated; a stated confidence |

## What can go wrong

- **Every link in a chapter dropped**: look at the raw answer in `1-links/`. Twice in the prototype this was the checker, not the model (a paragraph number written as text; a second, corrected answer after the first). `lastObject` and `int` now handle both.
- **A correction made a link worse**: the second reading must write the corrected link out in full. A bare "reversed" verdict was ambiguous and turned true links round (Iteration 154).
- **"Micron bought Texas Instruments"**: buying a business from a company that goes on is `bought_part_of`, not `acquired`. A relation the list lacks is filled with the nearest wrong one: add it to the prompts and `RELATIONS`.
- **A novel gives few links**: the relations were made for careers and companies; friends, servants and family were added after the first run on Jekyll and Hyde. A book with other kinds of ties may need more.
- **Edition pages read as chapters**: imprint, colophon, contents, notes and the like are skipped by name (`BACK_MATTER`); a book that names them differently needs a pattern added.
