import { type RefObject } from "react";
import { mark } from "@/lib/perf-marks";
import { TEXT_LAYER_EVENT } from "@/lib/reader/pdf-book";
import { bindSpineClick, pdfSpread } from "@/lib/reader/spine-fold";
import { scrollsItself, swipeDirection } from "@/lib/reader/swipe-turn";
import { wrapCitations, type ReaderCitations } from "./citations";
import { type EquationAsk } from "./EquationView";
import { equationAt, figureAt, markWideTables, tableAt, type Figure, type TappedTable } from "./figure";
import { placeRedraws, type ReaderFigure } from "./figure-redraws";
import { focusAt, setFocusMode, type Box } from "./focus";
import { lightPdfWord, quoteOf, recordLit, type FoliateView } from "./reader-helpers";
import { type PendingSelection } from "./SelectionBar";
import { type FigureMode, type FocusMode, type RulerLines } from "./settings";

/** What a page of the book needs from the reader when it loads: the open book, and the reader's values and functions. */
export type PageDeps = {
  v: FoliateView;
  props: { bookId: string; fileType: "epub" | "pdf" };
  citationsRef: RefObject<ReaderCitations | null | undefined>;
  figuresRef: RefObject<ReaderFigure[]>;
  figureModeRef: RefObject<FigureMode>;
  loadRedraw: (url: string) => Promise<string>;
  spokenPdf: RefObject<{ page: number; at: [number, number] } | null>;
  listenBar: RefObject<HTMLDivElement | null>;
  placeCrossed: (doc: Document, index: number) => void;
  onKey: (e: KeyboardEvent) => void;
  onWheel: (e: WheelEvent) => void;
  turnRef: RefObject<(dir: "next" | "prev") => void>;
  trackerRef: RefObject<{ onActivity: () => void }>;
  wake: RefObject<(e: Event, top?: number) => void>;
  dismissSelection: () => void;
  setEquation: (equation: EquationAsk) => void;
  setWholeTable: (table: TappedTable) => void;
  setFigure: (figure: Figure) => void;
  focusRef: RefObject<FocusMode>;
  rulerLinesRef: RefObject<RulerLines>;
  pointer: RefObject<{ x: number; y: number; inside: boolean } | null>;
  spokenBlock: RefObject<Element | null>;
  showLensOn: (doc: Document, band: Box & { lead?: number }, anchor?: boolean, glide?: boolean) => void;
  lensPlace: RefObject<string | null>;
  whereCfi: RefObject<string | null>;
  pageDocs: RefObject<Set<Document>>;
  dimRef: RefObject<boolean>;
  selectionDoc: RefObject<Document | null>;
  setSelection: (selection: PendingSelection) => void;
};

/**
 * A page of the book has loaded in its own frame (foliate's "load" event): everything the reader listens for inside
 * it is set up here. A paper's citations and redrawn figures, the spoken word in a PDF, keys and the wheel, a finger
 * swipe, taps on figures, tables and equations, the ruler following the pointer, a PDF's fold, and text selection.
 * Moved out of Reader.tsx as it was (the version 2 split); the reader hands over what it uses.
 */
