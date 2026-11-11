"use client";

import { type RefObject, useCallback, useRef } from "react";
import { clearFocus, firstLetterInside, focusAt, focusBlock, type Box } from "./focus";
import { type FoliateView } from "./reader-helpers";
import { type FocusMode } from "./settings";

/**
 * Focus while reading (M21, EPUBs): the ruler, a soft band on the line being read, and paragraph focus, where the
 * paragraph being read stays clear and the rest dims. This holds where the band is and puts it on a line, a tap or
 * the pointer. Moved out of Reader.tsx as it was (the version 2 split); the reader decides when to call it.
 */
export function useRuler(props: {
  view: RefObject<FoliateView | null>;
  /** The focus mode now: off, ruler or paragraph. */
  focusRef: RefObject<FocusMode>;
}) {
  const { view, focusRef } = props;
  const spokenBlock = useRef<Element | null>(null);
  const pointer = useRef<{ x: number; y: number; inside: boolean } | null>(null);
  // Focus (M21): the ruler's band (the lens), drawn over the book in the reader's own page. `lens` is where it is on
  // screen (the window's coordinates); `lensAnchor` the point the reader put it at (a tap, the mouse, or the first
  // line), which scrolling never moves, so the band cannot creep; `lensPlace` the place in the book (CFI) it was put
  // on, in Pages.
  const lensEl = useRef<HTMLDivElement | null>(null);
  const lens = useRef<Box | null>(null);
  const lensAnchor = useRef<{ x: number; y: number } | null>(null);
  // The line the band is on, in its page's own coordinates: in Pages the band follows it when the page moves.
  const lensLine = useRef<{ doc: Document; band: Box & { lead?: number } } | null>(null);
  const lensPlace = useRef<string | null>(null);

  /**
   * Shows the ruler's band at a place on screen (the window's coordinates), or hides it (null). `anchor`: the reader
   * put it there (a tap, the mouse, the first line), so it is the point the ruler is held at from now on.
   */
  const showLens = useCallback((at: Box | null, anchor = false, glide = true, lead?: number) => {
    lens.current = at;
    if (!at) {
      lensAnchor.current = null;
      lensLine.current = null;
    }
    // Held at its first line (`lead`): with a ruler of two or three lines, the line the reader put it on.
    else if (anchor) lensAnchor.current = { x: at.left + 8, y: lead ?? (at.top + at.bottom) / 2 };
    const el = lensEl.current;
    const clip = el?.parentElement?.getBoundingClientRect();
    if (!el || !clip) return;
    if (!at) {
      el.removeAttribute("data-shown");
      el.removeAttribute("data-glide");
      return;
    }
    // Glide from line to line, but appear in place the first time (no slide in from the corner).
    el.toggleAttribute("data-glide", glide && el.hasAttribute("data-shown"));
    el.style.width = `${at.right - at.left}px`;
    el.style.height = `${at.bottom - at.top}px`;
    el.style.transform = `translate(${at.left - clip.left}px, ${at.top - clip.top}px)`;
    el.setAttribute("data-shown", "");
  }, []);

  /**
   * What of a book's page is on screen: foliate's page box around the frame (it hides the pages either side, which
   * lie in the frame's columns too), within the book's area. Null if the page is not shown.
   */
  const shownOf = useCallback((doc: Document): Box | null => {
    const frameEl = doc.defaultView?.frameElement as HTMLElement | null;
    const seen = (frameEl?.parentElement?.parentElement ?? frameEl)?.getBoundingClientRect();
    const clip = lensEl.current?.parentElement?.getBoundingClientRect();
    if (!seen || !clip) return null;
    const box = { left: Math.max(seen.left, clip.left), right: Math.min(seen.right, clip.right), top: Math.max(seen.top, clip.top), bottom: Math.min(seen.bottom, clip.bottom) };
    return box.right > box.left && box.bottom > box.top ? box : null;
  }, []);

  /**
   * Shows the band on a line of a book's page (`band`, in that page's coordinates). `anchor`: as showLens. `glide`:
   * false to jump (the band following its line as the page moves).
   */
  const showLensOn = useCallback(
    (doc: Document, band: Box & { lead?: number }, anchor = false, glide = true) => {
      const frame = (doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect();
      if (!frame) return;
      lensLine.current = { doc, band };
      const lead = band.lead === undefined ? undefined : frame.top + band.lead;
      showLens({ left: frame.left + band.left, right: frame.left + band.right, top: frame.top + band.top, bottom: frame.top + band.bottom }, anchor, glide, lead);
    },
    [showLens],
  );

  /**
   * The ruler held where the reader put it on screen (lensAnchor): the line there comes into focus. "still" (Scroll,
   * while the text moves): the band stays exactly where it is and the text passes under it; a gap between paragraphs
   * there leaves the whole page dimmed. "settle" (Scroll, the text has stopped): the band also moves onto that line,
   * by less than half a line. "align" (Pages, or a new layout): the same, but with no line there it gives up. Returns
   * false when the ruler cannot be held: none yet, its point is off the book (the window changed), or, aligning, no
   * line there.
   */
  const holdLens = useCallback(
    (how: "still" | "settle" | "align") => {
      const at = lensAnchor.current;
      const v = view.current;
      const clip = lensEl.current?.parentElement?.getBoundingClientRect();
      if (!at || !lens.current || !v?.renderer || !clip) return false;
      const { x, y } = at;
      if (y < clip.top || y > clip.bottom || x < clip.left || x > clip.right) return false;
      let contents: { doc: Document }[] = [];
      try {
        contents = v.renderer.getContents();
      } catch {
        return false;
      }
      for (const { doc } of contents) {
        const frame = (doc?.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect();
        if (!frame || y < frame.top || y > frame.bottom || x < frame.left || x > frame.right) continue;
        const band = focusAt(doc, x - frame.left, y - frame.top, how !== "align");
        // In Pages, the line must be on the page shown, not on the one beside it, hidden in the same frame.
        const seen = shownOf(doc);
        const middle = band ? frame.left + (band.left + band.right) / 2 : NaN;
        if (how === "align" && (!band || !seen || middle < seen.left || middle > seen.right)) return false;
        if (band && how !== "still") showLensOn(doc, band);
        return true;
      }
      return false;
    },
    [showLensOn, view, shownOf],
  );

  /**
   * Puts the ruler (Focus, M21) where it belongs. A mouse resting on the text: the line under it. Else, in Scroll,
   * the band stays where it is on screen and the text moves under it (Samuel, 2026-11-08, from Apple Books); in Pages
   * it stays on its line until the page turns (a tap's own small settling of the page is not a turn). Else (a page
   * turned, or nothing placed yet) the first line on screen. `range` and `cfi`: the text on screen and its place, from
   * a relocate; none after a new layout.
   */
  const placeRuler = useCallback(
    (contents: { doc: Document }[], range?: Range | null, cfi?: string | null) => {
      const v = view.current;
      if (!v?.renderer) return;
      // The lines may have moved under the same boxes (a new text size): what was in focus is worked out afresh.
      for (const { doc } of contents) if (doc?.documentElement) clearFocus(doc);
      const p = pointer.current;
      if (p?.inside) {
        for (const { doc } of contents) {
          const frame = (doc?.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect();
          const band = frame && focusAt(doc, p.x - frame.left, p.y - frame.top);
          if (frame && band) {
            showLensOn(doc, band, true);
            return;
          }
        }
      }
      const scrolled = v.renderer.getAttribute("flow") === "scrolled";
      const samePage = !cfi || cfi === lensPlace.current;
      if (cfi) lensPlace.current = cfi;
      if (lens.current && (scrolled || samePage) && holdLens(scrolled && cfi ? "settle" : "align")) return;
      // The first letter on screen: inside the book's area (foliate's range can start with a space left at the end
      // of the page before, or, in WebKit while a page is laid out again, on the page before).
      const onScreen = range ?? (v as { lastLocation?: { range?: Range | null } | null }).lastLocation?.range;
      const doc = onScreen?.startContainer.ownerDocument;
      const frame = (doc?.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect();
      const seen = doc ? shownOf(doc) : null;
      if (!onScreen || !doc || !frame || !seen) return;
      const spot = firstLetterInside(
        onScreen,
        (b) => frame.left + b.left >= seen.left - 1 && frame.left + b.right <= seen.right + 1 && frame.top + b.top >= seen.top - 1 && frame.top + b.bottom <= seen.bottom + 1,
      );
      const letter = doc.createRange();
      if (spot) {
        letter.setStart(spot.node, spot.offset);
        letter.setEnd(spot.node, spot.offset + 1);
      }
      const r = spot ? Array.from(letter.getClientRects()).find((b) => b.width > 0 && b.height > 0) : null;
      const band = r ? focusAt(doc, r.left + 1, (r.top + r.bottom) / 2) : null;
      if (band) showLensOn(doc, band, true);
      else showLens(null);
    },
    [showLens, showLensOn, holdLens, view, shownOf],
  );

  /**
   * Puts Focus (M21) where it belongs on the pages shown. The ruler: placeRuler. Paragraph focus: the paragraph read
   * aloud; else what is under a mouse resting on the page; else the first paragraph on the page (the keyboard, a tap
   * elsewhere, or a page just opened). `range` and `cfi`: the text on screen and its place, from a relocate.
   */
  const refocus = useCallback((range?: Range | null, cfi?: string | null) => {
    const v = view.current;
    const mode = focusRef.current;
    if (!v?.renderer || mode === "off") return;
    let contents: { doc: Document }[] = [];
    try {
      contents = v.renderer.getContents();
    } catch {
      return;
    }
    if (mode === "ruler") {
      placeRuler(contents, range, cfi);
      return;
    }
    for (const { doc } of contents) {
      if (!doc?.documentElement || !doc.body) continue;
      clearFocus(doc);
      const spoken = spokenBlock.current;
      if (mode === "paragraph" && spoken && doc.contains(spoken)) {
        focusBlock(doc, spoken);
        continue;
      }
      const frameEl = doc.defaultView?.frameElement as HTMLElement | null;
      const frame = frameEl?.getBoundingClientRect();
      const p = pointer.current;
      if (p?.inside && frame && focusAt(doc, p.x - frame.left, p.y - frame.top)) continue;
      const onScreen = range ?? (v as { lastLocation?: { range?: Range | null } | null }).lastLocation?.range;
      if (!frameEl || !frame || !onScreen || onScreen.startContainer.ownerDocument !== doc) continue;
      // The first text inside the box that shows the page (foliate's page container, around the frame's own box):
      // the range can start with a space left at the end of the page before, which lies outside it.
      const seen = (frameEl.parentElement?.parentElement ?? v).getBoundingClientRect();
      const first = Array.from(onScreen.getClientRects()).find(
        (r) =>
          r.width > 0 &&
          r.height > 0 &&
          frame.left + r.left >= seen.left - 1 &&
          frame.left + r.right <= seen.right + 1 &&
          frame.top + r.top >= seen.top - 1 &&
          frame.top + r.bottom <= seen.bottom + 1,
      );
      if (first) focusAt(doc, first.left + 1, (first.top + first.bottom) / 2);
    }
  }, [placeRuler, view, focusRef]);

  return { spokenBlock, pointer, lensEl, lens, lensLine, lensPlace, shownOf, showLens, showLensOn, holdLens, refocus };
}
