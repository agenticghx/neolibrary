import { type RefObject } from "react";
import type { Annotation } from "@/lib/library/annotations";
import { PEN_PATHS } from "@/lib/library/drawings";
import { PICTURE_PATHS } from "@/lib/library/pinned";
import { STICKERS } from "@/lib/library/stickers";
import type { XrayMark } from "@/lib/library/xray";
import { SPREAD_SETTLE_MS, spreadAlign } from "@/lib/reader/spread-scroll";
import { type Box } from "./focus";
import { EINK_LINES, drawBadge, einkUnderline, type DrawFn, type FoliateView, type ReaderPanel } from "./reader-helpers";
import { drawMarks, entryOfKey, namesOnScreen, type DrawnMark } from "./xray-marks";

/**
 * Marks on the open book (foliate's overlay events): the reader's highlights, stickers, drawings and pictures are
 * drawn, each chapter's X-ray names are underlined, and a tap on a mark opens its note or its name's card. Gives back
 * the two functions the reader uses when the page turns. Moved out of Reader.tsx as it was (the version 2 split).
 */
export function bindMarks(deps: {
  v: FoliateView;
  props: { bookId: string; fileType: "epub" | "pdf"; visitor: boolean };
  /** foliate's own highlight drawing, loaded with the book. */
  Overlayer: { highlight: DrawFn };
  xrayMarks: RefObject<Map<number, Promise<XrayMark[]>>>;
  xrayDrawn: RefObject<Map<number, DrawnMark[]>>;
  notesRef: RefObject<Annotation[]>;
  root: RefObject<HTMLDivElement | null>;
  /** E-ink is on: marks are underlined in ink, not tinted. */
  einkRef: RefObject<boolean>;
  setOnPage: (names: { id: string; name: string }[]) => void;
  setXrayCard: (entry: string) => void;
  setActiveId: (id: string) => void;
  setPanel: (panel: ReaderPanel) => void;
}) {
  const { v, props, Overlayer, xrayMarks, xrayDrawn, notesRef, root, einkRef, setOnPage, setXrayCard, setActiveId, setPanel } = deps;
  /** A chapter's X-ray marks (M32 X2), fetched once per chapter. */
  const marksOf = (index: number) => {
    let p = xrayMarks.current.get(index);
    if (!p) {
      p = fetch(`/api/books/${props.bookId}/xray/marks?chapter=${index}`)
        .then((r) => (r.ok ? r.json() : { marks: [] }))
        .then((b: { marks: XrayMark[] }) => b.marks)
        .catch(() => []);
      xrayMarks.current.set(index, p);
    }
    return p;
  };
  /** The names on the screen now: the marks of the chapter shown that lie inside the visible range. */
  const showOnPage = (index: number, range?: Range | null) => {
    const visible = range ?? (v as { lastLocation?: { range?: Range | null } | null }).lastLocation?.range;
    setOnPage(namesOnScreen(xrayDrawn.current.get(index) ?? [], visible));
  };
  v.addEventListener("create-overlay", (e: Event) => {
    for (const a of notesRef.current) if (["highlight", "sticker", "drawing", "image"].includes(a.kind) && a.cfi) void v.addAnnotation({ value: a.cfi });
    // The chapter's names, underlined (EPUBs: a PDF's pages have no overlay).
    const { index } = (e as CustomEvent<{ index: number }>).detail;
    if (props.visitor || props.fileType === "pdf" || !Number.isInteger(index)) return;
    void marksOf(index).then((marks) => {
      if (!root.current) return;
      const color = getComputedStyle(root.current).getPropertyValue("--accent").trim();
      xrayDrawn.current.set(index, drawMarks(v, index, marks, color));
      showOnPage(index);
    });
  });
  v.addEventListener("draw-annotation", (e: Event) => {
    const { draw, annotation, range } = (e as CustomEvent<{ draw: (f: DrawFn, o: unknown) => void; annotation: { value: string }; range: Range | null }>)
      .detail;
    const a = notesRef.current.find((x) => x.cfi === annotation.value);
    const cs = getComputedStyle(root.current!);
    const ink = cs.getPropertyValue("--ink-900").trim();
    // M42 S1: with E-ink on, a passage is underlined in ink (a sticker's, a picture's or a drawing's solid; a
    // highlight's in its colour's line), and the badges stay, in greys.
    const passage: DrawFn = einkRef.current ? einkUnderline("solid", ink) : Overlayer.highlight;
    if (a?.kind === "sticker" && a.sticker) {
      const fill = cs.getPropertyValue(`--mark-${STICKERS[a.sticker].color}`).trim();
      draw(drawBadge(STICKERS[a.sticker].paths, fill, ink, passage, range ?? null), {});
      return;
    }
    if (a?.kind === "image") {
      draw(drawBadge(PICTURE_PATHS, cs.getPropertyValue("--mark-sage").trim(), ink, passage, range ?? null, "right"), {});
      return;
    }
    if (a?.kind === "drawing") {
      draw(drawBadge(PEN_PATHS, cs.getPropertyValue("--mark-sky").trim(), ink, passage, range ?? null, "right"), {});
      return;
    }
    if (einkRef.current) {
      draw(einkUnderline(EINK_LINES[a?.color ?? "sage"] ?? "solid", ink), {});
      return;
    }
    const color = cs.getPropertyValue(`--mark-${a?.color ?? "sage"}`).trim();
    draw(Overlayer.highlight, { color });
  });
  v.addEventListener("show-annotation", (e: Event) => {
    const entry = entryOfKey((e as CustomEvent<{ value: string }>).detail.value);
    if (entry) {
      setXrayCard(entry);
      return;
    }
    const a = notesRef.current.find((x) => x.cfi === (e as CustomEvent<{ value: string }>).detail.value);
    if (a) {
      setActiveId(a.id);
      setPanel(a.kind === "image" ? "picture" : "notes");
    }
  });
  return { marksOf, showOnPage };
}

