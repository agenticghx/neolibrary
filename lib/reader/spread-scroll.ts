/**
 * Two pages in Scroll (Samuel, 2026-10-25): the text runs in two columns, each one screen tall, and the pairs of
 * columns (spreads) are stacked one under another, so scrolling down moves smoothly from one spread to the next. The
 * browser lays it out with CSS column wrapping (`column-height` and `column-wrap`), which Chrome and Edge have and
 * Safari does not yet (checked 2026-10-25: Chrome 155 yes, Safari 27 no); without it Two pages applies to Pages only.
 *
 * Each spread is exactly one screen apart (the column height plus the gap under it), so a turn, a swipe or an arrow
 * key lands on the next spread, and a jump (opening the book, a chapter, a search hit) is lined up on the spread it
 * lands in. Free scrolling is never pulled into line.
 */

/** Space between two spreads: twice the reader's 40 px margin, so each spread sits 40 px from the top and bottom. */
export const SPREAD_GAP = 80;
/** The margin the reader gives foliate (Reader.tsx applySettings): foliate shows a jump's target this far down. */
export const SPREAD_MARGIN = 40;
/** Space between the two columns of a spread. */
export const SPREAD_COLUMN_GAP = 64;
/** The widest a spread may be: two of the reader's 680 px columns and the gap between them. */
export const SPREAD_MAX_WIDTH = 2 * 680 + SPREAD_COLUMN_GAP;
/** A jump is lined up on its spread once foliate has stopped placing it for this long (ms). */
export const SPREAD_SETTLE_MS = 200;
/** Narrower than this, or taller than wide, a window shows one column, as in Pages (foliate's own rule). */
export const SPREAD_MIN_WIDTH = 680;

/** The browser can stack columns in rows (CSS column wrapping). */
export function canWrapColumns(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("column-wrap: wrap") && CSS.supports("column-height: 1px");
}

/**
 * The distance between one spread and the next (the height of the book's box), or 0 when the text runs in one
 * column: not Scroll with Two pages, a browser without column wrapping, or a window too narrow or taller than wide.
 */
export function spreadPitch(s: { flow: string; pages: string }, box: { width: number; height: number }, canWrap: boolean): number {
  if (s.flow !== "scrolled" || s.pages !== "two" || !canWrap) return 0;
  if (box.width <= box.height || box.width <= SPREAD_MIN_WIDTH || box.height <= SPREAD_GAP * 2) return 0;
  return Math.round(box.height);
}

/** The book's CSS for spreads `pitch` apart. */
export function spreadCss(pitch: number): string {
  const column = pitch - SPREAD_GAP;
  return `
    body {
      column-count: 2 !important; column-gap: ${SPREAD_COLUMN_GAP}px !important; column-fill: auto !important;
      column-height: ${column}px; column-wrap: wrap; row-gap: ${SPREAD_GAP}px;
    }
    img, svg, video { max-height: ${column}px !important; }`;
}

/** How far to scroll from `start` (the top of the screen) to show the next or previous spread whole. */
export function spreadTurn(start: number, pitch: number, dir: "next" | "prev"): number {
  const at = start / pitch;
  // A screen within 2 px of a spread's top is on that spread.
  const target = dir === "next" ? (Math.floor(at + 2 / pitch) + 1) * pitch : (Math.ceil(at - 2 / pitch) - 1) * pitch;
  return Math.abs(target - start);
}

/**
 * Where to scroll after a jump that left the screen at `start`, so the spread holding the jump's target shows whole.
 * foliate puts the target `SPREAD_MARGIN` below the top of the screen. Returns the change (+ down, - up).
 */
export function spreadAlign(start: number, pitch: number): number {
  const row = Math.floor((start + SPREAD_MARGIN + 2) / pitch);
  return row * pitch - start;
}
