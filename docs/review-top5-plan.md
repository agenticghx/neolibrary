# M19 · The site review's top 5

Written for: Samuel, and the Claude sessions that build this. Planned
2026-10-11.

## Where this comes from

On 2026-10-11 Samuel asked Fable 5.1 (a different Claude model from the one
that built the site) to review the site independently. Its report ranked five
improvements. Claude Opus 5.5 checked each against the code and the
screenshots, and all five are real. The full report, with the file and line
behind every claim, is on Samuel's laptop at
`docs/handoffs/2026-10-11-0815-fable-site-review.md` (not in git).

While this plan was made, three things in the report turned out to be wrong
or incomplete:

- Item 4 (broken cover titles) is only in the greyed "Not available yet"
  group on Home and Library. The Path page uses a smaller cover whose titles
  fit (seen in `e2e/__screenshots__/path-desktop-light.png`).
- No reader page has a reference screenshot (an approved image the tests
  compare against). Every reader image goes only to `screenshots/`. So in the
  reader, a change in the look is caught only by test assertions and by
  looking at the images.
- Item 3 cannot be "undone for 30 days": nothing in the app deletes removed
  data automatically. A removed book stays hidden until you bring it back.
  Deleting for good is left for later.

## Words used here

- **Panel**: a card that opens over the reader (Notes, Rewrite, Reading settings and so on).
- **Reflow**: the book lays its text out again to fit a new width. The reader's engine (foliate-js) does this by itself when its box changes size.
- **CSS filter**: a display effect the browser applies to a picture, such as inverting its colours. It changes what you see, not the file.
- **Soft delete**: removal that only hides an item; it stays in the database and can be brought back.
- **Outbox**: the queue in the browser that holds note changes made offline until the network is back.
- **Migration**: a script that changes the database layout. Each one needs a reverse step, and a backup before it runs on the live site.
- **Accessible name**: the name a screen reader says for a button, and the name the tests find it by.
- **axe**: the automatic accessibility checker that runs inside the browser tests.
- **Idempotent**: safe to send twice; the second send changes nothing.

## The order

One pull request per step, merged one at a time with the merge-train skill.
Steps P1, P1b, P2, P3a and P5 all edit `Reader.tsx`, so they go in this
order. Step P4 touches no reader file and can be built alongside, in its own
git worktree.

| Order | Step | Branch | Size | Database change |
| --- | --- | --- | --- | --- |
| 1 | P1 · Panels beside the book, not over it | `m19-panels-beside` | medium | none |
| 2 | P1b · The keyboard follows the panel | `m19-panel-focus` | small | none |
| 3 | P2 · Dim PDF pages at night | `m19-dim-pdf` | small to medium | none |
| 4 | P3a · Undo a removed note | `m19-undo-note` | medium | none |
| any | P4 · Cover titles that do not break | `m19-cover-titles` | small | none |
| 5 | P5 · One Study button, one set of style names | `m19-study` | small to medium | none |
| 6 | P3b · Remove a book, and bring it back | `m19-remove-book` | medium to large | none planned |

The ledger commits waiting on local branch `m18-deploy-record` ride in with
P1: build `m19-panels-beside` on top of it.

## What every step must show (its "Done when", besides its own list)

1. `npm run check` exits 0 (lint, types, unit tests).
2. The browser tests that cover the change pass locally with
   `--ignore-snapshots`. Any existing test that changes is listed in the pull
   request with the reason; a renamed button is a rename, not a weaker test.
   No test is skipped, deleted or loosened.
3. Screenshots on phone and desktop, light and dark, written to
   `screenshots/` and looked at. The pull request names them.
4. axe passes with the new thing open.
5. The four required checks are green on GitHub, and the pull request pastes
   the evidence. Then merge with the merge train.
6. Deploy only when Samuel says so (several steps can go together). Check
   that `/api/health` shows the new commit. Claude cannot sign in, so each
   step ends with one line saying what Samuel should try.

---

## P1 · Panels beside the book, not over it

