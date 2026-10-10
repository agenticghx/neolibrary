# M17 · Read it rewritten

Written for: Samuel, and the Claude sessions that build this. Started
2026-10-10.

## What Samuel asked for

The "AI explanations" setting (Aa: Plain, STE light, STE, STE strict) should
rewrite the book, paragraph by paragraph, in the chosen style. Until now it
only worded "What do I need to know?". The Rewrite button rewrote one selected
paragraph at a time, with its own list of levels.

His choices (2026-10-10):

- The rewrite shows **in a panel beside the page** on a computer, and **under
  it** on a phone. The panel follows the page you are on.
- A switch moves between **Original** (the book alone), **Side by side** (the
  page and the panel) and **Rewritten** (the rewrite alone). "Sometimes you
  just want to focus on one, and other times see them side by side."

Defaults he did not overrule: a page is rewritten as you read it, paid once
(a stored rewrite is shown again for free), with the price shown first, like
Listen; Plain follows his plain-english skill.

A PDF page is a picture of the printed page, so its words cannot be swapped
for the rewrite; that is why the rewrite has its own panel. In this PDF, as
the app reads it, a "paragraph" is often a whole page that starts or ends
mid-sentence (the PDF does not mark paragraph breaks), so a rewrite can too.

A prototype made with `claude -p` (chapter 1 of *The Grid* at all four
levels, scored with both checkers) is on Samuel's laptop:
`~/Documents/neolibrary-grid-ch1/rewrites/compare.html`. Not in git: the book
is copyrighted.

## Steps (one pull request each)

**R1 · The server.** Plain rewrites follow Samuel's plain-english skill
(copied to `prompts/plain/`, kept in step by `lib/ai/plain-sync.test.ts`).
A style maps to a rewrite level (`rewriteFor` in `lib/library/levels.ts`).
`paragraphsBetween` (`lib/library/annotations.ts`) finds the paragraphs on
screen: an EPUB's visible range, or a PDF's page or two pages.
`/api/books/{id}/rewritten`: GET `?from=&to=` gives each paragraph with its
newest rewrite in the book's style, or its price; POST `{ sectionId }` makes
one. Rewrites are the Rewrite panel's stored versions, so a paragraph already
rewritten there at the same level is not paid for again. No database change.

Done when: with the fake Claude, tests prove the right paragraphs for an EPUB
page, a PDF page and two PDF pages; the price before, then the rewrite with
its provenance, re-served without a second call; the book's style followed
(STE strict asks for Strict); the spending cap stops it; another reader gets
nothing (`lib/library/rewritten.test.ts`).

**R2 · The panel and the switch.** A button in the reader's top bar opens
the rewrite. Inside it, a switch: Original, Side by side, Rewritten. Side by
side: the page and the panel share the screen (beside on a computer, page
above and panel below on a phone). Rewritten: the panel covers the page;
Previous, Next and the arrow keys still turn it. The choice is remembered on
the device, like the theme. A paragraph without a rewrite shows "Rewrite this
page in Plain, about $0.02"; a made rewrite shows "machine-written", its STE
score and meaning choices, and where it came from (model, date, cost). The
hint under Aa → AI explanations says it now applies to rewrites.

Done when: a Playwright test with the fake Claude turns the panel on, makes a
page's rewrite, turns the page and back (the stored rewrite shows, no second
call), in an EPUB and a PDF, in both modes; screenshots on phone and
computer, light and dark; the accessibility check passes with the panel open.

**R3 · Made as you read.** After the first press, each new page is rewritten
as you turn to it, with a running total and a "Keep going?" question past $1
(as Listen does since #133). Making the next page before you reach it pays
for a page you may not read: that waits for Samuel's answer to Open unknowns
row 15 (the same question for Listen), and is off until then.

Done when: tests prove a turn makes the new page's rewrite once, the total
counts it, and the question stops it at $1 until answered.
