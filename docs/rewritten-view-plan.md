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

**R1 · The server.** Merged 2026-10-10 (#138). Plain rewrites follow Samuel's plain-english skill
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

**R2 · The panel and the switch.** Merged 2026-10-10 (#139). A button in the reader's top bar opens
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

**R3 · Made as you read.** Merged 2026-10-10 (#140).
After the first "Rewrite this page", each page turned to is rewritten too,
without a click, with a running total ("So far: 3 paragraphs rewritten,
about $0.06."), until Stop, a failure (the spending cap, no connection), or
leaving the reader; the go-ahead is never remembered on the device. Once $1
has been paid since the last go-ahead it stops and asks "Keep rewriting?"
(Listen's rule since #133, `ASK_AGAIN_USD`). A page turned away from
mid-way is finished when you come back (each paragraph is paid once either
way). In a scrolled EPUB, each new paragraph scrolled into view is made.
Making the next page before you reach it pays for a page you may not read:
that waits for Samuel's answer to Open unknowns row 15 (the same question
for Listen), and is not built.

Done when: with the fake Claude (each paragraph billed $0.60 by the test),
a browser test proves pages are made after the first press without a click,
the total counts them, it asks after $1.20 and makes nothing more until
"Keep rewriting", closing and reopening the view keeps it on, Stop turns
it off (a turn then makes nothing), and a reload starts it off; unit tests
check the counting (`lib/library/rewritten-turn.test.ts`).

**R4 · Defaults on the account.** Built 2026-10-10 (`m17-rewritten-defaults`).
Samuel (2026-10-10): "the default view for every book should be the
side-by-side with ste-light. you should be able to change this in
preferences under user accounts as well." Migration 0023 adds
`users.rewritten_view` (original, side or rewritten; new and existing
readers: side) and makes STE light the AI explanations style for new
readers; existing readers keep the style they have. The Account page has a
"Reading preferences" card (the style for all books, and the view a book
opens with), and the reader's own switch changes the same setting, so it
follows the reader to every book and device (it was kept on the device in
R2). The library export carries the view. A consequence: with the rewrite
beside the page on a computer, a PDF shows one page, not two, so the Spine
fold (two pages only) does not play until the view is Original.

Done when: unit tests prove new readers start side by side in STE light,
existing readers keep their style, the migration's reverse step, the
preferences refuse unknown values, and the export round trip carries the
view; a browser test changes both on the Account page, opens a book in
that view and style, and sees the reader's switch change the Account page.
