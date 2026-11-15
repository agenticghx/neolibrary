/**
 * The width of the rewrite beside the page (Side by side), set by dragging the line between them (SideDivider.tsx;
 * Samuel, 2026-11-15). Kept on this device as a share of the reading area's width, so it holds when the window
 * changes size; none kept means the layout's own split (reader.module.css, .stageSide).
 */

export const SIDE_WIDTH_KEY = "neolibrary:side-width";
/** Neither the book nor the rewrite gets narrower than this (px): 20rem, the rewrite's own minimum in the CSS. */
export const MIN_COLUMN = 320;
/** One arrow-key press moves the line this far (px). */
export const KEY_STEP = 32;

/** The rewrite's width, kept within what leaves both columns readable. `pair` is the book's and the rewrite's widths together. */
export function clampSide(side: number, pair: number): number {
  const max = Math.max(MIN_COLUMN, pair - MIN_COLUMN);
  return Math.min(Math.max(side, MIN_COLUMN), max);
}

/** The new width for a key on the line, or null for a key it does not use. Left widens the rewrite (the line moves left). */
export function sideForKey(key: string, side: number, pair: number): number | null {
  if (key === "ArrowLeft") return clampSide(side + KEY_STEP, pair);
  if (key === "ArrowRight") return clampSide(side - KEY_STEP, pair);
  if (key === "Home") return clampSide(pair, pair);
  if (key === "End") return clampSide(0, pair);
  return null;
}

const CHANGED = "neolibrary:side-width-changed";
/** Where storage is blocked (a private window), the width lasts until the page is left. */
let unsaved: number | null | undefined;

/** The kept share (percent of the reading area), or null: none kept, unreadable, or out of range. */
export function readSideWidth(): number | null {
  if (unsaved !== undefined) return unsaved;
  try {
    const v = Number(localStorage.getItem(SIDE_WIDTH_KEY) ?? NaN);
    return Number.isFinite(v) && v > 5 && v < 95 ? v : null;
  } catch {
    return null;
  }
}

/** Keeps the share, or forgets it (null: back to the layout's own split), and tells the reader. */
export function writeSideWidth(percent: number | null) {
  const v = percent === null ? null : Math.round(percent * 10) / 10;
  try {
    if (v === null) localStorage.removeItem(SIDE_WIDTH_KEY);
    else localStorage.setItem(SIDE_WIDTH_KEY, String(v));
    unsaved = undefined;
  } catch {
    unsaved = v;
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** For useSyncExternalStore: a change here, or in another tab of this browser. */
export function subscribeSideWidth(changed: () => void) {
  window.addEventListener(CHANGED, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(CHANGED, changed);
    window.removeEventListener("storage", changed);
  };
}