export function bindPage(e: Event, deps: PageDeps) {
  const { v, props, citationsRef, figuresRef, figureModeRef, loadRedraw, spokenPdf, listenBar, placeCrossed, onKey, onWheel, turnRef, trackerRef, wake, dismissSelection, setEquation, setWholeTable, setFigure, focusRef, rulerLinesRef, pointer, spokenBlock, showLensOn, lensPlace, whereCfi, pageDocs, dimRef, selectionDoc, setSelection } = deps;
  const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;
  mark("nl:frame-load", { index, page: doc.documentElement.dataset.page ?? null });
  // M41 R5: a paper's citations wrapped first, before the page is laid out or any note drawn on it.
  const citations = citationsRef.current;
  if (citations && props.fileType !== "pdf") {
    wrapCitations(doc, index, citations, (cfi) => {
      try {
        const start = v.resolveCFI(cfi).anchor(doc).startContainer;
        return start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
      } catch {
        return null;
      }
    });
  }
  // M41 R6: a paper's redrawn figures in place of the printed ones (only their addresses change).
  if (figuresRef.current.length && props.fileType !== "pdf") {
    const chapter = (v.book as { sections?: { id?: string }[] } | undefined)?.sections?.[index]?.id;
    placeRedraws(doc, chapter, figuresRef.current, props.bookId, location.origin, () => figureModeRef.current, loadRedraw);
  }
  // A PDF page's text layer is complete (the page was just shown) or
  // was laid out for a new size: light the spoken word on it again.
  doc.addEventListener(TEXT_LAYER_EVENT, () => {
    const w = spokenPdf.current;
    if (w && doc.documentElement.dataset.page === String(w.page)) recordLit(listenBar.current, lightPdfWord(v, doc, w.at, "text-layer"));
    placeCrossed(doc, index);
  });
  if (props.fileType !== "pdf") placeCrossed(doc, index);
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("wheel", onWheel, { passive: false });
  // A finger swipe turns the page where foliate has no swipe of its own: Scroll, and a PDF's pages (#235).
  // A swipe that starts on a wide table is the table's.
  let touchAt: { x: number; y: number; t: number } | null = null;
  doc.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      const path = e.composedPath();
      touchAt = e.touches.length === 1 && t && !scrollsItself(path, "x", 1) && !scrollsItself(path, "x", -1) ? { x: t.clientX, y: t.clientY, t: e.timeStamp } : null;
    },
    { passive: true },
  );
  doc.addEventListener("touchend", (e) => {
    const a = touchAt;
    touchAt = null;
    const t = e.changedTouches[0];
    if (!a || !t || v.renderer?.getAttribute("flow") === "paginated") return;
    const selected = doc.getSelection();
    if (selected && !selected.isCollapsed) return;
    const dir = swipeDirection(a, { x: t.clientX, y: t.clientY, t: e.timeStamp });
    if (dir) turnRef.current(dir);
  });
  doc.addEventListener("keydown", () => trackerRef.current.onActivity());
  // Movement in the page wakes full screen's bars (the page is a frame of its own: its events stay in it).
  // Its pointer is measured from the frame's top, so the frame's own top is added (the edges are the screen's).
  for (const name of ["pointermove", "pointerdown", "keydown"])
    doc.addEventListener(name, (e) => wake.current(e, doc.defaultView?.frameElement?.getBoundingClientRect().top ?? 0), { passive: true });
  doc.addEventListener("pointerdown", () => {
    trackerRef.current.onActivity();
    // A tap or click on the page closes the selected-text bar (M27 Q1); a new selection opens it again.
    dismissSelection();
  });
  if (props.fileType !== "pdf") {
    // M41: tap a picture (a paper's figure) to see it full screen; not while text is being selected.
    doc.addEventListener("click", (e) => {
      const selected = doc.getSelection();
      if (selected && !selected.isCollapsed) return;
      // M41 R4b: a displayed equation (with its LaTeX) opens Explain this equation.
      const m = equationAt(e.target);
      if (m) {
        const range = doc.createRange();
        range.selectNodeContents(m.paragraph as Node);
        e.preventDefault();
        setEquation({ cfi: v.getCFI(index, range), latex: m.latex, number: m.number });
        return;
      }
      // M41: a table wider than its column (clipped on the page) is shown whole.
      const t = tableAt(e.target);
      if (t) {
        e.preventDefault();
        setWholeTable(t);
        return;
      }
      const f = figureAt(e.target);
      if (!f) return;
      e.preventDefault();
      setFigure(f);
    });
    // M41: mark the tables wider than the column, and again whenever the page is laid out anew.
    markWideTables(doc);
    const View = doc.defaultView as (Window & typeof globalThis) | null;
    if (View?.ResizeObserver) new View.ResizeObserver(() => markWideTables(doc)).observe(doc.body);
    // Focus (M21): the line or paragraph under the mouse as it moves (once a frame), or where a finger taps.
    setFocusMode(doc, focusRef.current, rulerLinesRef.current);
    let frame = 0;
    let at = { x: 0, y: 0 };
    const follow = (e: PointerEvent, now: boolean) => {
      const box = (doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect();
      if (box) pointer.current = { x: box.left + e.clientX, y: box.top + e.clientY, inside: e.pointerType === "mouse" };
      // While a paragraph is read aloud, paragraph focus stays on it.
      if (focusRef.current === "off" || (focusRef.current === "paragraph" && spokenBlock.current)) return;
      at = { x: e.clientX, y: e.clientY };
      // The ruler's band goes onto the line, over the book; it stays there (a tap's small settling of the
      // page is not a turn: refocus).
      const place = () => {
        const band = focusAt(doc, at.x, at.y);
        if (!band || focusRef.current !== "ruler") return;
        showLensOn(doc, band, true);
        lensPlace.current = whereCfi.current;
      };
      if (now) place();
      else if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          place();
        });
    };
    // A browser sends mouse events of its own just after a tap, and WebKit again when the text scrolls under
    // the place last tapped or pointed at (the pointer has not moved on the screen): neither is a mouse
    // moving on the page.
    let touched = -Infinity;
    let last = { x: NaN, y: NaN };
    const moved = (e: PointerEvent) => {
      const was = last;
      last = { x: e.screenX, y: e.screenY };
      return e.screenX !== was.x || e.screenY !== was.y;
    };
    doc.addEventListener("pointermove", (e) => {
      if (moved(e) && e.pointerType === "mouse" && e.timeStamp - touched > 800) follow(e, false);
    });
    doc.addEventListener("pointerdown", (e) => {
      moved(e);
      if (e.pointerType !== "mouse") touched = e.timeStamp;
      follow(e, true);
    });
    doc.addEventListener("pointerout", (e) => {
      if (!e.relatedTarget && pointer.current) pointer.current = { ...pointer.current, inside: false };
    });
  }
  if (props.fileType === "pdf") {
    pageDocs.current.add(doc);
    doc.documentElement.toggleAttribute("data-dim", dimRef.current);
    bindSpineClick(
      doc,
      (pageDoc) => {
        const spread = pdfSpread(v);
        if (!spread) return null;
        if (pageDoc === spread.left.doc) return "prev";
        if (pageDoc === spread.right.doc) return "next";
        return null;
      },
      (dir) => turnRef.current(dir),
    );
  }
  // A text selection opens the selection bar (highlight, note, copy).
  let t: ReturnType<typeof setTimeout> | null = null;
  doc.addEventListener("selectionchange", () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      const sel = doc.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const quote = quoteOf(doc, range);
      if (!quote.exact) return;
      selectionDoc.current = doc;
      setSelection({ cfi: v.getCFI(index, range), ...quote });
    }, 250);
  });
}