/**
 * The open book scrolls or lands on a place: the ruler keeps to its line, and in Two pages in Scroll a jump is lined
 * up on the spread it lands in. Moved out of Reader.tsx as it was (the version 2 split).
 */
export function bindScroll(deps: {
  v: FoliateView;
  focusRef: RefObject<string>;
  lensLine: RefObject<{ doc: Document; band: Box & { lead?: number } } | null>;
  lens: RefObject<Box | null>;
  pointer: RefObject<{ x: number; y: number; inside: boolean } | null>;
  /** Two pages in Scroll: the distance between two stacked spreads, or 0 for one column. */
  spreadRef: RefObject<number>;
  showLensOn: (doc: Document, band: Box & { lead?: number }, anchor?: boolean, glide?: boolean) => void;
  shownOf: (doc: Document) => Box | null;
  refocus: (range?: Range | null, cfi?: string | null) => void;
  holdLens: (how: "still") => void;
}) {
  const { v, focusRef, lensLine, lens, pointer, spreadRef, showLensOn, shownOf, refocus, holdLens } = deps;
  // Two pages in Scroll: a jump (opening the book, a chapter, a search hit, a new layout) is lined up on the
  // spread it lands in. foliate places a jump's target again as fonts and pictures arrive, and drops a turn
  // asked for while one is under way, so the lining up waits until the jump has settled. Scrolling by hand is
  // left where it stops.
  // Focus (M21), in Scroll: the ruler stays where it is on screen while the text moves under it, and the line
  // under it comes into focus, once a frame (a mouse resting on the text: the line under the mouse).
  // In Pages, the band stays on its line as the page moves (WebKit can report a page's place before it has
  // finished moving it there: the band then landed a page to the side, 2026-11-08).
  let rolling = 0;
  v.renderer.addEventListener("scroll", () => {
    if (focusRef.current !== "ruler" || rolling) return;
    rolling = requestAnimationFrame(() => {
      rolling = 0;
      const line = lensLine.current;
      if (v.renderer.getAttribute("flow") !== "scrolled") {
        if (!line?.doc.defaultView) return;
        showLensOn(line.doc, line.band, true, false);
        // Moved off the page shown (its page went by without a relocate): the first line on screen.
        const at = lens.current;
        const seen = shownOf(line.doc);
        const middle = at ? (at.left + at.right) / 2 : NaN;
        if (at && (!seen || middle < seen.left || middle > seen.right)) refocus();
      } else if (pointer.current?.inside) refocus();
      else holdLens("still");
    });
  });
  let lineUp: ReturnType<typeof setTimeout> | undefined;
  v.renderer.addEventListener("relocate", (e: Event) => {
    const reason = (e as CustomEvent<{ reason?: string }>).detail?.reason;
    if (reason === "scroll") clearTimeout(lineUp);
    if (!spreadRef.current || (reason !== "anchor" && reason !== "navigation")) return;
    clearTimeout(lineUp);
    lineUp = setTimeout(() => {
      const pitch = spreadRef.current;
      if (!pitch) return;
      const d = spreadAlign(v.renderer.start ?? 0, pitch);
      if (Math.abs(d) > 1) void (d > 0 ? v.next(d) : v.prev(-d));
    }, SPREAD_SETTLE_MS);
  });
}
