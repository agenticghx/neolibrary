# X-ray for books: what it could be, and how it would be built

Written for Samuel, 2026-10-22, before any milestone is planned. A second
reader is the session that turns the chosen parts into a plan. Nothing here
is built; it is a ranked set of ideas with the choices they force.

**Prototype (2026-10-22):** a live page on *Jekyll and Hyde*, four A/B/C
choices and a reader where the cards know where you are:
https://claude.ai/artifact/PdnTUfLHeKJa8oyLBNEUuW (private; Samuel only). Its source is in
`docs/design/prototypes/xray/`.

## What "X-ray" means

Kindle's X-Ray is a panel behind a book: the people, places and terms in it,
each with a short description and a bar showing where in the book it comes
up. Tap a name on the page and a card tells you who that is. Prime Video's
version is better still: pause a film and it shows who is on screen *right
now*. That is the part worth copying: an X-ray that knows where you are.

"X-Ray" is Amazon's product name. The docs can say X-ray; the Study tab
needs a house name. A candidate: **Who & what**.

## What it adds that the app does not have

Each existing feature covers one corner of this:

| Today | Its limit |
|---|---|
| Need to know (prerequisites per chapter) | One chapter's list, kept and re-served, but attached to that one chapter. Nothing carries a name across chapters. |
| Ask this book | You must know what to ask, and type it. |
| Cross-book links | Only matches your highlights, by shared word stems. |
| Find in this book | One word, no meaning, no trail. |

An X-ray is the thing those four lack: a **catalogue of the whole book that
persists**, follows your position, needs no click to be present, and can be
browsed. The picture to hold: the bones under the page.

## The ideas, ranked

### Tier 1: the core. Build this first.

