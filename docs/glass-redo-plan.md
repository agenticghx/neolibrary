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

## Step 1: the Hark screenshot, turned into rules (done 2026-10-14)

The screenshot is Samuel's (Hark's account menu over a blurred sky, light
mode only). It stays on his laptop and **not in git**: it shows his email
address, and this repository is public. The numbers below were measured from
it with Python (PIL), in CSS pixels (the screenshot is 3840 x 2160 at 2x).

What Hark does, and the rule for Neolibrary:

1. **The room has real range.** Hark's background runs from deep blue
   `#426c95` at the top to pale grey `#d6dbdc` at the bottom: about 3 to 1
   in lightness. The first attempt's wash ran `#e1e6ea` to `#f7f3ea`, about
   1.1 to 1, so nothing showed. *Rule:* the room's darkest and lightest
   areas are at least 1.4 to 1 apart in both themes, still in muted ivory,
   sage, blue-grey and cream. `lib/tokens.test.ts` can check this.
2. **Glass shows as a change of tint, not as blur.** Hark's top panel is
   bluer (`#b8ccdf`) than its bottom panel (`#e3edf4`) because the room
   behind them differs. Blur only matters where detailed things (covers,
   text) pass under a panel: the phone tab bar, the player, dialogs.
   *Rule:* the room's shapes are large enough that one panel visibly
   changes tint from top to bottom.
3. **Panels are about 55 to 70% white.** Measured as panel colour against
   the room just outside it: about 57% at the top, up to 70% lower down.
   The quieter Sign Out button is about 30%. The first attempt used 95%.
   *Rule:* panels between 60% and 88% (the options page shows 60, 72, 88).
4. **No border and no shadow in Hark.** Edges come from the fill alone. The
   brief asks for thin borders and soft shadows, so the reference and the
   brief disagree; Samuel picks (options page, part 3).
5. **Big, soft corners.** Hark's panel corner is about 22 to 24 px, on a
   panel about 547 px wide. The first attempt used 14 px. *Rule:* 18 to
   22 px for cards, dialogs and the player; small controls keep their own.
6. **Grouped lists.** Rows about 57 px tall; thin dividers about 10% darker
   than the panel, inset 20 px from the panel's edge, not running to it;
   groups about 13 px apart.
7. **Text.** Main text near-black (`#1d1d1f`). Secondary text is see-through
   dark (the email reads `#304761` on a blue panel), so it picks up the
   room's tint. *Rule:* `--ink-900` stays; secondary and quiet text may be
   `--ink-900` at about 70% and 60% opacity, if contrast still passes.
8. **Room to breathe.** One centred column about 547 px wide, with the
   room visible on both sides. Neolibrary's pages sit beside a sidebar, so
   the rule is: cap content width so the room shows around the panels.

Dark mode is not in the screenshot; every dark value is our own
extension of these rules.

## Step 2 (built 2026-10-14): the options page

https://claude.ai/artifact/1mQgLYrHawTL2kk2QjMwmp (private to Samuel). Real
covers from his library, the app's own colours and fonts. One row per part,
options A/B/C, everything else held at the middle option:

1. the room (A quiet wash, B soft shapes, C deep sky at Hark's range);
2. the sidebar and the current-page marker (A solid sage rail with a green
   tint, B glass rail with a white lifted chip, C floating panel with a
   filled green chip), plus a board of each one at rest, under the pointer
   and current, light and dark;
3. cards (A 88% with hairline and shadow, B 72% with a light edge, C 60%
   with no edge, as Hark);
4. type (A today's sizes, B larger editorial titles and more space);
5. the phone tab bar (A solid, B frosted, C floating pill);
6. dark mode for each room;
7. "mix your own" boards with a Tweaks panel to try any combination.

Your notes stay on solid paper inside every card (the italic line in the
Continue cards). Done when Samuel names one option per part.

## Step 3: build the picks, in small pull requests

Fresh branches off `main` (`m24-glass-tokens`, `m24-glass-shell`, ...), not
off the old branch: PR 175 is merged, so its commits there would only
conflict. Reuse from the old branch: `blendOver`, the reading-surface test,
the reduced-transparency rule.

1. **Tokens.** New values in `app/tokens.css`, and the Step 1 rules for the picked options copied into `docs/design.md` (rule 5 there, replacing the first attempt's text). Done when
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
