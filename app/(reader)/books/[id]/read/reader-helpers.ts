// Helpers of the reader page that hold no component state, moved out of Reader.tsx unchanged (2026-11-10, the
// Reader split): drawing marks, theme colours, PDF page helpers, a visitor's saved place.

import { mark } from "@/lib/perf-marks";
import { canWrapColumns, SPREAD_COLUMN_GAP, SPREAD_MAX_WIDTH, spreadCss, spreadPitch } from "@/lib/reader/spread-scroll";
import { rangeForNonSpace } from "@/lib/reader/text-range";
import { bookCss, type ReaderSettings, WIDTH_PX } from "./settings";
import { type TocItem } from "./ReaderControls";
import styles from "./reader.module.css";

export type FoliateView = HTMLElement & {
  open(book: File | object): Promise<void>;
  init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  next(distance?: number): Promise<void>;
  close(): void;
  book: { toc?: TocItem[]; dir?: string; rendition?: { spread?: string }; sections?: unknown[]; pageList?: { label: string; href: string }[] };
  /** `index`: in a PDF, the page shown, or being opened once a turn has begun. */
  renderer: HTMLElement & {
    setStyles?(css: string): void;
    getContents(): { doc: Document; index: number }[];
    readonly index?: number;
    /** In Scroll, how far down the chapter the top of the screen is (px). */
    readonly start?: number;
  };
  getCFI(index: number, range: Range): string;
  resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range };
  addAnnotation(a: { value: string }): Promise<unknown>;
  deleteAnnotation(a: { value: string }): Promise<unknown>;
};
export type Relocate = { cfi: string; fraction: number; tocItem?: { label?: string; href?: string }; pageItem?: { label?: string }; range?: Range };
export type DrawFn = (rects: unknown, opts?: unknown) => SVGElement;

export const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Draws a sticker or a handwritten note's mark: the passage tinted (like a
 * highlight) and a small badge in the margin beside its first line, so
 * no text is covered. The line's start is found from the paragraph each time
 * the overlay redraws (after a resize, for example).
 */
export function drawBadge(paths: readonly string[], fill: string, ink: string, highlight: DrawFn, range: Range | null, side: "left" | "right" = "left"): DrawFn {
  return (rects, opts) => {
    const ns = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(ns, "g");
    const list = rects as DOMRect[];
    const first = list[0];
    g.append(highlight(rects, { ...(opts as object), color: fill }));
    if (!first) return g as unknown as SVGElement;
    // The column fragment of the paragraph that holds the first line: its left edge is where the line starts.
    const start = range?.startContainer;
    const block = (start?.nodeType === Node.ELEMENT_NODE ? (start as Element) : start?.parentElement)?.closest("p, li, blockquote, dd, div, h1, h2, h3, h4, h5, h6");
    const frags = block ? Array.from(block.getClientRects()) : [];
    const frag = frags.find((f) => first.left >= f.left - 1 && first.left <= f.right + 1 && first.top >= f.top - 1 && first.top <= f.bottom + 1);
    const size = 16;
    // Stickers go in the left margin, handwriting marks in the right one, so both can sit on one line.
    const cx = side === "left" ? (frag?.left ?? first.left) - size / 2 - 8 : (frag?.right ?? first.right) + size / 2 + 8;
    const cy = first.top + first.height / 2;
    const disc = document.createElementNS(ns, "circle");
    disc.setAttribute("cx", String(cx));
    disc.setAttribute("cy", String(cy));
    disc.setAttribute("r", String(size / 2));
    disc.setAttribute("fill", fill);
    disc.setAttribute("stroke", ink);
    disc.setAttribute("stroke-width", "1");
    g.append(disc);
    for (const d of paths) {
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", ink);
      p.setAttribute("stroke-width", "2.6");
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("stroke-linejoin", "round");
      const inner = size - 4;
      p.setAttribute("transform", `translate(${cx - inner / 2} ${cy - inner / 2}) scale(${inner / 24})`);
      g.append(p);
    }
    return g as unknown as SVGElement;
  };
}

/**
 * M42 S1: a highlight on an e-ink screen. A tint is a pale grey there, hard to see, so the passage is underlined in
 * ink, and the highlight's colour is told by the line: sage solid, amber dashed, rose dotted, sky double. The saved
 * highlight is unchanged; turning E-ink off draws the tint again.
 */
