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
5. **Restraint.** Few borders (hairlines only), soft shadows on covers and
   raised cards only, one accent colour. No gradients except the faint glow
   on the sign-in page, no glassy blur, no emoji, no stock illustrations.

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
| `--cover-navy`, `--cover-green` | | | owned book covers |
| `--cover-unowned` | `#d9d3c7` | `#2b3a41` | wanted but not owned |

No pure black or pure white anywhere.

## Space, shape, depth

- Spacing steps `--space-0` … `--space-9`: 2, 4, 8, 12, 16, 24, 32, 48, 64, 96 px.
  Use bigger steps between sections than inside them.
- Radii: `--radius-sm` 3px (highlights, cover spine), `--radius-md` 6px
  (buttons, inputs, cards), `--radius-lg` 10px (large panels).
- Shadows: `--shadow-cover` (books feel like objects), `--shadow-raised`
  (popovers). Unowned books have no shadow: they are not on the shelf yet.

## Motion

Short and quiet: `--dur-fast` 120ms (hover colour), `--dur-base` 200ms
(cover lift, panels), `--dur-slow` 360ms (page-level changes), easing
`--ease-out`. When the device asks for reduced motion, every duration
becomes 0. Nothing bounces, nothing moves on its own except the spoken-word
highlight.

## Components so far

- **Mark** (`components/Mark.tsx`): an open book with a teal doorway in the
  spine. Also the browser icon (`app/icon.svg`).
- **Cover** (`components/Cover.tsx`): a plain typographic cover (title, slot
  letter N or E, a darker spine edge). Owned covers are navy or green cloth;
  unowned ones are dimmed and captioned "Not owned". Never copies real cover
  art.
- **AuthShell** (`components/AuthShell.tsx`): the quiet room around the
  sign-in, setup and invitation forms (mark, wordmark, "By invitation only").
- **ActionForm / Field** (`components/ActionForm.tsx`, styles in
  `components/forms.module.css`): labelled inputs, one primary button, and
  errors shown in a sunken box with an accent rule (`role="alert"`), never in
  red.
- **App bar** (`app/(app)/layout.tsx`): mark + wordmark on the left; Library,
  Invite (admins only) and Sign out on the right, in quiet ink.

- **Reader** (`app/(reader)/books/[id]/read/`): full-screen, its own quiet
  bar (mark, title · author, Contents, Aa), a single 680px text column, page
  turns at the sides, chapter + progress at the foot. Book pages get the app's
  colours (read from the tokens at run time) and fonts (`public/fonts/`);
  settings: Pages/Scroll, text size, line spacing, Serif/Sans/Book's own.

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
