/**
 * Turning pages with a swipe or the wheel (#235), in Pages and in Scroll.
 *
 * A trackpad swipe reaches the page as a burst of wheel events, each a few pixels, followed by more, ever smaller, as
 * the swipe coasts to a stop. One swipe turns one page: its distance is added up until it passes `distance`, the page
 * turns, and the coasting that follows is used up without turning again. A new swipe ends the old one: a pause of
 * `quietMs`, a swipe the other way, or events growing again (coasting only ever slows down). Without that last rule a
 * reader swiping page after page, each swipe starting while the one before still coasted, turned only the first page
 * (Samuel, 2026-10-25).
 *
 * Sideways turns pages in both layouts (a mouse wheel turned with Shift held counts as sideways, as browsers on
 * Windows send it). Up and down turns pages too in Pages, where there is nothing to scroll; in Scroll it scrolls.
 *
 * A finger on a touch screen is handled by foliate in Pages for EPUBs; `swipeDirection` covers the rest (Scroll,
 * and PDFs, whose page renderer has no swipe of its own).
 */

export type Turn = "next" | "prev";
export type Axis = "x" | "y";

export const WHEEL_SWIPE = {
  /** Pixels before a swipe turns the page. */
  distance: 50,
  /** A pause this long (ms) ends a swipe. */
  quietMs: 250,
  /** One direction must beat the other by this factor: scrolling down drifts a little sideways, and back. */
  dominance: 1.5,
  /** After a turn, an event this many times the smallest since, and `growPx` larger, starts a new swipe. */
  grow: 3,
  growPx: 8,
};

/** Wheel deltas in lines (Firefox with a mouse) or pages, in pixels. */
const UNIT = [1, 16, 800];

type Wheel = Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "shiftKey">;

/**
 * The part of a wheel event that turns pages: its axis and pixels (positive: towards the next page: right, or down),
 * or null if it is not clearly one way. `upDown`: up and down turns pages too (the Pages layout).
 */
export function turnAmount(e: Wheel, upDown: boolean): { axis: Axis; px: number } | null {
  const unit = UNIT[e.deltaMode] ?? 1;
  let dx = e.deltaX * unit;
  let dy = e.deltaY * unit;
  if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
  if (Math.abs(dx) > WHEEL_SWIPE.dominance * Math.abs(dy)) return { axis: "x", px: dx };
  if (upDown && Math.abs(dy) > WHEEL_SWIPE.dominance * Math.abs(dx)) return { axis: "y", px: dy };
  return null;
}

/**
 * Returns a handler for wheel events. It answers true for an event it used (turning or not): the caller then cancels
 * it, so the browser neither moves the page nor goes back a page in its history.
 * `upDown`: up and down turns pages too. `scrollsItself(axis, px)`: true when the event lands on something that
 * scrolls that way on its own (a wide table); that whole swipe is then left to it, so a table scrolled to its end
 * does not turn the page as the swipe coasts on.
 */
export function wheelTurner(turn: (dir: Turn) => void, now: () => number = () => performance.now()) {
  let sum = 0;
  let last = -Infinity;
  /** What the swipe under way has done: nothing yet, turned the page, or been left to a box that scrolls. */
  let state: "open" | "turned" | "left" = "open";
  /** The swipe's axis and direction, and its smallest event since it turned or was left: coasting shrinks it. */
  let way = { axis: "x" as Axis, sign: 0 };
  let low = Infinity;
  return (e: Wheel, upDown = false, scrollsItself: (axis: Axis, px: number) => boolean = () => false): boolean => {
    const t = now();
    const quiet = t - last > WHEEL_SWIPE.quietMs;
    last = t;
    const amount = turnAmount(e, upDown);
    if (quiet) {
      sum = 0;
      state = "open";
    }
    if (!amount) {
      sum = 0;
      return false;
    }
    const { axis, px } = amount;
    const size = Math.abs(px);
    if (state !== "open") {
      const otherWay = axis !== way.axis || Math.sign(px) !== way.sign;
      const growing = size >= WHEEL_SWIPE.grow * low && size >= low + WHEEL_SWIPE.growPx;
      if (otherWay || growing) {
        state = "open";
        sum = 0;
      } else {
        low = Math.min(low, size);
        return state === "turned";
      }
    }
    if (scrollsItself(axis, px)) {
      state = "left";
      way = { axis, sign: Math.sign(px) };
      low = size;
      return false;
    }
    if (axis !== way.axis || Math.sign(px) !== Math.sign(sum)) sum = 0;
    way = { axis, sign: Math.sign(px) };
    sum += px;
    if (Math.abs(sum) >= WHEEL_SWIPE.distance) {
      state = "turned";
      low = Infinity;
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
 * True when something under the pointer can itself move further this way (a wide table in its own scrolling box):
 * the swipe is left to it. `path`: the event's composed path, innermost first. `px`: positive is right, or down.
 */
export function scrollsItself(path: EventTarget[], axis: Axis, px: number): boolean {
  for (const target of path) {
    // Not `instanceof Element`: a node inside the book's frame belongs to that frame's own Element.
    const el = target as Element;
    if ((el as Node).nodeType !== 1 || el === el.ownerDocument.documentElement || el === el.ownerDocument.body) continue;
    const [scroll, client, at] =
      axis === "x" ? [el.scrollWidth, el.clientWidth, el.scrollLeft] : [el.scrollHeight, el.clientHeight, el.scrollTop];
    if (scroll <= client + 1) continue;
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    const overflow = axis === "x" ? style?.overflowX : style?.overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    if (px > 0 ? at + client < scroll - 1 : at > 0) return true;
  }
  return false;
}