export const EINK_LINES: Record<string, EinkLine> = { sage: "solid", amber: "dashed", rose: "dotted", sky: "double" };
export type EinkLine = "solid" | "dashed" | "dotted" | "double";
export function einkUnderline(line: EinkLine, ink: string): DrawFn {
  return (rects) => {
    const ns = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(ns, "g");
    g.setAttribute("data-eink-line", line);
    const dash = line === "dashed" ? "6 4" : line === "dotted" ? "1.5 3" : null;
    for (const { left, right, bottom } of rects as DOMRect[]) {
      for (const dy of line === "double" ? [0, 3.5] : [0]) {
        const l = document.createElementNS(ns, "line");
        l.setAttribute("x1", String(left));
        l.setAttribute("x2", String(right));
        l.setAttribute("y1", String(bottom + dy));
        l.setAttribute("y2", String(bottom + dy));
        l.setAttribute("stroke", ink);
        l.setAttribute("stroke-width", line === "double" ? "1.5" : "2");
        if (dash) l.setAttribute("stroke-dasharray", dash);
        if (line === "dotted") l.setAttribute("stroke-linecap", "round");
        g.append(l);
      }
    }
    return g as unknown as SVGElement;
  };
}

/** The quote around a selection (W3C TextQuoteSelector): exact text plus some words either side. */
export function quoteOf(doc: Document, range: Range) {
  const before = doc.createRange();
  before.setStart(doc.body, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const after = doc.createRange();
  after.setStart(range.endContainer, range.endOffset);
  after.setEnd(doc.body, doc.body.childNodes.length);
  return {
    exact: clean(range.toString()),
    prefix: before.toString().replace(/\s+/g, " ").slice(-64).trimStart(),
    suffix: after.toString().replace(/\s+/g, " ").slice(0, 64).trimEnd(),
  };
}

/** The theme's class on the reader element; with E-ink on (M42 S1), the E-ink colours in its place (light, or Night's dark). */
export const readerClass = (s: ReaderSettings) =>
  s.eink ? `${styles.reader} theme-eink${isDark(s) ? "-night" : ""}` : s.theme === "auto" ? styles.reader : `${styles.reader} theme-${s.theme}`;

export const TOKENS = { paper: "--paper", ink: "--ink-900", accent: "--accent", highlight: "--highlight", spoken: "--highlight-active" } as const;

/**
 * Lays the book out with the reader's settings. Returns the distance between two spreads when Two pages in Scroll
 * stacks them (spread-scroll.ts), or 0 for one column.
 */
export function applySettings(v: FoliateView, s: ReaderSettings, themeEl: Element): number {
  const r = v.renderer;
  if (!r.setStyles) return 0; // PDFs (fixed layout): pages are pictures; only the reader's chrome is themed.
  const pitch = spreadPitch(s, r.getBoundingClientRect(), canWrapColumns());
  r.setAttribute("flow", s.flow);
  // Two pages in Scroll: two columns side by side, so the text may be twice as wide.
  // M27 Q3: Width. Two pages in Scroll lays two such columns side by side.
  const column = WIDTH_PX[s.width];
  r.setAttribute("max-inline-size", pitch ? `${s.width === "comfortable" ? SPREAD_MAX_WIDTH : 2 * column + SPREAD_COLUMN_GAP}px` : `${column}px`);
  // In Pages, "2" is only the wide-window maximum: a window taller than it is wide still forces one (the paginator's
  // portrait rule). Scroll's two columns are the book's own CSS (spreadCss), under the same rule.
  r.setAttribute("max-column-count", s.flow === "paginated" && s.pages === "two" ? "2" : "1");
  r.setAttribute("margin", "40px");
  r.setAttribute("gap", "7%");
  r.setStyles?.(bookCss(s, themeColors(themeEl, s), location.origin) + (pitch ? spreadCss(pitch) : ""));
  return pitch;
}

/** The reader is dark: Night, or Auto while the device is dark. */
export const isDark = (s: ReaderSettings) =>
  s.theme === "night" || (s.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);

/** Colours for book pages, read from the design tokens on the reader element (so a theme class applies). */
export function themeColors(el: Element, s: ReaderSettings) {
  const cs = getComputedStyle(el);
  const colors: Record<string, string> = Object.fromEntries(
    Object.entries(TOKENS).map(([k, v]) => [k, cs.getPropertyValue(v).trim()]),
  );
  colors.scheme = isDark(s) ? "dark" : "light";
  return colors;
}

/**
 * Read along in a PDF (M13 (e)): lights non-space characters [a, b) of a
 * page's text layer, in that page's own frame; returns their text, or null
 * if the text layer is not drawn yet. `via`: who asked (the player's frame,
 * or the page's text arriving), for the tests' timing marks. The frames of
 * every other page lose their lit word: with two pages side by side, the page
 * read before kept its last word lit while the next page was read
 * (2026-10-09). A second frame of the same page (one being replaced as the
 * window changes size) keeps its own, so neither can unlight the other.
 */
export function lightPdfWord(v: FoliateView, doc: Document, [a, b]: [number, number], via: "word" | "text-layer"): string | null {
  const layer = doc.querySelector(".textLayer");
  const range = layer ? rangeForNonSpace(layer, a, b) : null;
  if (!range) return null;
  const page = doc.documentElement.dataset.page;
  for (const item of v.renderer?.getContents() ?? []) {
    if (item.doc && item.doc.documentElement.dataset.page !== page) (item.doc.defaultView as (Window & { CSS: typeof CSS }) | null)?.CSS.highlights?.delete("nl-spoken");
  }
  const win = doc.defaultView as (Window & { CSS: typeof CSS; Highlight: typeof Highlight }) | null;
  win?.CSS.highlights?.set("nl-spoken", new win.Highlight(range));
  const text = range.toString();
  mark("nl:lit", { page: Number(doc.documentElement.dataset.page), at: a, text, via });
  return text;
}

/**
 * Records the word read aloud on the Listen bar (its data-word: read by the
 * tests, shown and announced nowhere) in the same step as the word is lit,
 * wherever it is lit. Written later, as React state was, the record trailed
 * the highlight behind any long task: at a PDF page break on CI, a failed
 * system-font lookup held the page 38 ms and the bar showed the word 90 ms
 * after the book did (LEARNING_LOG, Iterations 25 and 39). A word already
 * recorded is not written again.
 */
export function recordLit(bar: HTMLElement | null, text: string | null) {
  if (bar && text !== null && bar.getAttribute("data-word") !== text) {
    bar.setAttribute("data-word", text);
    mark("nl:bar-set", { text });
  }
  return text;
}

/** The PDF page foliate shows, or is opening once a turn has begun (-1 before the first: foliate's getter throws then). */
export function pageOpening(v: FoliateView) {
  try {
    return v.renderer.index ?? -1;
  } catch {
    return -1;
  }
}

/** A PDF page's index from its address (epubcfi(/6/2) is the first page), or -1. */
export function pdfPage(cfi: string) {
  const n = Number(/^epubcfi\(\/6\/(\d+)\)$/.exec(cfi)?.[1]) / 2 - 1;
  return Number.isInteger(n) && n >= 0 ? n : -1;
}

/** PDF page documents whose frames are actually on screen. A hidden partner of a pair is not. */
export function pdfDocsOnScreen(v: FoliateView): Document[] {
  try {
    const docs: Document[] = [];
    for (const item of v.renderer?.getContents() ?? []) {
      const doc = item.doc;
      const frame = doc?.defaultView?.frameElement as HTMLElement | null;
      const host = frame?.parentElement;
      if (!doc || !host?.isConnected) continue;
      const box = host.getBoundingClientRect();
      if (getComputedStyle(host).display === "none" || box.width <= 2 || box.height <= 2) continue;
      docs.push(doc);
    }
    return docs;
  } catch {
    return [];
  }
}

/**
 * How long the reader waits before it says a book could not be opened: for
 * the next piece of the file while it downloads (a large PDF on a slow
 * connection may take minutes in all, M20), then for the book to open.
 */
export const OPEN_TIMEOUT_MS = 30_000;

/** Fired once a book's notes have loaded: send what waits in the outbox (M12). */
export const SYNC_EVENT = "neolibrary:sync-notes";

/** M34 S3: a visitor's place in a free book, kept in this browser only (never on the server). */
export const visitorPlaceKey = (bookId: string) => `neolibrary:visitor-place:${bookId}`;
export function visitorPlace(bookId: string): string | null {
  try {
    return localStorage.getItem(visitorPlaceKey(bookId));
  } catch {
    return null; // storage blocked (a private window): open at the start
  }
}
export function saveVisitorPlace(bookId: string, cfi: string) {
  try {
    localStorage.setItem(visitorPlaceKey(bookId), cfi);
  } catch {
    // storage blocked: the place is not kept
  }
}

export const noSubscribe = () => () => {};
export const onFullscreenChange = (changed: () => void) => {
  document.addEventListener("fullscreenchange", changed);
  return () => document.removeEventListener("fullscreenchange", changed);
};

/** One JSON request to the library; an error answer throws its own words ("Not saved" if it has none). */
export const api = async (url: string, method: string, body?: unknown) => {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Not saved");
  return res.status === 204 ? null : res.json();
};