**What changes for the reader.** On a computer (a window wider than 48rem,
768 pixels), a panel opens in a column beside the book. The book narrows and
reflows, and no text is covered. Every panel except Contents opens on the
right. On a phone nothing changes: the panel is a card over the page, as
today.

**How.**
- Today every panel is `.panel`, a card with `position: fixed` at the right
  (`app/(reader)/books/[id]/read/reader.module.css:411-427`). The book sits in
  `.stage`, a grid of three columns: previous-page button, book, next-page
  button (`:79-84`). Side by side already adds a fourth column, `.stageSide`
  (`:111-113`). Its book reflows by itself, through foliate's own resize
  watcher (`node_modules/foliate-js/paginator.js:422`).
- Add the same kind of column for panels: a right column for every panel
  except Contents. Render the open panel inside `.stage` rather than after
  the footer (`Reader.tsx:1212-1345`). Inside the column it is no longer
  fixed: it scrolls on its own.
- **Contents stays over the page on the left**, as before (built 2026-10-11).
  It closes once a chapter is picked, and `e2e/reader.spec.ts:97` records the
  earlier decision that opening it does not move the page.
- **With Side by side on**, the panel becomes a third column, and the page
  and the rewrite share the rest equally. Nothing is covered, so a change of
  style in Reading settings shows in the rewrite at once. `e2e/ai.spec.ts:474`
  tests exactly that; a first try that hid the rewrite behind the panel
  failed it.
- With Rewritten alone (the rewrite covers the book), a panel still opens in
  the right column.
- Only one panel is open at a time already (`Reader.tsx:267`), so there is
  never more than one panel column.
- A side gain: the panel comes before the footer in the page, so Tab reaches
  it sooner.

**Files.** `Reader.tsx`, `reader.module.css`; possibly `RewrittenPane.tsx`.

**Done when.** A new browser test at 1280 × 800 checks every panel beside the
book: Notes, Reading settings, What do I need to know?, Test yourself, Rewrite, See
it, Elsewhere in your library and a pinned picture. For each one:
- the panel's box and the book's box (`.host`) do not overlap;
- the reading place (the location the reader saves) is the same before the
  panel opens and after it closes.

It also checks Side by side and the phone:
- with Side by side on, the page, the rewrite and Notes sit side by side,
  none covering another;
- at 390 × 844 a panel still opens as a card, as today.

axe passes with each panel open. Screenshots `reader-panel-*-desktop-{light,dark}.png`
are looked at, and one Side by side + panel image.

**Samuel tries.** On a computer, open Notes or select text and press Rewrite:
the whole page stays readable.

## P1b · The keyboard follows the panel

**What changes.** When a panel opens, keyboard focus moves into it (to its
heading). Escape closes it and puts focus back on the button that opened it.
This is how the account menu already behaves
(`components/shell/AccountMenu.tsx:37-41`).

**How.**
- No `.focus()` call exists in the reader today.
- The key handler ignores every key while a button has focus
  (`Reader.tsx:359`), so Escape does nothing just after clicking a toolbar
  button. `e2e/images.spec.ts:87-88` works around this by blurring first.
- Let Escape through when a button has focus; the arrow keys still stay with
  the button. Remove the blur workaround from that test: the test gets
  stricter, not weaker.

**Done when.** For each toolbar panel, a keyboard-only test checks two
things:
- Tab to the button and press Enter: focus is inside the panel.
- Press Escape: the panel is closed and focus is on that button.

**Samuel tries.** Nothing to see unless he uses the keyboard. This is mainly
for screen-reader and keyboard users.

## P2 · Dim PDF pages at night

**What changes.**
- In the Night theme, or Auto while the device is in dark mode, a PDF page is
  shown dimmed: a dark page with light text.
- Reading settings gets a switch, "Dim PDF pages at night". It is on by
  default and shown only for PDFs, because figures and photographs look odd
  when inverted.