1. **A who-and-what index per book.** Every person, organisation, place,
   term, cited work and event the author relies on. For each: the name the
   book uses, its other names merged (so "Chang", "Morris Chang" and "TSMC's
   founder" are one entry), the kind, a description built **only from the
   book's own words**, where it was first met, where the book defines it,
   and a trail of mentions by chapter (Kindle's bar).
2. **On the page, without a click.** The first mention of an entry on each
   screen gets a quiet dotted underline. Tap it and the card opens. A thin
   "on this page" strip in the margin lists what is on the screen now, the
   Prime Video idea.
3. **It knows where you are.** A card shows only what the book has said up
   to your position, with a "show everything" switch. By chapter 30 of *Chip
   War* you have forgotten who was introduced in chapter 12; the card says
   "met in ch. 12: ... since then: ...". For *Meditations*, where the
   argument builds, this is the difference between help and spoilers. The
   app stores the current spot per book (`books.position`); it does not store
   the furthest point reached, a small addition if re-reading should not hide
   later facts.

### Tier 2: what nonfiction needs that Kindle never did

4. **"Previously in this book."** Come back after nine days and the app
   offers a recap of the chapters you finished, built from the index: who
   and what you have met, in order. Spoiler-free by construction. The gaps
   are already known (`reading_sessions` has start and end times). It is a
   summary, so it should wait until a chapter is finished, and could be
   limited to chapters you have explained back (see the decision below).
5. **A symbols and notation index** for physics and statistics books:
   "σ was defined on p. 41 as the standard deviation of ...". Same machinery,
   a different kind of entry; the thing a scientist reaches for most in a
   maths-heavy book. For scanned books it depends on the text edition keeping
   Greek letters and sub- and superscripts, which has not been checked.
6. **Time and place.** Dated events become a timeline per book, with the
   current page's events lit; places become a map. Across books, one
   timeline: *Chip War*, *The Grid* and *The Pay Off* overlap in the same
   decades, and a shared timeline is a new way to see the shelf. A timeline
   needs no outside service. A map needs map tiles (an outside service, so
   an interface with a fake) or a bundled world outline.
7. **A people graph** for histories: who founded, employed, taught or fought
   whom, drawn per chapter, growing as you read.

### Tier 3: yours, and across the library

8. **Your own trail on every entry.** The highlights, notes and voice notes
   that mention it, the questions you asked, the Test yourself questions you
   missed on it. An entry can become a Daily review card.
9. **One index across all books.** The same person or idea in several books,
   with every passage. This is the cheap first filter that M26's R2 (links by
   meaning) is still looking for: two passages that share an entry are
   candidates before Claude judges them.
10. **Agents can use it.** Through the existing agent access and its MCP
    endpoint (MCP: the standard way an outside AI tool calls into an app),
    your own Claude can ask "where does this book define X" and get an
    anchored answer.

### Tier 4: the argument X-ray. A decision, not a given.

11. For philosophy and science books the real "characters" are claims:
    the thesis of a chapter, its premises, the objections the author takes
    up, where each is stated. This is the skeleton of the argument. It is
    also a summary, and M26's rule is that **the reader writes first and
    Claude responds second**. So it cannot appear on demand like a who-card.
    Options: show it only after you have sketched the skeleton yourself and
    compare the two (the Explain it back pattern); or only for finished
    chapters; or leave it out.

## How it would be built

**The spine: every fact carries a quote.** Ground rule 4 says everything has
an anchor with quoted text. Here that rule becomes the honesty check. Claude
is asked for entries, facts and mentions, each with a verbatim quote from the
chapter. A fact whose quote cannot be found word for word in the stored
chapter text (`sections.text`) is dropped and counted. The count is visible
in the admin pages and checked in tests with the fake Claude (the stand-in
used so tests spend nothing). This is the same discipline the scan-to-text
checks use, and it is what makes the cards trustworthy.

**Data.** Three tables: entries (per book: name, kind, other names), facts
(entry, chapter, one sentence, quote anchor, the generation that made it, so
provenance is kept), mentions (entry, section, position, quote). An exporter
and an export-wipe-import test, as every kind of data has (rule 7). The index
is derived from the book's text, not from the reader, so it can be shared
with another reader whose copy holds the same text, like rewrites (rule 6).

**Extraction, chapter by chapter.** Claude reads one chapter together with
the list of entries known so far, so a new name joins an old entry when it
is the same thing. Facts are stored per chapter, which is what makes
"only up to where you are" possible. Three ways to pay for it:

| Option | What happens | Cost | Notes |
|---|---|---|---|
| A. Build the X-ray button | One whole-book pass when the reader asks, with the estimate shown first | Paid once per book | Simple; the Batch API already used for text editions is the cheaper route |
| B. Chapter ahead | The next chapter is prepared as you read | Spread out | Fits the "overnight preparation" idea in the AI-native notes |
| C. Free names first | Proper nouns and their trails from the text alone, no AI; Claude writes a card only when tapped | Near zero until tapped | Names and trails appear at import for every book, including every book already in the library |

My pick: C immediately, then A behind a button. Haiku 5.5 for extraction, as
for Need to know, judged in the same side-by-side way M26 used
(`scripts/compare-models.ts`). No dollar figure here: it is measured with the
app's own estimator (`estimateCost`) on one real book before the first run,
and it must fit the existing caps, $5 per book and $20 per month.

**On the page.** Mentions are found by their quoted text, exactly as
highlights are (quote, prefix, suffix), so the EPUB reader can mark them the
way it marks highlights. Text editions of scanned books get the same. The
scan view (page pictures) cannot underline, so it gets the "on this page"
list in the panel instead.

**The card, in a fixed order.** (1) From this book, up to here: the facts
with their quotes, each a link. (2) From your library: other books' mentions
and your own notes. (3) From the world: Claude's general knowledge about the
person or term, labelled as AI and as outside the book, with a search
phrase. Layer 3 is never shown before layer 1.

**Checks that run in tests, with the fake:** every fact has a quote found in
the book; a fact from chapter n is never shown at a position before n; other
names merge ("Mr. Darcy" and "Darcy" in a public-domain fixture); export
round-trips; every card shows provenance and the machine-written look.

**Checks on the real library, by eye:** for three of your books, twenty
entries each: right kind, true description, right places. Verdicts in the
ledger.

## The first slice I would build

Tier 1, items 1 to 3, with option C and then A. Nothing from tiers 2 to 4.

Done when: a browser test opens a public-domain book with the fake Claude,
sees the Who & what tab with entries sorted by how often they appear, taps a
dotted name on the page and gets a card whose facts each open the right
place; a fact from a later chapter is absent until the reader moves there
and present after; the index exports and imports identically; the quote
check drops a planted fact with no quote. Screenshots: phone and desktop,
light and dark. Then Samuel builds the X-ray for *Chip War* on the live site,
checks twenty entries by eye, and records a verdict.

## Decisions for Samuel

**Decided 2026-10-22** (Samuel: "Let's go for this 'C A A A'"): the prototype's
four choices, C (underline and strip), A (three-layer card), A (list by how
often), A (only up to here). First slice: tier 1, as prototyped (a working
assumption: the prototype is tier 1). The milestone is M32 in `docs/plan.md`.
The four below stay open with my picks as defaults until 2026-10-29 (Open
unknowns row 27).

1. **The name in the app.** Who & what (my pick), Index, or X-ray.
2. **The argument X-ray (tier 4).** Behind your own sketch first (my pick,
   later), finished chapters only, or not at all.
3. **When to pay.** A button per book with the estimate (my pick), at import
   for every book, or chapter ahead.
4. **The "from the world" layer.** Keep it, always last and labelled (my
   pick), or book-only cards.
