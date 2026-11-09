# M43 · Genealogy: who came from where, in any book

Written for Samuel and for the Claude sessions that build it. Samuel asked
(2026-11-08): "when reading a book we navigate genealogy and organization
chart, for example in Chip War, Fairchild, AMD and TSMC. Should we start with
making a skill to take a book and generate all possible genealogy mentioned?"
The answer was yes: the reading is the hard part, and the pictures are cheap
once the links exist. A prototype on Chip War (laptop only, not in git, since it
quotes the book) settled the design; Samuel looked at each view and chose to
keep all of them.

## Words used here

- **Link**: one thing the book says between two named people or
  organisations, with the paragraph and the quote it rests on ("Jerry Sanders
  founded AMD").
- **Second reading**: Claude reads each link again against its paragraph and
  keeps it, corrects it, or removes it. A real quote can still be read wrongly
  (the first reading said "AT&T is part of Bell Labs").
- **Life event**: one job, founding, leadership or departure, however many
  times the book repeats it, placed in the order it happened.
- **General knowledge**: years Claude knows that the book does not give. Kept
  apart, drawn in purple, never mixed with the book's own.

## What the prototype showed (Chip War, 54 chapters)

- 457 links offered, every quote found in the book; the second reading kept
  376, corrected 29 and removed 47. Fixes it made: AT&T and Bell Labs the right
  way round; "Micron bought part of Texas Instruments" (a new relation).
- The book dates few events: 107 of 405 links got a year from the book. A
  person-by-person reading turned 211 links into life events: 63 dated by the
  book, 15 worked out from its dates, 91 placed by a quoted order clue.
  General knowledge filled 104 more years (65 high confidence).
- Three views per question were drawn; Samuel kept them all: Family tree;
  Inside a company (Power map, Money and parts, Who was there when); One person
  (Storyline, Read vs happened, List).
- The faults found on the way are Iterations 153 to 158 of `LEARNING_LOG.md`.

## Steps

- **S1 · The skill.** `.claude/skills/genealogy-on-subscription/SKILL.md`,
  `scripts/genealogy-on-subscription.ts` (fetch, read, page, status), six
  prompts `prompts/genealogy-*.md`, the checks in `lib/library/genealogy.ts`
  with unit tests, and the page template `scripts/genealogy-page.html`. Runs on
  the owner's subscription for any EPUB in the library and ends at a private
  page on the laptop. *Done when:* `npm run check` passes with the checks'
  tests; the skill runs end to end on a public-domain fixture (Jekyll and Hyde)
  and on Chip War from the library, and both pages work in WebKit at iPad and
  phone size.
- **S2 · Links stored on the site.** A table for links (and life events)
  keyed to the book's paragraphs and, where it has one, the X-ray's entries,
  with the generation each came from (ground rule 5), exported and imported
  like every other kind of data (rule 7). An agent endpoint takes the skill's
  checked answers, as the X-ray's does, and checks them again on the server.
  Needs a migration (with its reverse step and a backup before it runs).
  *Done when:* a send from the skill stores a book's links, a second send
  changes nothing, and the export-wipe-import test brings them back.
- **S3 · The views in Study.** A Genealogy tab beside Who & what, with the
  three questions and their views as in the prototype, the reader's place as
  the slider, and a name in the X-ray card opening its family tree or life.
  *Done when:* browser tests open each view on a fixture book, the slider hides
  later chapters, and screenshots (phone and desktop, light and dark) are in
  the pull request.
- **S4 · Across books.** One person or company across every book that links
  them (Chip War, The Grid and The Pay Off overlap). *Done when:* decided with
  Samuel after S3 is in use.

## Decisions

- General-knowledge years appear in the app too, drawn in purple and
  switchable ("Leave blank"), never mixed with the book's own years (Samuel,
  2026-11-08: "go ahead with your recommendation"). S2 keeps them in their own
  columns (`gk_start_year`, `gk_end_year`, `gk_confidence`, `gk_note`).

## Status

- S1 merged and live (#310, 218147c).
- S2: links and life events stored on the site (`db/migrations/0039_genealogy`,
  `lib/library/genealogy-store.ts`, `POST /api/agent/books/<id>/genealogy`,
  `send` in the skill's script), in export and import. Merged and live
  (#311, 171a544).
- S3: the Genealogy tab in Study (`GenealogyPanel.tsx`), whose three
  questions open the seven views over the whole page (`GenealogyView.tsx`,
  `genealogy-views.ts`, from `GET /api/books/<id>/genealogy`,
  `lib/library/genealogy-view.ts`). The slider starts at the reader's
  chapter; every quote can turn the page to where the book says it.
  Chapters are numbered by one rule for the skill and the site
  (`numberChapters` in `lib/library/genealogy.ts`).
  - Known trade-off: the drawing code now lives twice, in the app and in the
    laptop page (`scripts/genealogy-page.html`). A change to a view belongs in
    both until the laptop page reads the app's module.
  - Merged and live (#312, ffc92bf).
  - A name in the X-ray card (Who & what, and the card over the page) opens
    its family tree, its company view or its life, when the genealogy has it
    (`matchGenealogyName` in `lib/library/genealogy-names.ts`: exact spelling,
    else a person's surname or the first words of a company's name).

## Open questions

- Whether a founder's every past employer counts as a parent in the family
  tree (now drawn dashed), or only the one they left to found it.