**How.**
- A PDF page is a picture drawn on a canvas. It sits inside its own small
  document (`lib/reader/pdf-book.ts:246-262`), which is inside two closed
  shadow roots (hidden page sections the app's styles cannot reach), so the
  app's styles cannot get to it. The page's own `<style>` can, and
  `pdf-book.ts` writes that style.
- Add to it a rule that inverts only the picture when the page's root carries
  `data-dim`: `:root[data-dim] #canvas { filter: invert(1) hue-rotate(180deg) }`
  (tune the brightness to match Night's paper).
- The text layer is not touched. It is invisible, and selection and the
  read-aloud word highlight live on it.
- The reader sets or clears `data-dim` in two cases:
  - on each page document as it loads (the same place it adds its key
    listeners, `Reader.tsx:480`);
  - on every loaded page when the theme, the switch or the device's dark mode
    changes.
- "Dark" means exactly what `themeColors` already uses (`Reader.tsx:139-140`):
  Night, or Auto with the device in dark mode.
- The switch is a new field in the reader's saved settings
  (`app/(reader)/books/[id]/read/settings.ts`, kept on the device). Settings
  saved before it existed must load with the default.
- Check three things on a dimmed page:
  1. The selection colour (`rgb(55 105 99 / 0.3)`, `pdf-book.ts:32`) is too
     dark to see on it; give it a lighter colour under `data-dim`.
  2. Check the read-aloud highlight (`pdf-book.ts:40-46`) on a dark page, and
     adjust it under `data-dim` if it is hard to see.
  3. Look at the two-page Spine fold in Night. Do not change the fold; only
     check that it still looks right.

**Done when.** A browser test opens a test PDF and reads the computed `filter`
of each loaded page's canvas. It reaches the page through
`view.renderer.getContents()`, as `e2e/readalong.spec.ts:1479` does.
- Night: the filter contains `invert`, on both pages in two-page view and on
  the next page after a turn.
- Paper: `none`.
- Night with the switch off: `none`.
- Auto with the browser set to dark (`page.emulateMedia`): `invert`.

The other checks:
- The PDF read-aloud tests pass unchanged (the word is still lit).
- A unit test proves that old saved settings load with the switch on.
- Screenshots `reader-pdf-dim-{desktop,phone}-dark.png` and a two-page Night
  image are looked at.
- axe passes on Reading settings with the switch.

**Samuel tries.** Open *The Grid* with the Night theme.

## P3a · Undo a removed note

**What changes.**
- After Remove in Notes, a line "Note removed · Undo" shows for about ten
  seconds. Undo brings the note back with its highlight on the page.
- Your data gets a "Removed notes" card listing each removed note (book or
  Path, the quoted words, the date removed) with "Bring back". The card shows
  only when something has been removed.

**How.**
- A removal is already a new version marked deleted. Nothing is overwritten
  (`lib/library/annotations.ts:344-364, 384-386`).
- No function brings a note back today. A re-save cannot do it either:
  - an edit of a removed note fails with "not found" (`:355`);
  - a create with the same id returns the removed note unchanged (`:266-275`).
- Add the following:
  - `restoreAnnotation`: adds a version with `deleted: false`, carrying the
    last content. It is idempotent on the change id, like the other changes.
  - `listRemovedAnnotations`: one reader's notes whose newest version is
    deleted.
  - A route, `POST /api/annotations/{id}/restore?changeId=…`.
  - In the outbox (`lib/outbox.ts:14-21`), a `restore` operation.
  - If Undo is pressed while the remove is still waiting in the outbox, just
    drop the waiting remove. This is how `forget` already treats an unsent
    note (`Reader.tsx:822`).
- After a restore the reader reloads its notes and draws the highlight again.
  Highlights are drawn only when the page asks (`Reader.tsx:400-402`).
- Notes on a pillar or a Path (`removeNoteAction`, `app/(app)/actions.ts:125`)
  appear in the same Removed notes list.
- Export already includes every version of every note
  (`lib/library/export.ts:189-193`), so a restore survives export and import.

**Files.**
- `lib/library/annotations.ts` (+ test);
- `app/api/annotations/[id]/restore/route.ts` (new);
- `lib/outbox.ts`;
- `Reader.tsx`, `NotesPanel.tsx`;
- `app/(app)/data/page.tsx`, plus a server action.

**Done when.**
- **Unit tests** (they run on the real Postgres job):
  - remove, then restore: the note is listed again with the same words, and
    its history has three versions;
  - the same restore sent twice adds one version;
  - another reader's note gives "not found";
  - the removed list holds only removed notes.
- **Browser tests:**
  - remove a highlight, then Undo: it is back on the page and in Notes after
    a reload;
  - remove, then Your data, then Bring back: the note is back in the book;
  - offline: remove then Undo while offline; after reconnecting, the note is
    still there;
  - export, then import into an empty account, gives the same notes (ground
    rule 4).

The "Note removed · Undo" line has `role="status"`, so screen readers
announce it. Screenshots are looked at. The `data-*` reference images stay
unchanged, because the test account has no removed notes.

**Samuel tries.** Remove a note, then press Undo.

## P4 · Cover titles that do not break

**What changes.** Titles on the greyed "Not available yet" covers no longer
break in the middle of a word ("Airpor t System s").

**How.**
- The group's grid has narrow columns, `minmax(6.5rem, 1fr)`
  (`components/home/Library.module.css:239-242`).
- Its covers (`size="fill"`) keep the large title size, `--text-lg`
  (`components/Cover.module.css:101-109`). The smaller sizes apply only to
  words longer than 9 letters (`components/Cover.tsx:116-119`).
- The Path page's `sm` covers use smaller sizes, and their titles fit.
- Give the covers in this group the `sm` title sizes, through a class for
  the compact grid, and add `hyphens: auto` to the title. The page is marked
  English (`app/layout.tsx:25`), so the browser can hyphenate a word that
  still does not fit instead of chopping it.
- Font sizes must be design tokens; the style checker refuses sizes that
  scale with the cover's width.
- Then look at the thin spines in `screenshots/home-spines-desktop-light.png`.
  Fable thought a long title there runs into the percentage. Fix that only if
  it is visible.

**Done when.**
- A browser test opens the group at 1280 × 800 and at 390 × 844, in Home and
  in Library. In every placeholder title, every word of up to 13 letters
  renders on one line. (A range over the word has one box on screen.)
- The `titleSize` unit test still passes (`components/Cover.test.ts`).
- Screenshots `home-not-yet-{desktop,phone}-{light,dark}.png` are looked at.
- No existing reference image changes: none of them shows the group open.

**Samuel tries.** Open "Not available yet" on Home.

## P5 · One Study button, one set of style names

**What changes.**
- The "?" in a circle becomes **Study**. Its panel has two tabs, Need to
  know and Test yourself. Test yourself is no longer hidden behind a link
  inside the other panel.
- "Rewritten view" stays its own button. It switches a mode; it does not
  open a panel.
- The Rewrite panel (from selected text) offers the same four style names as
  Aa and the Account page: Plain, STE light, STE, STE strict. They come first.
  For a biologist, Add missing background and Shorter move under "More ways".
- The five-line note in Reading settings that explains the two sets of names
  goes.

**How.**
- One list of short style names in `lib/library/levels.ts`. Today they are
  copied in `AiStyleSetting.tsx:9-17` and in
  `app/(app)/account/ReadingPreferences.tsx:8`.
- The Rewrite panel's four styles map through `rewriteFor` (`levels.ts`) to a
  level and a strictness.
- Keep the Account page's words, so its reference images (`account-*.png`)
  do not change.
- **Only the words on screen change.** The stored names (`plain`,
  `ste-light`, …, and the levels) stay. They appear in:
  - database rules (migrations 0009 and 0023);
  - `lib/db/schema.ts`;
  - the prompt file names;
  - the keys under which paid rewrites are stored.

  Renaming them would make the app pay again for rewrites it already has.
- The tabs use proper tab roles.

**Done when.**
- The Study button opens on Need to know, and Test yourself is one click
  away. The tab state is read by role.
- The Rewrite panel's first row reads Plain, STE light, STE, STE strict, and
  each makes the matching rewrite with the fake AI.
- The Account page's reference images are unchanged.
- In `e2e/ai.spec.ts`, the lines that find "What do I need to know?" (14) and
  "Test yourself" (4) are renamed. The pull request lists them as renames.
- axe passes on both tabs. Screenshots are looked at.

**Samuel tries.** Press Study in a book.

## P3b · Remove a book, and bring it back

**What changes.**
- The book page gets "Remove from library", behind a confirmation: "Remove
  *Title*? Your notes are kept. You can bring it back from Your data."
- The book leaves Home, Library, Search, Collections, Reading stats and the
  agent's view.
- Your data lists "Removed books" with "Bring back".
- The file is kept. Deleting a book for good is later.

**How.**
- `books.deleted_at` already exists (`db/migrations/0002_library.up.sql:22`),
  and most listings already skip rows that have it. So no migration is
  needed.
- Add `removeBookAction` and `restoreBookAction`; only the owner can use
  them.
- `removeTitle` already uses the same column for a placeholder taken off a
  Path (`lib/library/paths.ts:624`). So "Removed books" lists only rows with
  a file.
- **Listings that do not skip removed books today.** Each gets a decision and
  a test:
  - Reading stats per book (`lib/library/reading-stats.ts:128, 264`): hide
    removed books. The weekly totals keep their time, because the reading
    happened.
  - Collection counts (`lib/library/shelf.ts:88-97`): skip removed books.
  - Search in notes (`lib/library/search.ts:72-105`): skip notes on removed
    books.
  - `bookIdsWithNotes` (`lib/library/home.ts:70-79`): skip.
- Per-book API routes keep their owner checks unchanged. The reader cannot
  open a removed book, because `getBook` skips it (`paths.ts:269`).
- **Export and import** must carry removed books, with their removal date:
  - Today export leaves removed books out but keeps their notes, and import
    then refuses the file (`lib/library/export.ts:229` vs `:413-456`).
  - Fix both sides, and prove it with a round-trip test.
- **Uploading a removed book again** today makes a duplicate (`import.ts:49`).
  Instead, say "You removed this book on <date>" with a Bring back button.
- **A book that fills a title on a Path** (default, Samuel's call): Remove is
  not offered. The page says the book is part of that Path. Fable suggested
  that removing it should turn it back into "Not available yet", but that
  needs the old file kept aside and is left for later.

**Done when.**
- **Postgres tests:**
  - remove: the book is gone from the shelf, Home, Search (books and notes),
    Collections and their counts, Reading stats and the agent library;
  - Bring back: everything returns, notes intact;
  - another reader can do neither;
  - export then import with a removed book succeeds, and the book stays
    removed.
- **Browser tests:**
  - remove from the book page through the confirmation;
  - bring it back from Your data;
  - re-upload shows the removed-book message;
  - a Path book shows no Remove.
- Screenshots are looked at. The `book-not-available-*` reference images
  stay unchanged, because a placeholder has no Remove.

**Samuel tries.** Upload a spare public-domain book, remove it, bring it back.

---

## Decisions for Samuel (each has a default; building does not wait)

| # | Question | Default until he says otherwise |
| --- | --- | --- |
| 1 | P3b: may a book on a Path be removed (and turn back into "Not available yet")? | No: Remove is not offered for a Path book |
| 2 | P3b: uploading a book you removed | Say so and offer Bring back; no duplicate |
| 3 | P2: dim PDF pages at night by default? | Yes, with a switch to turn it off |
| 4 | P1: Contents in its own left column on a computer? | No: it stays over the page, as decided earlier (`e2e/reader.spec.ts:97`) |
| 5 | P5: Study on a phone, the word or an icon? | The word on a computer; an open-book icon named "Study" on a phone, where the bar is full |
| 6 | Add reference images for the reader? | No: reader images vary with fonts and timing; rely on assertions and looking |

## Not in this plan

The other findings in the report are left for later: a password reset, the
page-turn pause (Open unknowns row 15), the view per book, find in book,
jumping to a page, the phone top bar, the silent loss of a refused note, and
HSTS. Each is in the full report with its evidence.
