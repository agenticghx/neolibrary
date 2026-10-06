/**
 * Timing marks for the browser tests (the WebKit read-along timing
 * investigation: LEARNING_LOG Iterations 22 and 25).
 *
 * Off for readers: every function returns at its first line unless a test set
 * window.__nlMarks before the page loaded (e2e/listen.ts, instrument()), so a
 * reader's browser does no extra work and keeps no entries. On, each call adds
 * a standard User Timing mark (performance.mark), which the test reads back
 * and which Safari's and Chrome's own profilers show. Every mark is on the top
 * page's clock (performance.now()); the test converts it to the audio's time.
 */
export type MarkName =
  | "nl:turn-request" // the reader asked foliate for another PDF page (Reader.tsx)
  | "nl:frame-load" // foliate's frame for a page or chapter finished loading
  | "nl:relocate" // foliate reported the new place (data-cfi follows through React)
  | "nl:textlayer-start" // pdf-book.ts: a page's text layer is being built
  | "nl:textlayer-ready" // ... and is complete (the text-layer event fires next)
  | "nl:draw-start" // pdf-book.ts: a page's picture (canvas) is being drawn
  | "nl:draw-done" // ... and is now in the page
  | "nl:lit" // a word was highlighted, by the player's frame ("word") or by its page's text arriving ("text-layer")
  | "nl:word-wait" // the player's word is not on the page yet; it tries again on the next frame
  | "nl:bar-set"; // the Listen bar asked React to show a word (data-word follows when React commits)

type Detail = Record<string, string | number | boolean | null>;

const on = () => typeof window !== "undefined" && (window as { __nlMarks?: boolean }).__nlMarks === true;

export function mark(name: MarkName, detail: Detail = {}) {
  if (!on()) return;
  performance.mark(name, { detail });
}

/** The page's clock now when marks are on (0 when off): the start of a measure(). */
export const markTime = () => (on() ? performance.now() : 0);

/** A span from `start` (from markTime()) to now, shown as a bar in the browser's profiler. */
export function measure(name: `nl:${string}`, start: number, detail: Detail = {}) {
  if (!on()) return;
  performance.measure(name, { start, end: performance.now(), detail });
}
