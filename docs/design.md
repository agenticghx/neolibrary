# Neolibrary design system

Written for: Claude sessions building pages, and Samuel when judging the look.
The values themselves live in `app/tokens.css`; this file explains them.
A live sample of everything here is the page `/design` (screenshot in every PR).

**Sources.** Derived from the Codex prototypes in `docs/design/prototypes/`
(warm paper, deep ink, oxidised teal; serif books, humanist sans labels).
Samuel's own reference picks (`docs/design/refs/`) do not exist yet; when
they arrive, revisit this file, and Samuel's references win over the prototypes.

## The idea in one line

A quiet reading room at dusk: literary, tactile, calm. Fine book typography
and museum signage, not a software dashboard.

## Rules everything follows

1. **Tokens only.** A *token* is a named value such as `--ink-900` or
   `--space-4`. Every colour, font, type size, line height, spacing step,
   radius, shadow and animation timing in the app's CSS must be a token from
   `app/tokens.css`. `npm run lint` (stylelint) rejects raw values like
   `#ff0000`, `14px` or `rgb(…)` anywhere else, and ESLint rejects inline
   `style={…}` in components. To add a value, add a token here and in
   `tokens.css`, never inline.
2. **Both themes, always.** Light and dark follow the device setting
   (`prefers-color-scheme`). Every page is checked in both.
3. **Readable by measurement.** Each text colour has a contrast check against
   the surfaces it sits on (`lib/tokens.test.ts`, WCAG AA: 4.5:1 for text,
   7:1 for main ink on paper) and axe-core checks every page in the browser.
4. **Machine-written text looks different** (ground rule 5): its own tinted
   background, a dashed left rule, sans-serif text and a label saying it was
   written by AI. Book text is serif on paper; the reader's own notes are
   italic serif. These three never look alike.
5. **The room and its glass** (M24, Samuel's picks of 2026-10-14; the
   reasoning is in `docs/glass-redo-plan.md`). Behind every app page is a
   "room": a soft wash, deep blue-grey sky at the top of the first screen
   fading to cream (dark mode: deep blue and sage shapes on near-black). It
   is one screen tall (`--room-height`) and scrolls away with the page;
   below it every page sits on `--room-base`. "Glass" means a see-through
   panel that lets a blurred version of what is behind it show through:
   - the sidebar is glass at 42% (`--rail`), the current page a lifted
     paper chip (`--nav-current`, `--shadow-chip`);
   - cards are 88% paper with a hairline and a soft shadow (`--panel`,
     `--panel-edge`, `--shadow-panel`, `--radius-panel` 14px);
   - the phone tab bar is glass at 82% (`--tabbar`), so its labels stay
     readable over any cover passing under it.
   - pop-up windows and menus (the command palette, Choose a cover, the
     account menu and its phone sheet, the speed menu) and the mini-player
     use the cards' glass. The sentence the mini-player reads aloud, and the
     one a voice note quotes, sit on their own solid paper inside it. The
     reader page has no glass at all, so its keyboard-shortcuts window stays
     paper.
   **Rules the tests enforce** (`lib/tokens.test.ts`): only page headers sit
   on the room's dark band (`--room-1`, `--room-2`), so text there is
   `--ink-900`; grey text and green links belong below the band, on cards
   or on paper. Every text colour passes 4.5:1 below the band. Glass is
   checked after blending it over each part of the room (`blendOver` in
   `lib/contrast.ts`), never as a bare colour. When the device asks for less
   transparency, glass turns solid. **Book text, notes, passages and search
   snippets never sit on glass**: they stay on solid paper.
   Still: hairlines only, one accent colour, no emoji, no stock
   illustrations.

## Type

| Role | Face | Token |
|---|---|---|
| Book text, titles, covers, buttons | **Source Serif 4** (variable, with optical sizes) | `--font-serif` |
| Labels, menus, captions, machine-written text | **Source Sans 3** (variable) | `--font-sans` |

