/**
 * Turning pages with a sideways swipe (#235), in Pages and in Scroll.
 *
 * A trackpad swipe reaches the page as a burst of wheel events, each a few pixels sideways, followed by more as the
 * swipe coasts to a stop. One swipe turns one page: the sideways distance is added up until it passes `distance`,
 * the page turns, and the rest of that swipe is used up without turning again. A pause of `quietMs` with no wheel
 * event ends a swipe. A mouse wheel turned with Shift held counts as sideways, as browsers on Windows send it.
 *
 * A finger on a touch screen is handled by foliate in Pages for EPUBs; `swipeDirection` covers the rest (Scroll,
 * and PDFs, whose page renderer has no swipe of its own).
 */

export type Turn = "next" | "prev";

export const WHEEL_SWIPE = {
  /** Sideways pixels before a swipe turns the page. */
  distance: 50,
  /** A pause this long (ms) ends a swipe. */
  quietMs: 250,
  /** Sideways must beat up-and-down by this factor: scrolling down a page drifts a little sideways. */
  dominance: 1.5,
};

/** Wheel deltas in lines (Firefox with a mouse) or pages, in pixels. */
const UNIT = [1, 16, 800];

type Wheel = Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "shiftKey">;

/** The sideways part of a wheel event in pixels (positive: towards the right, the next page), or 0 if it is mostly up or down. */
export function sideways(e: Wheel): number {
  const unit = UNIT[e.deltaMode] ?? 1;
  let dx = e.deltaX * unit;
  let dy = e.deltaY * unit;
  if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
  return Math.abs(dx) > WHEEL_SWIPE.dominance * Math.abs(dy) ? dx : 0;
}

/**
 * Returns a handler for wheel events. It answers true for a sideways event it used (turning or not): the caller then
 * cancels the event, so the browser neither moves the page sideways nor goes back a page in its history.
 * `scrollsItself(dx)`: true when the event lands on something that scrolls sideways on its own (a wide table); that
 * whole swipe is then left to it, so a table scrolled to its end does not turn the page as the swipe coasts on.
 */
export function wheelTurner(turn: (dir: Turn) => void, now: () => number = () => performance.now()) {
  let sum = 0;
  let last = -Infinity;
  /** What the swipe under way has done: nothing yet, turned the page, or been left to a box that scrolls. */
  let state: "open" | "turned" | "left" = "open";
  return (e: Wheel, scrollsItself: (dx: number) => boolean = () => false): boolean => {
    const t = now();
    if (t - last > WHEEL_SWIPE.quietMs) {
      sum = 0;
      state = "open";
    }
    last = t;
    const dx = sideways(e);
    if (dx === 0) {
      sum = 0;
      return false;
    }
    if (state !== "open") return state === "turned";
    if (scrollsItself(dx)) {
      state = "left";
      return false;
    }
    if (Math.sign(dx) !== Math.sign(sum)) sum = 0;
    sum += dx;
    if (Math.abs(sum) >= WHEEL_SWIPE.distance) {
      state = "turned";
      turn(sum > 0 ? "next" : "prev");
      sum = 0;
    }
    return true;
  };
}

export const TOUCH_SWIPE = {
  /** Sideways pixels a finger must travel. */
  distance: 60,
  /** Sideways must beat up-and-down by this factor. */
  dominance: 2,
  /** A slower drag is reading or selecting, not a swipe (ms). */
  maxMs: 800,
};

type Point = { x: number; y: number; t: number };

/** The page a finger swipe from `a` to `b` asks for: a finger moving left brings the next page, as with paper. */
export function swipeDirection(a: Point, b: Point): Turn | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (b.t - a.t > TOUCH_SWIPE.maxMs) return null;
  if (Math.abs(dx) < TOUCH_SWIPE.distance || Math.abs(dx) <= TOUCH_SWIPE.dominance * Math.abs(dy)) return null;
  return dx < 0 ? "next" : "prev";
}

/**
 * True when something under the pointer can itself move further sideways in this direction (a wide table in its
 * own scrolling box): the swipe is left to it. `path`: the event's composed path, innermost first.
 */
export function scrollsSideways(path: EventTarget[], dx: number): boolean {
  for (const target of path) {
    // Not `instanceof Element`: a node inside the book's frame belongs to that frame's own Element.
    const el = target as Element;
    if ((el as Node).nodeType !== 1 || el === el.ownerDocument.documentElement || el === el.ownerDocument.body) continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const overflow = el.ownerDocument.defaultView?.getComputedStyle(el).overflowX;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    if (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0) return true;
  }
  return false;
}
