# M42 build plan: E-ink reading mode

Written for Samuel and for the Claude sessions that build M42. Planned
2026-11-08, from a conversation about building a reading device of his own.
The milestone's summary is in `docs/plan.md` (M42); this file is the detail.

## Why this milestone exists

Samuel asked how he would design a reading device of his own, something
like a Kindle but open, made for study. The advice was not to build
hardware yet. First, run Neolibrary on an e-ink tablet that can already be
bought, use it every day for a month, and see whether anything is still
missing that only new hardware could add. He agreed ("yep, plan the e-ink
reading mode as suggested").

So M42 is the cheap test of a hardware idea. It does not plan a prototype
board, a factory or a device of our own. Those come only if S5's month of
use finds a gap that software cannot close.

## Words used here

- **E-ink** (also "e-paper"): a screen made of tiny particles of black and
  white pigment, like the Kindle's. It looks like printed paper, can be
  read in sunlight, and uses power only when the picture changes. Most
  show 16 shades of grey, some show dull colour, and a redraw takes about
  a tenth of a second to half a second.
- **Ghosting**: a faint trace of the old picture left after a redraw. Movement
  makes it worse: fades, sliding panels, a carousel that drifts, smooth scrolling.
- **Full refresh**: the screen flashes black and white once to clear the
  ghosts. E-ink tablets do this on their own every few page turns.
- **Boox, Daylight**: two makers of Android e-ink tablets that run an ordinary
  web browser (Chrome or their own), so Neolibrary can run on them as it is.
  A Kindle's browser is too limited for this app.
- **Dithering**: how an e-ink screen fakes a shade it cannot show, by
  scattering dots. Pale tints, see-through grey layers and blur come out
  speckled or vanish.
- **localStorage**: a small store in the browser on one device. Reader
  settings already live there (`app/(reader)/books/[id]/read/settings.ts`).

## What already helps

Found in the code on 2026-11-08 (commit b71ca572):

- The reader turns pages with PageDown, PageUp and the arrow keys, and with
  Space in Pages (`Reader.tsx`, the key handler near line 710). Many e-ink
  tablets' page buttons send one of these keys.
- Pages (paginated) is already the default flow.
- Motion has one off switch: `app/tokens.css` sets every `--dur-*` duration to
  0 under `prefers-reduced-motion: reduce`. The Home carousel
  (`components/home/BookCarousel.tsx`) and the spine fold
  (`lib/reader/spine-fold.ts`) check reduced motion in their own code.
- Offline reading (`OfflineSetting.tsx`, the service worker) and the web
  app manifest (`app/manifest.ts`), so the site can be added to a tablet's
  home screen and open without the browser's address bar.

## What works against e-ink today

- **Motion**: fades, sliding panels, the drifting carousel, smooth scrolling.
- **Glass and shadows**: 17 stylesheets use `backdrop-filter` (blurred glass
  behind panels) and there are 44 `box-shadow` rules (counted with `grep -rln
  'backdrop-filter' app components --include='*.css' | wc -l` and `grep -rn
  'box-shadow' app components --include='*.css' | wc -l`). On e-ink both
  come out as grey speckle.
- **Pale colours**: a highlight is a pale green (`--highlight: #cfe0d8`). In
  16 greys it is a very light grey that is hard to see on white. The word
  being spoken in Listen (`--highlight-active`) is only a little darker.
- **The word-by-word highlight in Listen** moves several times a second. Each
  move is a redraw, so on e-ink the text flickers and ghosts.
- **The reading ruler and paragraph focus** dim the rest of the page with a
  grey layer. That layer dithers.
- **Scroll flow**: on e-ink a scrolling page smears.

## Steps

Each step is one pull request. The device check in each step needs Samuel
and a device (Open unknowns row 34). The rest is tested in Chrome on a
computer with the setting on.

### S1 · The E-ink setting in the reader

Aa gets a switch, **E-ink**, under "Screen", stored with the other reader
settings on this device (`settings.ts`, `eink: boolean`, off by default).
When it is on, the reader element carries the class `theme-eink` in place
of its theme (`theme-eink-night` when the theme is Night, or Auto on a dark
device), and:

- Paper is white and ink is black (white on black at night). The E-ink
  colours are their own set in `app/tokens.css`, greys only; the six themes
  are not each drawn in grey (built 2026-11-08: one set is simpler to check,
  and a theme's tint is lost on a grey screen anyway).
- Every `--dur-*` duration is 0 in the same set, as under
  `prefers-reduced-motion`.
- No blur and no shadow: the glass tokens are solid colours with an edge in
  ink, and every `--shadow-*` is `none`.
- Flow is Pages (`withEink` in `settings.ts`, applied when settings load and
  change). Scroll is shown but greyed out, with one line: "E-ink screens
  smear while scrolling, so E-ink reads in Pages."
- The reading ruler is a 3-pixel bar in ink at the left of the lines, with no
  tint and no shadow. The rest of the page is still dimmed, in grey ink (one
  of the 16 greys an e-ink screen shows); paragraph focus dims as before.
- Highlights are an underline in ink, not a tint. A highlight's colour is
  shown by the line: sage solid, amber dashed, rose dotted, sky double. A
  sticker's, picture's or drawing's passage is underlined solid, and its
  badge stays, in greys. The saved highlight does not change.
- The place marked after a layout switch is a still outline in ink, shown
  for 2.4 seconds, not a fading tint.

Not automatic. Browsers have a CSS test for slow screens (`@media (update:
slow)`), but tablets that run Chrome on Android often report a fast screen.
A later step may use it as a hint, after S5 shows what real devices report.

*Done when:* unit tests: the setting is stored and read back, an old saved
setting without it reads as off, and Scroll saved with E-ink on opens in
Pages (`settings.test.ts`); both E-ink colour sets pass every contrast pair
the themes pass, set every colour a theme sets, and use greys only
(`lib/tokens.test.ts`). A browser test (`e2e/eink.spec.ts`, a reader of its
own) with E-ink on, in a book: no element on the page has a transition or
animation longer than 0 s, a shadow, or a blur (with E-ink off the same count
finds transitions); the book page's background and text are white and black
(black and white at night); Scroll is greyed out; a Rose highlight is a
dotted underline and no tint; the ruler is a 3-pixel bar in ink with no
tint; a reload keeps E-ink and Pages; axe finds nothing in four looks. Each
check fails when its rule is removed. Screenshots: the reader and Aa with
E-ink on, phone and desktop, light and dark.

### S2 · E-ink outside the reader

The setting reaches the whole site, not only the reader: Home, the library,
Notes and Help. The command palette (the search box opened with Cmd+K,
mounted beside the reader, so S1 does not reach it) is glass with a shadow
until then. Home's carousel stops drifting (as it does under reduced
motion) and the sky behind Home is plain paper.

The flag must be read before the page is first drawn. Otherwise each page
load shows one frame of the full design, which on e-ink is a full redraw
and a ghost. So it is stored where the first paint can read it: a cookie
read by the server, or a short script in the page's head. The S2 pull request
chooses one and says why. A reader who turns E-ink on in Aa gets it on every
page of the site on that device.

*Done when:* a browser test sets E-ink on in the reader, opens Home, and
finds `data-eink` on the root element in the first HTML the server sends (or
before the first paint), the carousel not moving, and no `backdrop-filter`.
Screenshots: Home and the library with E-ink on, phone and desktop.

### S3 · Listen on e-ink

With E-ink on, Listen marks the paragraph being read, not each word: a black
bar in the margin that moves once per paragraph. The word timings are still
used to follow along and to turn the page when the voice reaches its end.

*Done when:* a browser test plays the fake voice with E-ink on and counts
changes to the page's marks: one per paragraph, not one per word. With E-ink
off, word-by-word highlighting is unchanged.

### S4 · The device's own buttons

Page buttons and covers differ from tablet to tablet. On the device, a small
page (`/help/keys`, or a section of Help) shows the name of each key the
device sends when a button is pressed. Samuel presses each button once and
the session maps what is missing. A tablet's volume buttons usually do not
reach a web page at all, and the plan does not count on them.

The page also explains how to add Neolibrary to the tablet's home screen, so
it opens like an app with no address bar, and how to save books for offline
reading.

*Done when:* the key names from Samuel's device are in this file, and every
button that sends a key turns the page in Pages. This step needs the device.

### S5 · A month of daily reading

Samuel reads and studies with the tablet for a month. The test, written
before the month starts so that it can fail:

> I study for 2 hours with no distraction, and every note I write lands on
> the right sentence.

Each session he notes what got in the way, in a sentence or a photo: a
smear, a slow panel, a button that did nothing, a pen stroke that lagged, a
note on the wrong line. Sessions turn what can be fixed in software into
pull requests. What cannot be fixed in software goes in a list under
"Hardware gaps" at the end of this file.

*Done when:* the month is over and this file says, from that list, whether a
device of his own would add anything that software on a bought tablet cannot.
That answer decides whether there is ever an M-step for hardware.

## Not in M42

- Hardware of our own: a prototype board, an industrial designer, a factory.
- A native Android app. The site in the tablet's browser comes first. An app
  is worth it only if S5 finds something a browser cannot do (fast pen ink is
  the most likely candidate, since tablets often give their quick drawing
  mode only to native apps).
- Colour e-ink tuning (Kaleido screens). Grey first.

## Open questions

- **Which device** (Open unknowns row 34): answered 2026-11-08, a Boox
  (Samuel: "i'll go for boox"). S4 records the model and what its buttons
  send. Until it arrives, S1 to S3 are built and tested in Chrome on a
  computer.

## Hardware gaps

Empty until S5.