Both are open-licence (SIL OFL) and bundled with the app through npm
(`@fontsource-variable/…`), so no font is fetched from Google at run time
and screenshots are identical on every machine.

Scale (ratio 1.25 around the 20px reading size):

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 13px | letter-spaced capital labels ("HIGHLIGHTS") |
| `--text-sm` | 15px | captions, small labels |
| `--text-md` | 17px | interface text, buttons, inputs |
| `--text-read` | 20px | book text on desktop |
| `--text-read-phone` | 18px | book text on phones |
| `--text-lg` | 25px | section titles |
| `--text-xl` | 31px | headings |
| `--text-2xl` | 39px | page titles |
| `--text-3xl` | 49px | display (one per page at most) |

Long reading: line length `--measure-read` = 66 characters, line spacing
`--leading-read` = 1.6. Headings use `--leading-tight` (1.15), interface
text `--leading-ui` (1.4). Headings balance their lines (`text-wrap: balance`).

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#f3ede1` | `#1b282f` | page background |
| `--paper-raised` | `#faf6ee` | `#22323a` | cards, inputs, popovers |
| `--paper-sunken` | `#e9e1d1` | `#152026` | wells, collapsed panels |
| `--ink-900` | `#243239` | `#e7ddc9` | main text |
| `--ink-700` | `#3c4b52` | `#cdc3b0` | secondary text |
| `--ink-500` | `#5a676c` | `#a49d8e` | quiet labels (still passes AA) |
| `--rule` | `#d6ccba` | `#34454d` | hairlines |
| `--accent` | `#376963` | `#6b9f95` | links, primary buttons, progress |
| `--highlight` | `#cfe0d8` | `#2c4743` | highlighted passages |
| `--highlight-active` | `#9cc4b6` | `#3f6a63` | the word being spoken |
| `--machine-bg` / `--machine-rule` | `#ece6f0` / `#7a6a8c` | `#2a2a3a` / `#a796bb` | AI-written text |
| `--cover-navy`, `--cover-green` | | | covers of titles you can read or listen to |
| `--cover-empty` | `#d9d3c7` | `#2b3a41` | a title not available yet (undyed cloth) |
| `--heat-1` … `--heat-4` | `#bdd6cb` … `#376963` | `#2a4a45` … `#8bbab0` | the reading calendar's shades on Reading stats (M21): 1–14 minutes in a day up to an hour or more; a day with none is `--paper-sunken`. Each step stands further from the page than the last (`lib/tokens.test.ts`) |
| `--room-1` … `--room-base` | `#8ea5b3` … `#efe7d5` | `#2f4a55` … `#172228` | the room behind app pages (M24); `--room-1`/`--room-2` are the dark band, headers only |
| `--panel`, `--rail`, `--tabbar` | paper at 88%, 42%, 82% | the dark paper at the same | cards, the sidebar, the phone tab bar (M24) |

No pure black or pure white anywhere.

## Space, shape, depth

- Spacing steps `--space-0` … `--space-9`: 2, 4, 8, 12, 16, 24, 32, 48, 64, 96 px.
  Use bigger steps between sections than inside them.
- Radii: `--radius-sm` 3px (highlights, cover spine), `--radius-md` 6px
  (buttons, inputs, cards), `--radius-lg` 10px (large panels).
- Shadows: `--shadow-cover` (books feel like objects), `--shadow-raised`
  (popovers). Titles not available yet have no shadow: nothing is there to pick up yet.

## Motion

Short and quiet: `--dur-fast` 120ms (hover colour), `--dur-base` 200ms
(cover lift, panels), `--dur-slow` 360ms (page-level changes), easing
`--ease-out`. When the device asks for reduced motion, every duration
becomes 0. Nothing bounces, nothing moves on its own except the spoken-word
highlight.

## Components so far

- **Mark** (`components/Mark.tsx`): an open book with a teal doorway in the
  spine. Also the browser icon (`app/icon.svg`).
