# Redoing the "Editorial Ambient Glass" look

Written 2026-10-14 for Samuel and for the Claude sessions that will build it.
Plain English first; design words are defined where they first appear.

## Why a redo

The first attempt (branch `m23-editorial-ambient-glass`, commits f50e30e and
699a97f, live on the site as 699a97f) was built without the Hark screenshot
the brief refers to: it was never in the repo. The builder worked from the
written colour list alone. The result is a recolour, not a redesign.

What it got right, and what the redo keeps:

- Navigation, covers, serif type, the forest-green accent and every feature
  are unchanged (only CSS and class names changed).
- Book text, notes, passages, search snippets and the mini-player sentence sit
  on solid paper, and a test enforces it (`lib/tokens.test.ts`, "reading
  surfaces stay on solid paper").
- Contrast checks now blend a see-through colour over the page before
  measuring (`blendOver` in `lib/contrast.ts`).
- When the device asks for less transparency, panels turn solid.

What it got wrong:

1. **The glass cannot be seen.** "Frosted glass" means a panel that lets a
   blurred version of what is behind it show through. The panels are 95%
   opaque, and what sits behind them is a nearly flat colour. Blurring a flat
   colour changes nothing, so every card reads as solid paper. Frost only
   shows where something detailed (covers, text) passes underneath a panel:
   the phone tab bar over the shelf, a pinned toolbar over a page that
   scrolls, a dialog over the library.
2. **The wash is too faint to notice.** The four wash colours sit within a
   few shades of the old paper colour. In dark mode they are nearly
   identical, so the dark page is effectively flat.
3. **Spacing and type hierarchy were not touched.** The brief asked for
   both; no size, weight or spacing step changed.
4. **The sidebar's current page clashes.** In light mode it is a tan chip on
   a sage rail, unrelated to the green accent. In dark mode it is darker than
   the rail (#051814 on #152824), so the current page looks like a hole
   rather than a lifted selection. On a Mac, the selection is the lifted one.
5. **"Shared components" became one shared CSS class** (`glass-card`) pasted
   into 33 places. It works, but nothing stops the next page from forgetting
   it. A shared component (`<Panel>`, `<Card>`) would.
6. **Process.** The live site runs 699a97f, which was on no branch on GitHub
   until 2026-10-14 (now pushed as a backup). It never went through a pull
   request or CI. The next deploy from `main` will remove the look without
   anyone noticing. The reference screenshots were never refreshed.

## Step 0: decide what the live site shows (Samuel)

Either leave 699a97f live until the redo lands, or redeploy `main` now. The
redo does not depend on this.

## Step 1: the Hark screenshot, turned into rules

Done when: the screenshot is saved in `docs/design/prototypes/hark/` (not a
book, so it may go in git) and `docs/design.md` has 6 to 8 rules a builder can
be checked against, with numbers, for example:

- the opacity of a panel (a value such as 70% to 85%, not 95%);
- the blur radius and where it applies (only on panels that something
  detailed scrolls under);
- how strong the wash is (how far its colours move from the paper colour,
  in both themes);
- the sidebar: solid or see-through, and how the current page is marked
  (it should use the green accent family, lifted in both themes);
- the type steps: page title, section heading, card title, label;
- the spacing steps between sections and inside cards;
- corner radius and shadow for cards, dialogs and the sidebar.

## Step 2: prototypes, 2 or 3 options per part

One static page, real tokens, **real covers** (the browser-test library has
no books, so the existing screenshots never show the shelf, which is where
this look lives). Options labelled A/B/C per part, so Samuel picks per part:

| Part | What the options vary |
|---|---|
| The room (wash) | strength and placement of the gradient, light and dark |
| Sidebar | solid sage, see-through over the wash, or floating inset panel |
| Cards and panels | how see-through, border, shadow, radius |
| Phone tab bar and sheets | frosted over the shelf vs solid |
| Type and spacing | two hierarchies for Home and a book page |

Before publishing, check every board has its controls (search, account menu,
Import, mini-player with Back 15 / Pause / Forward 15).

Done when: Samuel has picked one option per part.

## Step 3: build the picks, in small pull requests

Fresh branches off `main` (`m24-glass-tokens`, `m24-glass-shell`, ...), not
off the old branch: PR 175 is merged, so its commits there would only
conflict. Reuse from the old branch: `blendOver`, the reading-surface test,
the reduced-transparency rule.

1. **Tokens.** New values in `app/tokens.css` and `docs/design.md`. Done when
   `npm test` passes, including the contrast and solid-paper tests.
2. **Shared components.** `<Panel>` (frosted) and `<Paper>` (solid, for
   anything you read) in `components/ui/`, replacing the 33 `glass-card`
   class strings. Done when `grep -rn glass-card app components` finds none.
3. **Shell.** Sidebar, phone tab bar, account menu, the current-page marker.
4. **Pages.** Home and the shelf first, then Paths, Review, Stats, Account,
   Data, Covers.
5. **Type and spacing.** The picked hierarchy.

Each pull request: reference screenshots refreshed with the `merge-train`
skill, Playwright screenshots (phone and desktop, light and dark) attached,
plus one screenshot of a shelf with covers from the restored copy of the live
library. Deploy after the last step, from `main`.
