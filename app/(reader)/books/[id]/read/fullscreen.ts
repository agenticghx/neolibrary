/**
 * Full screen's controls (Samuel 2026-11-01: "a full screen still showing options … is this how you would watch
 * Netflix?"). In full screen only the book is on screen; the bars come back when the reader reaches for them, as a
 * film's controls do: the mouse at the top or bottom edge, a tap, or a key that is not a page turn. A mouse moving
 * over the text, or the arrow keys turning pages, leave them hidden.
 */

/** The bars fade this long after the reader last reached for them (ms). */
export const FULL_IDLE_MS = 2000;

/** How near the top or bottom of the screen the mouse must be to bring the bars back (CSS pixels). */
export const FULL_EDGE_PX = 96;

/** Keys that read on (turn the page, scroll) rather than reach for the controls. Escape leaves full screen itself. */
const READING_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Escape",
  "f",
  "F",
  "Shift",
  "Control",
  "Alt",
  "Meta",
]);

export type FullEvent =
  | { kind: "pointermove" | "pointerdown"; pointerType: string; y: number }
  | { kind: "keydown"; key: string };

/**
 * Whether this event brings full screen's bars back. `y` is the pointer's distance from the top of the screen and
 * `height` the screen's height, both in CSS pixels (an event in the book's frame adds the frame's top first).
 */
export function wakesBars(e: FullEvent, height: number): boolean {
  if (e.kind === "keydown") return !READING_KEYS.has(e.key);
  if (e.kind === "pointerdown" && e.pointerType !== "mouse") return true; // a finger or a pen: a tap
  if (e.pointerType !== "mouse") return false; // a finger sliding over the page is reading, or a swipe
  return e.y < FULL_EDGE_PX || e.y > height - FULL_EDGE_PX;
}

/** Reads a DOM event into a FullEvent; `top` is the top of the frame it happened in (0 for the page itself). */
export function fullEvent(e: Event, top = 0): FullEvent | null {
  if (e.type === "keydown") return { kind: "keydown", key: (e as KeyboardEvent).key };
  if (e.type === "pointermove" || e.type === "pointerdown") {
    const p = e as PointerEvent;
    return { kind: e.type, pointerType: p.pointerType || "mouse", y: top + p.clientY };
  }
  return null;
}