- **Cover** (`components/Cover.tsx`): the book's own cover picture when it
  has one (from its file, or found in a public catalogue by title and author:
  M22, `lib/covers/`), else a plain typographic cover (title, slot letter N or
  E, a darker spine edge) that never imitates real cover art. Titles you can
  read or listen to are navy or green cloth; a title not available yet is
  greyed: undyed cloth, or its found picture in grey over the cloth colour
  (`grayscale(1)`, opacity 0.55), and it takes its colours when its file or
  audio arrives. Each cover is captioned by availability: Read and listen,
  Read only, Listen only, or Not available yet (`lib/library/availability.ts`).
- **Covers page** (`app/(app)/covers/`, M22): the found covers in a grid, each
  with where it came from and "Not this cover" (the next match takes its
  place); the titles without one; "Find covers now" with its progress.
- **AuthShell** (`components/AuthShell.tsx`): the quiet room around the
  sign-in, setup and invitation forms (mark, wordmark, "By invitation only").
- **ActionForm / Field** (`components/ActionForm.tsx`, styles in
  `components/forms.module.css`): labelled inputs, one primary button, and
  errors shown in a sunken box with an accent rule (`role="alert"`), never in
  red.
- **App bar** (`app/(app)/layout.tsx`): mark + wordmark on the left; Library,
  Invite (admins only) and Sign out on the right, in quiet ink.

- **Command palette** (`components/palette/CommandPalette.tsx`, M21): Cmd+K
  (Ctrl+K on Windows and Linux) anywhere signed in, the reader included. A
  raised card near the top of the screen over the dimmed page (`--scrim`): a
  search box, then rows with the title in the book face (notes in italic), a
  quieter second line, and a small capital tag (Book, Reader, Path, Section,
  Page, Note). The highlighted row is tinted `--highlight`. Matching is in
  `lib/palette/score.ts` (letters in order, best at word starts).

- **Reader** (`app/(reader)/books/[id]/read/`): full-screen, its own quiet
  bar (mark, title · author, Contents, Aa), a single 680px text column, page
  turns at the sides, chapter + progress at the foot. Book pages get the app's
  colours (read from the tokens at run time) and fonts (`public/fonts/`);
  settings: Pages/Scroll, text size, line spacing, Serif/Sans/Book's own,
  and theme (Auto, Paper, Sepia, Night, North Window, Private Press, Calfskin).
  Themes are token sets in `app/tokens.css` (`.theme-paper`, `.theme-sepia`,
  `.theme-night`, `.theme-north`, `.theme-press`, `.theme-calfskin`); Paper and
  Night must equal the light and dark values, and every other theme passes the
  same contrast checks. North Window is cool stone paper, blue-black ink and
  the oxidised teal (`#f2f5f4`, `#1c2830`, `#2f645e`). Private Press is bright
  cotton paper, carbon ink and a vermilion mark (`#f7f6f3`, `#1a1a1a`,
  `#9a341f`). Calfskin is warm hide, iron-gall ink and antique gold
  (`#f6e7cf`, `#2a2118`, `#7a5b24`). A highlighted sentence uses that theme's
  own wash. PDFs show one centred page at a time (pdf.js); these three are
  light themes, so a PDF page stays as printed.

## How the look is checked

| Check | Where | Fails when |
|---|---|---|
| Token rule | `npm run lint` (stylelint + ESLint) | a raw colour, size, spacing or inline style appears |
| Contrast of token pairs | `npm test` (`lib/tokens.test.ts`) | a text colour drops below its minimum |
| Accessibility in the browser | `npx playwright test` (`e2e/a11y.spec.ts`, axe-core) | any WCAG 2.1 A/AA problem on a page |
| Screenshot comparison | `npx playwright test` (`e2e/visual.spec.ts`) | a page changes by more than 0.2% of its pixels |
| Screenshot grid | CI comment on every PR | (for Samuel's eyes) |

**Changing the look on purpose:** run `npm run test:e2e:update`, look at the
new images in `e2e/__screenshots__/`, and commit them in the same PR, saying
in the PR what changed and why. Never update reference images to hide a
change you did not mean.
