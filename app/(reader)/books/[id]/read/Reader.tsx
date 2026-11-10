"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as CFI from "foliate-js/epubcfi.js";
import { usePlayer } from "@/components/player/PlayerProvider";
import type { Annotation, Color, Kind } from "@/lib/library/annotations";
import { addToOutbox, describeRefused, flushOutbox, isOffline, opOf, outboxFor, removeFromOutbox, type OutboxItem } from "@/lib/outbox";
import { downloadBook, downloadedWords } from "@/lib/reader/download";
import type { CrossLink } from "@/lib/library/crosslinks";
import { STICKERS, type Sticker } from "@/lib/library/stickers";
import { PEN_PATHS } from "@/lib/library/drawings";
import { OwnKeysSetting } from "@/components/own-keys/OwnKeysSetting";
import { AiStyleSetting } from "./AiStyleSetting";
import { OfflineSetting } from "./OfflineSetting";
import { CrossLinksPanel } from "./CrossLinksPanel";
import { ExplainPanel } from "./ExplainPanel";
import { ListenBar } from "./ListenBar";
import { useReadingTracker } from "./useReadingTracker";
import { BookFocusLine, EndFocusDialog, FocusStrip, LeaveFocusDialog, StartFocusDialog } from "./FocusSession";
import { useBookFocus } from "./useBookFocus";
import {
  clearSession as clearFocusSession,
  DEFAULT_WAIT_MINUTES,
  type FocusSession,
  fromServer as focusFromServer,
  isOver as focusIsOver,
  loadSession as loadFocusSession,
  saveSession as saveFocusSession,
  type ServerFocus,
} from "@/lib/reader/focus-session";
import { ImagesPanel } from "./ImagesPanel";
import { PictureCard } from "./PictureCard";
import { PICTURE_PATHS, type PinnedPicture } from "@/lib/library/pinned";
import { mark } from "@/lib/perf-marks";
import { withCrossed } from "@/lib/reader/crossed-notes";
import { rangeForQuote } from "@/lib/reader/find-quote";
import { spreadForPages, TEXT_LAYER_EVENT } from "@/lib/reader/pdf-book";
import { bindSpineClick, pdfSpread, turnWithSpine, type SpineBook } from "@/lib/reader/spine-fold";
import { scrollsItself, swipeDirection, wheelTurner } from "@/lib/reader/swipe-turn";
import { canWrapColumns, SPREAD_COLUMN_GAP, SPREAD_MAX_WIDTH, SPREAD_SETTLE_MS, spreadAlign, spreadCss, spreadPitch, spreadTurn } from "@/lib/reader/spread-scroll";
import type { WhereWereWe } from "@/lib/library/where-were-we";
import { rangeForNonSpace, rangeForOffsets } from "@/lib/reader/text-range";
import { AskPanel } from "./AskPanel";
import { NeedToKnowPanel } from "./NeedToKnowPanel";
import { XrayPanel } from "./XrayPanel";
import { GenealogyPanel } from "./GenealogyPanel";
import { GenealogyView } from "./GenealogyView";
import type { GenealogyTop } from "./genealogy-views";
import type { GenealogyView as GenealogyData } from "@/lib/library/genealogy-view";
import { XrayCard } from "./XrayCard";
import { drawMarks, entryOfKey, namesOnScreen, type DrawnMark } from "./xray-marks";
import { FULL_IDLE_MS, fullEvent, wakesBars } from "./fullscreen";
import { onSidebarChange, setSidebarOpen, sidebarOpen } from "./sidebar";
import type { XrayMark } from "@/lib/library/xray";
import { NotesPanel } from "./NotesPanel";
import { QuestionsPanel } from "./QuestionsPanel";
import { WhereWereWeStrip } from "./WhereWereWe";
import { RewritePanel } from "./RewritePanel";
import { RewrittenPane } from "./RewrittenPane";
import { FindInBook } from "./FindInBook";
import { TURN_OFF, type AsYouTurn } from "@/lib/library/rewritten-turn";
import { SelectionBar, type PendingSelection } from "./SelectionBar";
import { bookCss, loadSettings, READER_THEMES, saveSettings, SIZES, type FigureMode, type FocusMode, type ReaderSettings, type RewrittenMode, type RulerLines, WIDTH_PX, withEink, withWidth } from "./settings";
import { clearFocus, firstLetter, firstLetterInside, focusAt, focusBlock, FOCUS_BLOCKS, markLine, setFocusMode, type Box, type Spot } from "./focus";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { FigureView } from "./FigureView";
import { TableView } from "./TableView";
import { equationAt, figureAt, markWideTables, tableAt, type Figure, type TappedTable } from "./figure";
import { filterCitationCfis, wrapCitations, type ReaderCitations } from "./citations";
import { placeRedraws, showFigures, type ReaderFigure } from "./figure-redraws";
import { EquationView, type EquationAsk } from "./EquationView";
import styles from "./reader.module.css";
import { voiceFetch } from "@/lib/own-keys";

type TocItem = { label: string; href: string; subitems?: TocItem[] };
type FoliateView = HTMLElement & {
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
type Relocate = { cfi: string; fraction: number; tocItem?: { label?: string; href?: string }; pageItem?: { label?: string }; range?: Range };
type DrawFn = (rects: unknown, opts?: unknown) => SVGElement;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Draws a sticker or a handwritten note's mark: the passage tinted (like a
 * highlight) and a small badge in the margin beside its first line, so
 * no text is covered. The line's start is found from the paragraph each time
 * the overlay redraws (after a resize, for example).
 */
function drawBadge(paths: readonly string[], fill: string, ink: string, highlight: DrawFn, range: Range | null, side: "left" | "right" = "left"): DrawFn {
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
const EINK_LINES: Record<string, EinkLine> = { sage: "solid", amber: "dashed", rose: "dotted", sky: "double" };
type EinkLine = "solid" | "dashed" | "dotted" | "double";
function einkUnderline(line: EinkLine, ink: string): DrawFn {
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
function quoteOf(doc: Document, range: Range) {
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
const readerClass = (s: ReaderSettings) =>
  s.eink ? `${styles.reader} theme-eink${isDark(s) ? "-night" : ""}` : s.theme === "auto" ? styles.reader : `${styles.reader} theme-${s.theme}`;

const TOKENS = { paper: "--paper", ink: "--ink-900", accent: "--accent", highlight: "--highlight", spoken: "--highlight-active" } as const;

/**
 * Lays the book out with the reader's settings. Returns the distance between two spreads when Two pages in Scroll
 * stacks them (spread-scroll.ts), or 0 for one column.
 */
function applySettings(v: FoliateView, s: ReaderSettings, themeEl: Element): number {
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
const isDark = (s: ReaderSettings) =>
  s.theme === "night" || (s.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);

/** Colours for book pages, read from the design tokens on the reader element (so a theme class applies). */
function themeColors(el: Element, s: ReaderSettings) {
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
function lightPdfWord(v: FoliateView, doc: Document, [a, b]: [number, number], via: "word" | "text-layer"): string | null {
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
function recordLit(bar: HTMLElement | null, text: string | null) {
  if (bar && text !== null && bar.getAttribute("data-word") !== text) {
    bar.setAttribute("data-word", text);
    mark("nl:bar-set", { text });
  }
  return text;
}

/** The PDF page foliate shows, or is opening once a turn has begun (-1 before the first: foliate's getter throws then). */
function pageOpening(v: FoliateView) {
  try {
    return v.renderer.index ?? -1;
  } catch {
    return -1;
  }
}

/** A PDF page's index from its address (epubcfi(/6/2) is the first page), or -1. */
function pdfPage(cfi: string) {
  const n = Number(/^epubcfi\(\/6\/(\d+)\)$/.exec(cfi)?.[1]) / 2 - 1;
  return Number.isInteger(n) && n >= 0 ? n : -1;
}

/** PDF page documents whose frames are actually on screen. A hidden partner of a pair is not. */
function pdfDocsOnScreen(v: FoliateView): Document[] {
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
const OPEN_TIMEOUT_MS = 30_000;

/** Fired once a book's notes have loaded: send what waits in the outbox (M12). */
const SYNC_EVENT = "neolibrary:sync-notes";

/** M34 S3: a visitor's place in a free book, kept in this browser only (never on the server). */
const visitorPlaceKey = (bookId: string) => `neolibrary:visitor-place:${bookId}`;
function visitorPlace(bookId: string): string | null {
  try {
    return localStorage.getItem(visitorPlaceKey(bookId));
  } catch {
    return null; // storage blocked (a private window): open at the start
  }
}
function saveVisitorPlace(bookId: string, cfi: string) {
  try {
    localStorage.setItem(visitorPlaceKey(bookId), cfi);
  } catch {
    // storage blocked: the place is not kept
  }
}

const noSubscribe = () => () => {};
const onFullscreenChange = (changed: () => void) => {
  document.addEventListener("fullscreenchange", changed);
  return () => document.removeEventListener("fullscreenchange", changed);
};

export function Reader(props: {
  /** The signed-in reader's account id: notes made offline wait on the device under it (lib/outbox.ts). "" for a visitor. */
  readerId: string;
  bookId: string;
  title: string;
  author: string;
  fileUrl: string;
  fileType: "epub" | "pdf";
  initialCfi: string | null;
  /** The place saved when the page was made (M27 Q2): opened elsewhere (?at=, ?page=), it is not a place to offer. */
  savedCfi?: string | null;
  initialFraction: number;
  /** Open with the Read aloud bar showing (Home's "Listen from here"); the reader still presses Play (Safari needs the click). */
  startListening?: boolean;
  /** M43: open the Genealogy views on a name ("person:Robert Noyce", from "Also in <book>" in another book's views). */
  openGenealogyAt?: string;
  /** The view the book opens in (M17), from the reader's account: the book alone, the rewrite beside it, or the rewrite alone. */
  rewrittenView?: RewrittenMode;
  /** M25: a scanned PDF and its text edition (two books): which one this is, so the footer offers Scan | Text. */
  edition?: { scanId: string; textId: string; current: "scan" | "text" };
  /** M25: open the text edition at the marker of this page of the scan. */
  openPage?: number;
  /** M28 S3: back on a later day, ask what the reader remembers of this chapter (lib/library/where-were-we.ts). */
  recall?: WhereWereWe | null;
  /**
   * M34 S3: a visitor (not signed in) reading a book that is free to read. Nothing is saved on the server: the
   * place is kept in this browser (visitorPlace), and the tools that need an account (notes, AI help, X-ray,
   * listening, focus, search, offline) are not offered. `backHref` is the book's page on the open shelf.
   */
  visitor?: { backHref: string };
  /** M34 S4: this reader pays for AI and voices with their own keys (anyone but the owner): the settings offer them. */
  ownKeys?: boolean;
  /** M41 R5: a paper's citations and reference list (lib/library/citations.ts), for Aa > Citations; null for a book without. */
  citations?: ReaderCitations | null;
  /** M41 R6: a paper's figures redrawn cleanly (lib/library/figure-redraws.ts), for Aa > Figures; empty for most books. */
  figures?: ReaderFigure[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  // Dimmed PDF pages (M19 P2): each page document as it loads, and whether pages are dimmed now.
  const pageDocs = useRef(new Set<Document>());
  const dimRef = useRef(false);
  const view = useRef<FoliateView | null>(null);
  /** The open PDF, when this book is one, so a fold can draw a page that is not on screen yet. */
  const bookRef = useRef<SpineBook | null>(null);
  const turnRef = useRef<(dir: "next" | "prev") => void>(() => {});
  /** Two pages in Scroll: the distance between two stacked spreads (one screen), or 0 for one column. */
  const spreadRef = useRef(0);
  // A click, an arrow key, or Previous/Next. Read aloud turns with goTo and does not come through here.
  useEffect(() => {
    turnRef.current = (dir) => {
      const v = view.current;
      if (!v) return;
      const pitch = spreadRef.current;
      if (pitch && props.fileType !== "pdf") {
        // Stacked spreads: scroll to the next (or previous) spread's top, so it shows whole.
        const distance = spreadTurn(v.renderer?.start ?? 0, pitch, dir);
        void (dir === "next" ? v.next(distance) : v.prev(distance));
        return;
      }
      void turnWithSpine(v, bookRef.current, dir, props.fileType === "pdf");
    };
  });
  /**
   * The spread the open PDF renderer was given. Foliate reads the spread only
   * when that renderer opens, so this is written after the reopen has opened.
   * The book's own spread is the choice just made: it changes before the
   * reopen works, and a failed reopen leaves it ahead of this, so the same
   * choice can be tried again.
   */
  const openSpread = useRef<string | null>(null);
  /** One reopen at a time. The next choice waits, then opens with the spread the book has then. */
  const reopenTask = useRef(Promise.resolve());
  /** Set while a reopen is putting a page back. A relocate for any other page is ignored. */
  const heldCfi = useRef<{ cfi: string | null } | null>(null);
  const [settings, setSettings] = useState<ReaderSettings | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  // A PDF's number of pages (each page is a section), for "Go to page" (M20); 0 for an EPUB.
  const [pageCount, setPageCount] = useState(0);
  const [panel, setPanel] = useState<"none" | "contents" | "settings" | "notes" | "rewrite" | "know" | "questions" | "ask" | "explain" | "xray" | "genealogy" | "links" | "images" | "picture">("none");
  // X-ray on the page (M32 X2): the name whose card is open, the names on the screen, and each chapter's marks
  // (fetched once, drawn on its overlay).
  const [xrayCard, setXrayCard] = useState<string | null>(null);
  // M43 S3: the Genealogy views over the whole screen, opened from the Genealogy tab.
  const [genealogy, setGenealogy] = useState<{ data: GenealogyData; view: GenealogyTop; focus?: string } | null>(null);
  const [onPage, setOnPage] = useState<{ id: string; name: string }[]>([]);
  const xrayMarks = useRef(new Map<number, Promise<XrayMark[]>>());
  const xrayDrawn = useRef(new Map<number, DrawnMark[]>());
  // The keyboard follows the panel (M19 P1b), as in the account menu: focus moves into a panel when it opens, and
  // back to the button that opened it when it closes, if the focus went away with the panel.
  const opener = useRef<HTMLElement | null>(null);
  const shownPanel = useRef<typeof panel>("none");
  useEffect(() => {
    const was = shownPanel.current;
    shownPanel.current = panel;
    if (panel === "none") {
      const back = opener.current;
      opener.current = null;
      const lost = document.activeElement === null || document.activeElement === document.body;
      if (was !== "none" && back?.isConnected && lost) back.focus();
      return;
    }
    if (was === "none") {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    const box = stage.current?.querySelector<HTMLElement>(`:scope > .${CSS.escape(styles.panel)}`);
    if (!box || box.contains(document.activeElement)) return; // a panel that put focus on its own field keeps it
    box.tabIndex = -1;
    box.focus({ preventScroll: true });
  }, [panel]);
  const [imagesFor, setImagesFor] = useState("");
  const [imagesAt, setImagesAt] = useState<PendingSelection | null>(null);
  const [links, setLinks] = useState<CrossLink[]>([]);
  const player = usePlayer();
  // The bar shows when asked for, or when this book is still being read aloud (the reader was left and is back).
  const [listening, setListening] = useState(!!props.startListening || player.bookId === props.bookId);
  // ?listen=1 (Home's Listen from here) opens the Read aloud bar once: take it out of the
  // address, so a reload after closing the bar does not open it again.
  useEffect(() => {
    if (!props.startListening) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("listen");
    window.history.replaceState(window.history.state, "", url);
  }, [props.startListening]);
  // A focus session with a question (M26 R3). Since R4a it lives on the server; this device keeps a copy, so a
  // reload part-way through, or a moment offline, picks it up with the time that is left.
  const [focusSession, setFocusSession] = useState<FocusSession | null>(null);
  const [focusStart, setFocusStart] = useState(false);
  const [focusEnding, setFocusEnding] = useState(false);
  // Leave early… (M26 R4b): the dialog with the two ways out, and how long the server's wait lasts.
  const [focusLeaving, setFocusLeaving] = useState(false);
  const [focusWaitMinutes, setFocusWaitMinutes] = useState(DEFAULT_WAIT_MINUTES);
  // The session just ended with its answer saved: the sitting still reports it once more, now with the note's id.
  const [focusDone, setFocusDone] = useState<{ id: string; question: string; answerAnnotationId: string } | null>(null);
  // The time is up, or the wait to leave early has run out: ask "Did you answer it?" (checked once a second, so
  // page.clock drives it in tests).
  useEffect(() => {
    if (!focusSession || focusEnding) return;
    const timer = setInterval(() => {
      if (focusIsOver(focusSession)) {
        setFocusLeaving(false);
        setFocusEnding(true);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [focusSession, focusEnding]);
  const focusReport = useMemo(
    () => (focusSession ? { id: focusSession.id, question: focusSession.question, answerAnnotationId: null } : focusDone),
    [focusSession, focusDone],
  );
  const tracker = useReadingTracker(props.bookId, listening, focusReport, !props.visitor);
  const trackerRef = useRef(tracker);
  useEffect(() => {
    trackerRef.current = tracker;
  });
  const whereCfi = useRef<string | null>(props.initialCfi);
  /** M25: the page of the scan being read (in the text edition, the last page marker passed), for Scan | Text. */
  const [scanPage, setScanPage] = useState<number | null>(null);
  const editionNow = props.edition?.current;
  /** Read aloud asked for the next page and it has not arrived yet. */
  const turning = useRef(false);
  /** Where the word lit by read aloud is (its CFI): going on after a pause returns to its page. */
  const litCfi = useRef<string | null>(null);
  /** The word lit in a PDF page (M13 (e)), lit again when the page's text layer is complete or laid out for a new size. */
  const spokenPdf = useRef<{ page: number; at: [number, number] } | null>(null);
  /** The Read aloud bar's element, on which each lit word is recorded (recordLit). */
  const listenBar = useRef<HTMLDivElement>(null);
  const linkedText = useRef("");
  const [rewriteAt, setRewriteAt] = useState<string | null>(null);
  /** Read it rewritten (M17): the view, from the account, and the last one that showed the rewrite (the top bar's button goes back to it). */
  const [rewritten, setRewritten] = useState<{ mode: RewrittenMode; last: Exclude<RewrittenMode, "original"> }>(() => {
    const mode = props.rewrittenView ?? "original";
    return { mode, last: mode === "rewritten" ? "rewritten" : "side" };
  });
  /** The place on screen for the rewritten view: an EPUB's visible range, or a PDF's first and last page shown. */
  const [screen, setScreen] = useState<{ from: string; to: string } | null>(null);
  /** Rewriting each page as it is turned to (M17 R3): for this visit only, never remembered. */
  const [turn, setTurn] = useState<AsYouTurn>(TURN_OFF);
  const [notes, setNotes] = useState<Annotation[]>([]);
  const notesRef = useRef<Annotation[]>([]);
  /** The other version's notes (a scan and its text edition) found on this one: their places here, by note id. */
  const crossedAt = useRef(new Map<string, string>());
  /** Places the other version's notes on the pages already shown (set once the book is open). */
  const placeShown = useRef<() => void>(() => {});
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const selectionDoc = useRef<Document | null>(null);
  // The selected-text bar (M27 Q1) closes on a tap or click outside it, or on Escape, as its × does; not while a
  // note, voice note or drawing is open in it (SelectionBar's onBusy). Not when the book's own selection goes away:
  // Safari clears a frame's selection when a button outside the frame is pressed, and the bar must stay for it.
  const selectionBar = useRef<HTMLDivElement>(null);
  const selectionOpen = useRef(false);
  const selectionBusy = useRef(false);
  useEffect(() => {
    selectionOpen.current = !!selection;
  }, [selection]);
  const dismissSelection = useCallback(() => {
    if (!selectionOpen.current || selectionBusy.current) return false;
    selectionOpen.current = false;
    selectionDoc.current?.getSelection()?.removeAllRanges();
    setSelection(null);
    return true;
  }, []);
  const onSelectionBusy = useCallback((busy: boolean) => {
    selectionBusy.current = busy;
  }, []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const visibleText = useRef("");
  const [where, setWhere] = useState<{ cfi: string | null; fraction: number; chapter: string }>({
    cfi: props.initialCfi,
    fraction: props.initialFraction,
    chapter: "",
  });
  // From a name in Who & what (its card in the list or over the page): the views open on that name, from where the
  // reader is. Not for a visitor, whose Study has no Genealogy.
  const openGenealogy = props.visitor
    ? undefined
    : (name: string, v: GenealogyTop) =>
        void fetch(`/api/books/${props.bookId}/genealogy?${new URLSearchParams(where.cfi ? { cfi: where.cfi } : {})}`)
          .then(async (res) => (res.ok ? ((await res.json()) as GenealogyData | { none: true }) : null))
          .then((d) => d && !("none" in d) && setGenealogy({ data: d, view: v, focus: name }))
          .catch(() => undefined);
  // "Also in <book>" (M43): the same name in the reader's other books, each opening that book's views on it (in the
  // view it is in, or "Inside a company" when that book gives the organisation no family tree).
  const alsoIn = (name: string, kind: "person" | "organisation", v: GenealogyTop) =>
    fetch(`/api/books/${props.bookId}/genealogy?${new URLSearchParams({ also: name, kind })}`)
      .then(async (res) => (res.ok ? ((await res.json()) as { also: { bookId: string; title: string; name: string; links: number; tree: boolean }[] }).also : []))
      .then((list) => list.map((a) => ({ title: a.title, name: a.name, links: a.links, href: `/books/${a.bookId}/read?${new URLSearchParams({ genealogy: `${v === "tree" && !a.tree ? "org" : v}:${a.name}` })}` })));
  // Opened from another book's "Also in": the views on that name, once the book is open.
  const askedGenealogy = useRef(false);
  useEffect(() => {
    const m = /^(tree|org|person):(.+)$/.exec(props.openGenealogyAt ?? "");
    if (!m || askedGenealogy.current || props.visitor) return;
    askedGenealogy.current = true;
    void fetch(`/api/books/${props.bookId}/genealogy?${new URLSearchParams(props.initialCfi ? { cfi: props.initialCfi } : {})}`)
      .then(async (res) => (res.ok ? ((await res.json()) as GenealogyData | { none: true }) : null))
      .then((d) => d && !("none" in d) && setGenealogy({ data: d, view: m[1] as GenealogyTop, focus: m[2] }))
      .catch(() => undefined);
  }, [props.openGenealogyAt, props.bookId, props.initialCfi, props.visitor]);
  // Whole-book focus (M26 R5): one book only, for days; a line above the page. Answering it reloads the notes.
  const bookAnswered = useRef<() => void>(() => {});
  const bookFocus = useBookFocus(props.bookId, where, () => bookAnswered.current(), !props.visitor);
  // M28 S3: "Where were we?" has a row of its own (not in a focus session), shared with the whole-book focus line. The
  // theme class is also set on the element directly (when the book opens, when settings change), so those places add
  // this class too, or the strip would take the book's row.
  const withRecall = (props.recall || bookFocus.focus) && !focusSession ? ` ${styles.withRecall}` : "";
  const recallClass = useRef(withRecall);
  useEffect(() => {
    recallClass.current = withRecall;
  }, [withRecall]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // While a large file downloads: "12 of 80 MB" (M20).
  const [downloaded, setDownloaded] = useState<string | null>(null);
  // Focus (M21, EPUBs): the mode now, the paragraph read aloud, and where the mouse rests (in the reader's coordinates).
  const focusRef = useRef<FocusMode>("off");
  // M42 S1: E-ink on, read where highlights are drawn (they are underlined in ink, not tinted).
  const einkRef = useRef(false);
  const rulerLinesRef = useRef<RulerLines>(1);
  // M41 R5: fixed for the page's life (it comes with the page), read where the book is opened.
  const citationsRef = useRef(props.citations);
  // M41 R6: the redrawn figures (fixed for the page's life) and the mode now, read as each chapter loads.
  const figuresRef = useRef(props.figures ?? []);
  const figureModeRef = useRef<FigureMode>("redrawn");
  // Each redraw fetched once from this page (with the sign-in cookie) and kept as a blob: address for the book's pages.
  const redrawBlobs = useRef(new Map<string, Promise<string>>());
  const loadRedraw = useCallback((url: string) => {
    const known = redrawBlobs.current.get(url);
    if (known) return known;
    const p = fetch(url, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status}`))))
      .then((b) => URL.createObjectURL(b));
    redrawBlobs.current.set(url, p);
    p.catch(() => redrawBlobs.current.delete(url));
    return p;
  }, []);
  useEffect(() => {
    const blobs = redrawBlobs.current;
    return () => {
      for (const p of blobs.values()) p.then((u) => URL.revokeObjectURL(u), () => undefined);
      blobs.clear();
    };
  }, []);
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
  // The layout last laid out (Pages or Scroll, One or Two pages), and the place to mark once a switch has settled.
  const laidOut = useRef<string | null>(null);
  const placeToMark = useRef<Spot | null>(null);
  // The Keyboard shortcuts dialog (M21): "?" or the link in Reading settings.
  const [shortcuts, setShortcuts] = useState(false);
  // M41: the picture a tap on the page opened full screen.
  const [figure, setFigure] = useState<Figure | null>(null);
  const [wholeTable, setWholeTable] = useState<TappedTable | null>(null);
  // M41 R4b: the equation a tap asked to have explained.
  const [equation, setEquation] = useState<EquationAsk | null>(null);
  const shortcutsOpen = useRef(false);
  useEffect(() => {
    shortcutsOpen.current = shortcuts;
  }, [shortcuts]);
  // Full screen (Samuel 2026-10-28: "if I can enjoy Netflix in full screen then I should also enjoy reading in full
  // screen"): the whole page, so the panels and dialogs come along. The button shows only where the browser allows
  // it (not on an iPhone, where Safari keeps full screen for videos), and not on a narrow screen, where the bar is
  // full (it pushed the page 12 px sideways with a note count, CI run on #246). Esc, F or the button leave it.
  const canFull = useSyncExternalStore(noSubscribe, () => document.fullscreenEnabled === true, () => false);
  const full = useSyncExternalStore(onFullscreenChange, () => document.fullscreenElement !== null, () => false);
  const [idle, setIdle] = useState(false);
  const sidebarChosen = useSyncExternalStore(onSidebarChange, sidebarOpen, () => false);
  // A focus session shows only the page (M26 R3): the rail goes with the bars, and comes back after.
  const sidebar = sidebarChosen && !focusSession;
  const rail = useRef<HTMLElement | null>(null);
  const wake = useRef<(e: Event, top?: number) => void>(() => {});
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (document.fullscreenEnabled) {
      // Only the book (Samuel 2026-11-01, "is this how you would watch Netflix?"): an open panel or card closes.
      setPanel("none");
      setXrayCard(null);
      setSidebarOpen(false);
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);
  const pending = useRef<Relocate | null>(null);
  // M27 Q2 (like Kindle's Whispersync): the places this tab saved itself, the one it opened at and the one saved
  // when it opened (a search result or a shared link opens elsewhere, and the page has not been saved yet). A saved place
  // that is none of them was put there by another device, or by listening away from this page: coming back to the
  // tab, the reader is offered it.
  const ownPlaces = useRef(new Set<string>([props.initialCfi, props.savedCfi].filter((c): c is string => !!c)));
  const [elsewhere, setElsewhere] = useState<{ cfi: string; fraction: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(
    (keepalive = false) => {
      const loc = pending.current;
      if (!loc) return;
      pending.current = null;
      ownPlaces.current.add(loc.cfi);
      if (props.visitor) {
        saveVisitorPlace(props.bookId, loc.cfi);
        return;
      }
      void fetch(`/api/books/${props.bookId}/position`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cfi: loc.cfi, fraction: loc.fraction }),
        keepalive,
      }).catch(() => {});
    },
    [props.bookId, props.visitor],
  );

  // Coming back to this tab or window (M27 Q2): has the place moved elsewhere?
  useEffect(() => {
    if (props.visitor) return;
    let asking = false;
    const check = async () => {
      if (document.visibilityState !== "visible" || asking) return;
      asking = true;
      try {
        const r = await fetch(`/api/books/${props.bookId}/position`, { cache: "no-store" });
        if (!r.ok) return;
        const at = (await r.json()) as { cfi: string | null; fraction: number };
        if (at.cfi && !ownPlaces.current.has(at.cfi) && at.cfi !== whereCfi.current) setElsewhere({ cfi: at.cfi, fraction: at.fraction });
      } catch {
        // Offline: nothing to offer.
      } finally {
        asking = false;
      }
    };
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [props.bookId, props.visitor]);

  // Highlights in other books that share this page's ideas (cross-book links).
  const lookForLinks = useCallback(
    (text: string) => {
      if (props.visitor || !text || text === linkedText.current) return;
      linkedText.current = text;
      void fetch(`/api/books/${props.bookId}/crosslinks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      })
        .then((r) => (r.ok ? r.json() : { links: [] }))
        .then((b: { links: CrossLink[] }) => {
          if (linkedText.current === text) setLinks(b.links);
        })
        .catch(() => {});
    },
    [props.bookId, props.visitor],
  );

  // Every key here is listed in the Keyboard shortcuts dialog (ShortcutsDialog.tsx): change both together.
  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    // The shortcuts dialog has the keyboard while it is open (and handles Escape itself).
    if (shortcutsOpen.current) return;
    const target = e.target as HTMLElement | null;
    if (target && (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName.toUpperCase()) || target.isContentEditable)) return;
    // "?" lists the shortcuts (M21), even with a button focused: it is not a key a button uses.
    if (e.key === "?") {
      e.preventDefault();
      setShortcuts(true);
      return;
    }
    // A focused button keeps its own keys (Enter, Space, arrows), but Escape still closes the panel (M19 P1b).
    if (target?.tagName === "BUTTON" && e.key !== "Escape") return;
    // In Pages, and on a PDF's pages, Up and Down turn the page too (issue #257, in one page or two); in Scroll they
    // scroll the text a little, as the browser does.
    // Space turns to the next page and Shift+Space back, in Pages only (issue #267), as most e-book readers do; in
    // Scroll it scrolls, as the browser does. A focused link, anything acting as a button, and the selected-text bar
    // (role "toolbar") keep Space. (Buttons, text boxes and the shortcuts dialog have already returned above.)
    const space =
      e.key === " " && !target?.closest?.("a, [role='button'], [role='link'], [role='menuitem'], [role='toolbar'], summary");
    const paged =
      (e.key === "ArrowDown" || e.key === "ArrowUp" || space) && view.current?.renderer?.getAttribute("flow") !== "scrolled";
    if (paged) e.preventDefault();
    if (e.key === "ArrowRight" || e.key === "PageDown" || (paged && (e.key === "ArrowDown" || (space && !e.shiftKey))))
      turnRef.current("next");
    else if (e.key === "ArrowLeft" || e.key === "PageUp" || (paged && (e.key === "ArrowUp" || (space && e.shiftKey))))
      turnRef.current("prev");
    else if (e.key === "f" || e.key === "F") toggleFull();
    else if (e.key === "Escape") {
      // The selected-text bar first (M27 Q1), then the panel.
      if (!dismissSelection()) {
        setXrayCard(null);
        setPanel("none");
      }
    }
  }, [dismissSelection, toggleFull]);

  // In full screen only the book is on screen (fullscreen.ts): the bars lie over the page and fade, and come back
  // when the reader reaches for them (the mouse at the top or bottom edge, a tap, a key that is not a page turn), in
  // the page or around it. A panel opened in full screen brings the bars back into their rows until it closes.
  useEffect(() => {
    if (!full || panel !== "none" || sidebar) return;
    let timer = window.setTimeout(() => setIdle(true), FULL_IDLE_MS);
    const wakeUp = (e: Event, top = 0) => {
      const ev = fullEvent(e, top);
      if (!ev || !wakesBars(ev, window.innerHeight)) return;
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), FULL_IDLE_MS);
    };
    wake.current = wakeUp;
    const events = ["pointermove", "pointerdown", "keydown"] as const;
    const onEvent = (e: Event) => wakeUp(e);
    for (const name of events) window.addEventListener(name, onEvent, { passive: true });
    return () => {
      window.clearTimeout(timer);
      wake.current = () => {};
      for (const name of events) window.removeEventListener(name, onEvent);
      setIdle(false);
    };
  }, [full, panel, sidebar]);

  // A sideways swipe on a trackpad turns the page (#235), in Pages and in Scroll; in Pages (and a PDF), so does
  // scrolling up and down. One turner serves the book's frames and the margins around them, so a swipe that crosses
  // from one to the other is still one swipe.
  const wheelTurn = useRef<ReturnType<typeof wheelTurner> | null>(null);
  const onWheel = useCallback((e: WheelEvent) => {
    // A pinch on a trackpad arrives as a wheel event with Ctrl held: that is the browser's zoom.
    if (e.ctrlKey || shortcutsOpen.current) return;
    wheelTurn.current ??= wheelTurner((dir) => turnRef.current(dir));
    const path = e.composedPath();
    const upDown = view.current?.renderer?.getAttribute("flow") !== "scrolled";
    if (wheelTurn.current(e, upDown, (axis, px) => scrollsItself(path, axis, px))) e.preventDefault();
  }, []);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

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
  const shownOf = (doc: Document): Box | null => {
    const frameEl = doc.defaultView?.frameElement as HTMLElement | null;
    const seen = (frameEl?.parentElement?.parentElement ?? frameEl)?.getBoundingClientRect();
    const clip = lensEl.current?.parentElement?.getBoundingClientRect();
    if (!seen || !clip) return null;
    const box = { left: Math.max(seen.left, clip.left), right: Math.min(seen.right, clip.right), top: Math.max(seen.top, clip.top), bottom: Math.min(seen.bottom, clip.bottom) };
    return box.right > box.left && box.bottom > box.top ? box : null;
  };

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
    [showLensOn],
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
    [showLens, showLensOn, holdLens],
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
  }, [placeRuler]);

  /**
   * The focus session as the server has it (M26 R4a), put on this device: it may have been started or ended, or a
   * wait begun or cancelled, on another device (M26 R4b). Offline, this device's copy stands. `trustServer` drops
   * this device's own end time: after the server refused to end the session, this device's clock was ahead.
   */
  const syncFocus = useCallback(
    async (trustServer = false) => {
      const local = loadFocusSession(props.bookId);
      let session = local;
      try {
        const res = await fetch("/api/focus", { cache: "no-store" });
        if (res.ok) {
          const open = ((await res.json()) as { session: (ServerFocus & { waitMs?: number }) | null }).session;
          // A whole-book focus (M26 R5) is not a sitting: useBookFocus shows it.
          const sitting = open && (open as { kind?: string }).kind !== "book" ? open : null;
          session = sitting && sitting.bookId === props.bookId ? focusFromServer(sitting, trustServer ? null : local) : null;
          if (open?.waitMs) setFocusWaitMinutes(open.waitMs / 60_000);
        }
      } catch {
        // Offline: the copy on this device runs the timer.
      }
      return { session, local };
    },
    [props.bookId],
  );
  const showFocus = useCallback((session: FocusSession | null, hadLocal: boolean) => {
    if (session) {
      saveFocusSession(session);
      setFocusSession(session);
      setFocusEnding(focusIsOver(session));
      if (focusIsOver(session)) setFocusLeaving(false);
    } else {
      if (hadLocal) clearFocusSession();
      setFocusSession(null);
      setFocusEnding(false);
      setFocusLeaving(false);
    }
  }, []);

  // A focus session on this book picks up where it was, with the time that is left (M26 R4a), and again each time
  // this tab comes back to the front.
  useEffect(() => {
    if (props.visitor) return; // a visitor has no focus sessions
    let cancelled = false;
    const sync = async () => {
      if (document.visibilityState !== "visible") return;
      const { session, local } = await syncFocus();
      if (!cancelled) showFocus(session, Boolean(local));
    };
    void sync();
    const onVisible = () => void sync();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [syncFocus, showFocus, props.visitor]);

  // Open the book once. Settings live on this device (localStorage).
  useEffect(() => {
    if (view.current) return;
    let cancelled = false;
    // Never wait forever: some failures inside the book's frames are thrown
    // where this code cannot catch them (this hid a Safari problem, 2026-10-04).
    // The clock starts once the file has arrived; the download has its own (M20).
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const initial = loadSettings();
        focusRef.current = props.fileType === "pdf" ? "off" : initial.focus;
        rulerLinesRef.current = initial.rulerLines;
        await import("foliate-js/view.js");
        const blob = await downloadBook(props.fileUrl, {
          stallMs: OPEN_TIMEOUT_MS,
          onProgress: (got, total) => {
            if (!cancelled) setDownloaded(downloadedWords(got, total));
          },
        });
        giveUp = setTimeout(() => {
          if (!cancelled) setStatus((s) => (s === "loading" ? "error" : s));
        }, OPEN_TIMEOUT_MS);
        const book =
          props.fileType === "pdf"
            ? await (await import("@/lib/reader/pdf-book")).makePdfBook(blob, initial.pages)
            : new File([blob], "book.epub", { type: "application/epub+zip" });
        bookRef.current = props.fileType === "pdf" ? (book as SpineBook) : null;
        if (cancelled) return;
        openSpread.current = props.fileType === "pdf" ? (book as { rendition: { spread: string } }).rendition.spread : null;
        const v = document.createElement("foliate-view") as FoliateView;
        v.className = styles.view;
        host.current!.append(v);
        view.current = v;
        await v.open(book);
        // M41 R5: places are counted as if a paper's citation spans were not there (citations.ts).
        if (citationsRef.current) filterCitationCfis(v as never);
        // Highlights: load them, and draw each one when its page is rendered.
        const { Overlayer } = (await import("foliate-js/overlayer.js")) as { Overlayer: { highlight: DrawFn } };
        const loaded = props.visitor ? [] : withCrossed(await (await fetch(`/api/books/${props.bookId}/annotations`)).json(), crossedAt.current);
        notesRef.current = loaded;
        setNotes(loaded);
        // Send anything made offline earlier, and show what is still waiting (see the sync effect below).
        window.dispatchEvent(new Event(SYNC_EVENT));
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
        root.current!.className = readerClass(initial) + recallClass.current;
        spreadRef.current = applySettings(v, initial, root.current!);
        setSettings(initial);
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
        v.addEventListener("relocate", (e: Event) => {
          const d = (e as CustomEvent<Relocate>).detail;
          // A page shown: the other version's notes on it are placed (also when its frame was not reported loading).
          placeShown.current();
          let pages: number[] = [];
          if (props.fileType === "pdf") {
            const shown = pdfDocsOnScreen(v)
              .map((doc) => Number(doc.documentElement.dataset.page))
              .filter((n) => Number.isInteger(n) && n >= 0);
            pages = shown;
            const reported = pdfPage(d.cfi);
            // The patched viewer names the page on screen. Drop an address for a page that is not showing.
            if (shown.length > 0 && reported >= 0 && !shown.includes(reported)) return;
            const held = heldCfi.current?.cfi;
            if (held && pdfPage(d.cfi) !== pdfPage(held)) return;
          }
          const cfi = d.cfi;
          mark("nl:relocate", { cfi });
          if (editionNow) {
            const page = editionNow === "scan" ? pdfPage(cfi) + 1 : Number(d.pageItem?.label);
            setScanPage(Number.isInteger(page) && page > 0 ? page : null);
          }
          setWhere({ cfi, fraction: d.fraction, chapter: d.tocItem?.label?.trim() ?? "" });
          if (props.fileType === "pdf") {
            // A page's names, from its marks (no underlines on a page picture).
            if (pages.length) void marksOf(pages[0]).then((marks) => setOnPage(marks.filter((m, i) => marks.findIndex((x) => x.entryId === m.entryId) === i).map((m) => ({ id: m.entryId, name: m.name }))));
          } else {
            let index = -1;
            try {
              index = v.resolveCFI(cfi).index;
            } catch {
              // Not a place in the book: nothing on the screen to name.
            }
            showOnPage(index, d.range);
          }
          // The page on screen (data-cfi, read by the tests) is recorded now, in the same step as foliate
          // shows it, as recordLit does for the lit word. Left to React it was written up to 22 ms later,
          // after the next page's first word had already been lit there by its text layer, so on a loaded
          // CI runner a screen frame showed the word lit with the page before still recorded
          // (docs/ci-flakes.md). React's own render writes the same value, so it changes nothing.
          root.current?.setAttribute("data-cfi", cfi);
          // A PDF's pages on screen (two side by side bring both); an EPUB's visible range.
          const pageCfi = (n: number) => `epubcfi(/6/${(n + 1) * 2})`;
          setScreen(pages.length ? { from: pageCfi(Math.min(...pages)), to: pageCfi(Math.max(...pages)) } : { from: cfi, to: cfi });
          whereCfi.current = cfi;
          turning.current = false;
          visibleText.current = clean(d.range?.toString() ?? "");
          const label = d.tocItem?.label?.trim() ?? "";
          const chapterKey = d.tocItem?.href ?? label;
          trackerRef.current.onPage(
            CFI.collapse(cfi),
            visibleText.current,
            chapterKey ? { key: chapterKey, label, position: d.fraction } : undefined,
          );
          pending.current = { ...d, cfi };
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            flush();
            lookForLinks(visibleText.current);
          }, 600);
          // Focus (M21) on the page now in front of the reader.
          if (props.fileType !== "pdf") refocus(d.range ?? null, cfi);
        });
        /**
         * The other version's notes on the page just shown (a scan's page, with its text drawn; or a chapter of the
         * text edition): found by their quoted words on their printed page (lib/reader/find-quote.ts), given a place
         * here and drawn. One whose words are not here (read too differently) stays in Notes with "Go to" its page.
         */
        const placeCrossed = (doc: Document, index: number) => {
          const found: Annotation[] = [];
          for (const a of notesRef.current) {
            if (!a.crossed || crossedAt.current.has(a.id) || !a.quote.exact) continue;
            let range: Range | null = null;
            if (props.fileType === "pdf") {
              const layer = doc.documentElement.dataset.page === String(a.crossed.page - 1) ? doc.querySelector(".textLayer") : null;
              range = layer ? rangeForQuote(layer, a.quote) : null;
            } else if (doc.getElementById(`page-${a.crossed.page}`)) range = rangeForQuote(doc.body, a.quote, a.crossed.page);
            if (!range) continue;
            const cfi = v.getCFI(index, range);
            crossedAt.current.set(a.id, cfi);
            found.push({ ...a, cfi });
          }
          if (!found.length) return;
          notesRef.current = notesRef.current.map((a) => found.find((f) => f.id === a.id) ?? a);
          setNotes(notesRef.current);
          for (const a of found) if (["highlight", "sticker", "drawing", "image"].includes(a.kind)) void v.addAnnotation({ value: a.cfi! });
        };
        // Pages shown before these listeners were set (the notes are fetched first, and a slow fetch lets the first
        // page open meanwhile: CI run 40412619634), or before a reload brought a note: a scan's page whose text is
        // drawn (its end marker is there) now, one still drawing when its text is.
        placeShown.current = () => {
          for (const c of v.renderer?.getContents() ?? []) {
            const doc = c.doc;
            if (!doc) continue;
            const index = (c as { index?: number }).index ?? Number(doc.documentElement.dataset.page);
            if (!Number.isInteger(index)) continue;
            if (props.fileType !== "pdf" || doc.querySelector(".textLayer .endOfContent")) placeCrossed(doc, index);
            else doc.addEventListener(TEXT_LAYER_EVENT, () => placeCrossed(doc, index), { once: true });
          }
        };
        v.addEventListener("load", (e: Event) => {
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
        });
        setToc(v.book.toc ?? []);
        placeShown.current();
        setPageCount(props.fileType === "pdf" ? (v.book.sections?.length ?? 0) : 0);
        const opensAt = props.visitor ? visitorPlace(props.bookId) : props.initialCfi;
        await v.init({ lastLocation: opensAt, showTextStart: !opensAt && !props.openPage });
        // M25: from the scan's page n to the same page in the text edition (its page marker, in the page list).
        const opening = props.openPage ? v.book.pageList?.find((item) => item.label === String(props.openPage)) : undefined;
        if (opening) await v.goTo(opening.href);
        // The book's own typeface (NL Serif, fetched by the book's frame) can arrive after the first page is laid
        // out; the text is blank until then, and foliate lays the page out again when it lands, which moves the
        // page's start by a paragraph or more. "Ready" waits for it (at most 3 s, the browser's own wait for a
        // font), and then a frame for foliate's new layout, so the page a reader sees first is the one recorded
        // (docs/ci-flakes.md, shell.spec.ts:469 on e97bc8f).
        const fonts = (v.renderer?.getContents() ?? []).map(({ doc }) => doc.fonts?.ready);
        await Promise.race([Promise.all(fonts), new Promise((r) => setTimeout(r, 3000))]);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (cancelled) return;
        clearTimeout(giveUp);
        setStatus("ready");
      } catch (err) {
        console.error(err);
        clearTimeout(giveUp);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      bookRef.current = null;
      clearTimeout(giveUp);
    };
  }, [props.bookId, props.fileUrl, props.fileType, props.initialCfi, props.openPage, props.visitor, editionNow, flush, onKey, onWheel, lookForLinks, refocus, holdLens, showLens, showLensOn, dismissSelection, loadRedraw]);

  // Focus (M21): the book's area changed size or place (the device turned, full screen, a side pane): the ruler's
  // band, drawn over the book, is put back on its line, or on the first line if its place is gone.
  useEffect(() => {
    const clip = lensEl.current?.parentElement;
    if (!clip) return;
    let frame = 0;
    const sizes = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (focusRef.current === "ruler" && lens.current) refocus();
      });
    });
    sizes.observe(clip);
    return () => {
      sizes.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [refocus]);

  // Two pages in Scroll: a spread is one screen tall, so a new window size lays the spreads out again (or goes to
  // one column, in a window taller than wide).
  useEffect(() => {
    if (!settings || props.fileType === "pdf" || settings.flow !== "scrolled" || settings.pages !== "two") return;
    const el = host.current;
    if (!el) return;
    let frame = 0;
    const sizes = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const v = view.current;
        if (!v?.renderer || !root.current) return;
        if (spreadPitch(settings, v.renderer.getBoundingClientRect(), canWrapColumns()) !== spreadRef.current)
          spreadRef.current = applySettings(v, settings, root.current);
      });
    });
    sizes.observe(el);
    return () => {
      sizes.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [settings, props.fileType]);

  // Re-style when settings or the colour scheme change. A PDF's spread is read only when its renderer opens, so a new page choice reopens on the same page.
  useEffect(() => {
    if (!settings) return;
    saveSettings(settings);
    // The theme class must be on the element before colours are read from it.
    if (root.current) root.current.className = readerClass(settings) + recallClass.current;
    const v = view.current;
    // A switch of layout moves the words read last (in Two pages, maybe to the right column): note where the text on
    // screen starts, and mark that line once the new layout has settled. A second switch before then keeps the first
    // place.
    const layout = `${settings.flow} ${settings.pages}`;
    if (laidOut.current !== null && laidOut.current !== layout && props.fileType !== "pdf" && !placeToMark.current) {
      const onScreen = (v as { lastLocation?: { range?: Range | null } | null } | null)?.lastLocation?.range;
      placeToMark.current = onScreen ? firstLetter(onScreen) : null;
    }
    laidOut.current = layout;
    if (v && root.current) spreadRef.current = applySettings(v, settings, root.current);
    // M42 S1: E-ink switched: draw the notes on the pages again, as underlines or as tints (their colours changed too).
    if (einkRef.current !== settings.eink) {
      einkRef.current = settings.eink;
      if (v && props.fileType !== "pdf")
        for (const a of notesRef.current) if (["highlight", "sticker", "drawing", "image"].includes(a.kind) && a.cfi) void v.addAnnotation({ value: a.cfi });
    }
    // M41 R6: Figures, redrawn or as printed, on the pages already open (a page opened later reads the ref).
    figureModeRef.current = settings.figures;
    if (v && figuresRef.current.length) for (const { doc } of v.renderer?.getContents() ?? []) showFigures(doc, settings.figures);
    const marking = placeToMark.current
      ? setTimeout(() => {
          const spot = placeToMark.current;
          placeToMark.current = null;
          const doc = spot?.node.ownerDocument;
          if (spot && doc) markLine(doc, spot);
        }, 400)
      : undefined;
    // Focus (M21): EPUBs only. A new mode is set on every page shown; a new size or layout moves the lines, so the
    // band and the dimming are put back once the page is laid out again.
    const focus: FocusMode = props.fileType === "pdf" ? "off" : settings.focus;
    if (focusRef.current !== focus || rulerLinesRef.current !== settings.rulerLines) {
      focusRef.current = focus;
      rulerLinesRef.current = settings.rulerLines;
      if (focus !== "ruler") showLens(null);
      try {
        for (const { doc } of v?.renderer?.getContents() ?? []) if (doc?.documentElement) setFocusMode(doc, focus, settings.rulerLines);
      } catch {
        // No pages yet: each page sets its mode as it loads.
      }
    }
    const relaid = requestAnimationFrame(() => refocus());
    const spread = spreadForPages(settings.pages);
    const book = v?.book;
    // The latest choice, including when this run does not itself reopen (a theme change, or a choice that is already open).
    // The spread lives on Foliate's book, which it reads when the renderer opens. It is not React state.
    if (book?.rendition && openSpread.current !== null) {
      // eslint-disable-next-line react-hooks/immutability -- Foliate's book object, not a value owned by React
      book.rendition.spread = spread;
    }
    let stop = false;
    if (v && book?.rendition && openSpread.current !== null && openSpread.current !== spread) {
      reopenTask.current = reopenTask.current.then(async () => {
        if (stop) return;
        const place = whereCfi.current;
        const pin = { cfi: place };
        heldCfi.current = pin;
        // True once this task has closed the renderer, so it must open one again even if the choice changed back.
        let opened = false;
        try {
          for (let attempt = 0; attempt < 4; attempt++) {
            const opening = book.rendition?.spread;
            if (!opening) return;
            if (!opened && opening === openSpread.current) return;
            const old = v.renderer;
            if (old) {
              const dispatch = old.dispatchEvent.bind(old);
              // A turn that is still loading on this renderer must not report a page after it is closed.
              old.dispatchEvent = (event: Event) => (event.type === "relocate" ? true : dispatch(event));
            }
            v.close();
            opened = true;
            await v.open(book);
            if (book.rendition?.spread !== opening) continue;
            await v.init({ lastLocation: place, showTextStart: !place });
            // Record the spread only once this renderer has opened, so a failure can be tried again.
            openSpread.current = opening;
            opened = false;
            if (book.rendition?.spread !== opening) continue;
            if (!stop) setStatus((s) => (s === "error" ? "ready" : s));
            return;
          }
          if (!stop) setStatus("error");
        } catch (err) {
          console.error(err);
          if (!stop) setStatus("error");
        } finally {
          if (heldCfi.current === pin) heldCfi.current = null;
        }
      });
    }
    // PDF pages are dimmed in the dark themes unless turned off (M19 P2); pages that load later read dimRef.
    const dimPages = () => {
      dimRef.current = props.fileType === "pdf" && settings.dimPdf && isDark(settings);
      for (const doc of pageDocs.current) {
        if (!doc.defaultView) pageDocs.current.delete(doc); // a page no longer shown
        else doc.documentElement.toggleAttribute("data-dim", dimRef.current);
      }
    };
    dimPages();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (view.current && root.current) spreadRef.current = applySettings(view.current, settings, root.current);
      dimPages();
    };
    mq.addEventListener("change", onChange);
    return () => {
      stop = true;
      clearTimeout(marking);
      cancelAnimationFrame(relaid);
      mq.removeEventListener("change", onChange);
    };
  }, [settings, props.fileType, refocus, showLens]);

  // Save on leaving; keyboard paging.
  useEffect(() => {
    const onHide = () => flush(true);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("keydown", onKey);
      flush(true);
    };
  }, [flush, onKey]);

  const setAll = (list: Annotation[]) => {
    notesRef.current = list;
    setNotes(list);
  };


  const api = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Not saved");
    return res.status === 204 ? null : res.json();
  };

  /** How a note made offline looks until the server has it (M12). */
  const localAnnotation = (id: string, body: Record<string, unknown>, savedAt = new Date().toISOString()): Annotation => {
    const q = (body.quote ?? {}) as { exact?: string; prefix?: string; suffix?: string };
    return {
      id,
      version: 1,
      kind: body.kind as Kind,
      targetType: body.cfi ? "passage" : "book",
      bookId: props.bookId,
      targetId: null,
      sectionId: null,
      cfi: (body.cfi as string | undefined) ?? null,
      quote: { exact: q.exact ?? "", prefix: q.prefix ?? "", suffix: q.suffix ?? "" },
      color: body.kind === "highlight" ? ((body.color as Color | undefined) ?? "sage") : null,
      body: String(body.body ?? ""),
      voice: null,
      sticker: (body.sticker as Sticker | undefined) ?? null,
      drawing: null,
      picture: null,
      agent: null,
      createdAt: savedAt,
      updatedAt: savedAt,
      pending: true,
    };
  };

  /** The book's notes from the server (or the offline copy), plus any still waiting in the outbox. */
  const reload = async () => {
    if (props.visitor) return; // a visitor has no notes on the server
    let body: Parameters<typeof withCrossed>[0] | null = null;
    try {
      body = await api(`/api/books/${props.bookId}/annotations`, "GET");
    } catch (e) {
      if (!isOffline(e)) throw e;
    }
    const waiting = await outboxFor(props.readerId, props.bookId).catch(() => []);
    // The other version's notes get their places here, after the last wait: one placed while the outbox was read
    // would otherwise come back without its place, and stay so, as placing skips a note already placed (the
    // flaky agents.spec.ts:318, 2026-10-29).
    const server = body ? withCrossed(body, crossedAt.current) : null;
    setAll(withOutbox(server ?? notesRef.current, waiting));
    setRefused(waiting.filter((w) => w.refused));
    placeShown.current();
  };

  // Changes the server refused (M20): kept on the device and listed in Notes, never sent again.
  const [refused, setRefused] = useState<OutboxItem[]>([]);
  const dismissRefused = async (id: string) => {
    await removeFromOutbox(id);
    await reload();
  };

  const madeOffline = useRef(new Set<string>());

  /** Shows what waits in the outbox on top of the server's list: new notes added, edits applied, removals hidden. */
  const withOutbox = (base: Annotation[], all: OutboxItem[]) => {
    // A refused change is not waiting any more: the server's version stands.
    const waiting = all.filter((w) => !w.refused);
    const created = waiting.filter((w) => opOf(w) === "create");
    const createdIds = new Set(created.map((w) => w.id));
    madeOffline.current = createdIds;
    let list = [...base.filter((a) => !createdIds.has(a.id)), ...created.map((w) => localAnnotation(w.id, w.body, w.savedAt))];
    for (const w of waiting) {
      if (opOf(w) === "edit") list = list.map((a) => (a.id === w.annotationId ? { ...a, ...(w.body as Partial<Annotation>), pending: true } : a));
      if (opOf(w) === "remove") list = list.filter((a) => a.id !== w.annotationId);
      // Brought back while offline (M19): shown again at once, as it was.
      const back = opOf(w) === "restore" ? (w.body.annotation as Annotation | undefined) : undefined;
      if (back && !list.some((a) => a.id === back.id)) list = [...list, { ...back, pending: true }];
    }
    return list;
  };

  /** Edits or removes a note the server has; with no network the change waits in the outbox (M12). */
  const change = async (a: Annotation, op: "edit" | "remove" | "restore", body: Record<string, unknown> = {}) => {
    const changeId = crypto.randomUUID();
    try {
      if (op === "edit") await api(`/api/annotations/${a.id}`, "PATCH", { ...body, changeId });
      else if (op === "restore") await api(`/api/annotations/${a.id}/restore?changeId=${changeId}`, "POST");
      else await api(`/api/annotations/${a.id}?changeId=${changeId}`, "DELETE");
      return { changeId, queued: false };
    } catch (e) {
      if (!isOffline(e)) throw e;
      await addToOutbox(props.readerId, { id: changeId, op, annotationId: a.id, bookId: props.bookId, body, savedAt: new Date().toISOString() });
      return { changeId, queued: true };
    }
  };

  /**
   * A note made offline and not sent yet: its waiting item, if any. Known
   * from the last reload without asking the device's database, so ordinary
   * saves go to the server at once.
   */
  const waitingCreate = async (id: string) =>
    madeOffline.current.has(id) ? (await outboxFor(props.readerId, props.bookId).catch(() => [])).find((w) => w.id === id && opOf(w) === "create") : undefined;

  /**
   * Adds a highlight, note, sticker or bookmark with an id chosen here. With
   * no network it waits in the outbox and shows at once; it is sent when the
   * network returns (M12).
   */
  const create = async (body: Record<string, unknown>): Promise<Annotation> => {
    const id = crypto.randomUUID();
    try {
      return await api(`/api/books/${props.bookId}/annotations`, "POST", { ...body, id });
    } catch (e) {
      if (!isOffline(e)) throw e;
      await addToOutbox(props.readerId, { id, bookId: props.bookId, body, savedAt: new Date().toISOString() });
      return localAnnotation(id, body);
    }
  };

  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });

  // Send notes made offline: when the page opens, when the network returns, and every 30 s while any wait.
  useEffect(() => {
    if (props.visitor) return; // nothing of a visitor's waits to be sent
    const sync = async () => {
      await flushOutbox(props.readerId).catch(() => ({ sent: 0 }));
      await reloadRef.current().catch(() => {});
    };
    const online = () => void sync();
    window.addEventListener("online", online);
    window.addEventListener(SYNC_EVENT, online);
    const timer = setInterval(() => {
      if (notesRef.current.some((a) => a.pending)) void sync();
    }, 30_000);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener(SYNC_EVENT, online);
      clearInterval(timer);
    };
  }, [props.visitor]);

  const clearSelection = () => {
    selectionDoc.current?.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  const highlight = async (color: Color, body: string) => {
    if (!selection) return;
    // Take the selection and clear it first: the reader may select something
    // new while this is being saved, and that must not be wiped.
    const picked = selection;
    clearSelection();
    const a: Annotation = await create({
      kind: "highlight",
      cfi: picked.cfi,
      quote: { exact: picked.exact, prefix: picked.prefix, suffix: picked.suffix },
      color,
      body,
    });
    await reload();
    await view.current?.addAnnotation({ value: a.cfi! });
  };

  const addSticker = async (sticker: Sticker) => {
    if (!selection) return;
    const picked = selection;
    clearSelection();
    const a: Annotation = await create({
      kind: "sticker",
      cfi: picked.cfi,
      quote: { exact: picked.exact, prefix: picked.prefix, suffix: picked.suffix },
      sticker,
    });
    await reload();
    await view.current?.addAnnotation({ value: a.cfi! });
  };

  const pinPicture = async (picture: PinnedPicture) => {
    if (!imagesAt) return;
    const a: Annotation = await api(`/api/books/${props.bookId}/annotations`, "POST", {
      kind: "image",
      cfi: imagesAt.cfi,
      quote: { exact: imagesAt.exact, prefix: imagesAt.prefix, suffix: imagesAt.suffix },
      picture,
    });
    await reload();
    await view.current?.addAnnotation({ value: a.cfi! });
  };

  const activePicture = notes.find((a) => a.id === activeId && a.kind === "image") as (Annotation & { pictureUrl?: string }) | undefined;

  const saveDrawing = async (strokes: number[][]) => {
    if (!selection) return;
    const picked = selection;
    const a: Annotation = await api(`/api/books/${props.bookId}/annotations`, "POST", {
      kind: "drawing",
      cfi: picked.cfi,
      quote: { exact: picked.exact, prefix: picked.prefix, suffix: picked.suffix },
      drawing: { strokes },
    });
    clearSelection();
    await reload();
    await view.current?.addAnnotation({ value: a.cfi! });
    setActiveId(a.id);
    setPanel("notes");
  };

  const saveVoiceNote = async (audio: Blob, durationMs: number) => {
    if (!selection) return;
    const picked = selection;
    const form = new FormData();
    form.set("audio", audio, "voice-note");
    form.set("cfi", picked.cfi);
    form.set("quote", JSON.stringify({ exact: picked.exact, prefix: picked.prefix, suffix: picked.suffix }));
    form.set("durationMs", String(Math.round(durationMs)));
    const res = await voiceFetch(`/api/books/${props.bookId}/voice-notes`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "The voice note was not saved.");
    clearSelection();
    await reload();
    setActiveId(body.annotation.id);
    setPanel("notes");
  };

  const saveNote = async (a: Annotation, body: string) => {
    // Made offline and not sent yet: change what will be sent.
    const waiting = await waitingCreate(a.id);
    if (waiting) await addToOutbox(props.readerId, { ...waiting, body: { ...waiting.body, body } });
    else await change(a, "edit", { body });
    await reload();
  };

  /** Removes a note: if it was made offline and never sent, it (and its edits) just leave the outbox. */
  const forget = async (a: Annotation) => {
    if (await waitingCreate(a.id)) {
      for (const w of await outboxFor(props.readerId, props.bookId)) if (w.id === a.id || w.annotationId === a.id) await removeFromOutbox(w.id);
    } else await change(a, "remove");
  };

  // "Note removed · Undo" (M19): the last note removed, and how to bring it back, for ten seconds.
  const [removed, setRemoved] = useState<{ note: Annotation; undo: () => Promise<void> } | null>(null);
  const removedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const removeNote = async (a: Annotation) => {
    let undo: () => Promise<void>;
    const waiting = await waitingCreate(a.id);
    if (waiting) {
      // Made offline and never sent: dropping it from the outbox removes it; Undo puts it back.
      for (const w of await outboxFor(props.readerId, props.bookId)) if (w.id === a.id || w.annotationId === a.id) await removeFromOutbox(w.id);
      undo = () => addToOutbox(props.readerId, waiting);
    } else {
      const { changeId, queued } = await change(a, "remove");
      undo = async () => {
        // The removal is still waiting to be sent: taking it back is enough. Otherwise the server brings the note back.
        if (queued && (await outboxFor(props.readerId, props.bookId).catch(() => [])).some((w) => w.id === changeId)) await removeFromOutbox(changeId);
        else await change(a, "restore", { annotation: a });
      };
    }
    if (a.kind === "highlight" && a.cfi) await view.current?.deleteAnnotation({ value: a.cfi });
    await reload();
    if (removedTimer.current) clearTimeout(removedTimer.current);
    setRemoved({ note: a, undo });
    removedTimer.current = setTimeout(() => setRemoved(null), 10_000);
  };

  const undoRemove = async () => {
    const r = removed;
    if (!r) return;
    if (removedTimer.current) clearTimeout(removedTimer.current);
    setRemoved(null);
    await r.undo();
    await reload();
    if (["highlight", "sticker", "drawing", "image"].includes(r.note.kind) && r.note.cfi) await view.current?.addAnnotation({ value: r.note.cfi });
  };

  const addBookNote = async (body: string) => {
    await create({ kind: "note", body });
    await reload();
  };

  /** Starts the session on the server (one at a time: it refuses a second); throws its reason for the dialog. */
  const beginFocus = async (question: string, minutes: number) => {
    const { session: started } = (await api("/api/focus", "POST", { bookId: props.bookId, question, minutes })) as { session: ServerFocus & { waitMs?: number } };
    const session = focusFromServer(started, null);
    if (started.waitMs) setFocusWaitMinutes(started.waitMs / 60_000);
    saveFocusSession(session);
    setFocusDone(null);
    setFocusEnding(false);
    setFocusSession(session);
    setFocusStart(false);
    setPanel("none");
  };

  /**
   * The session is over, with or without an answer. Without one, the server is told here (saving an answer ends it
   * there), and may refuse: this device's clock ran ahead, so the strip comes back with the time the server says is
   * left. Offline, this device lets go; the server stops locking at the same moment by its own clock.
   */
  const finishFocus = async (answered = false) => {
    if (focusSession && !answered) {
      const res = await fetch("/api/focus/end", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: focusSession.id }) }).catch(() => null);
      if (res?.status === 409) {
        const { session } = await syncFocus(true);
        if (session) return showFocus(session, true);
      }
    }
    clearFocusSession();
    setFocusEnding(false);
    setFocusLeaving(false);
    setFocusSession(null);
  };

  /** Leave early…: the wait (M26 R4b), started or cancelled on the server, so a reload or another device keeps it. */
  const focusWait = async (method: "POST" | "DELETE") => {
    if (!focusSession) return;
    const { session } = (await api("/api/focus/wait", method, { id: focusSession.id })) as { session: ServerFocus };
    const next = focusFromServer(session, focusSession);
    saveFocusSession(next);
    setFocusSession(next);
    setFocusLeaving(false);
  };

  /** The answer is saved as a note on the book (the reader's own, never overwritten), and the sittings point at it. */
  const answerFocus = async (answer: string) => {
    if (!focusSession) return;
    const { note } = await api(`/api/books/${props.bookId}/focus`, "POST", {
      focusId: focusSession.id,
      noteId: focusSession.noteId,
      question: focusSession.question,
      answer,
    });
    // One last report with the note's id, after the session goes.
    setFocusDone({ id: focusSession.id, question: focusSession.question, answerAnnotationId: note.id });
    await finishFocus(true);
    await reload();
  };

  const bookmarkHere = where.cfi
    ? notes.find(
        (a) =>
          a.kind === "bookmark" &&
          a.cfi &&
          CFI.compare(a.cfi, CFI.collapse(where.cfi!)) >= 0 &&
          CFI.compare(a.cfi, CFI.collapse(where.cfi!, true)) <= 0,
      )
    : undefined;

  // Two pages in Scroll needs CSS column wrapping (spread-scroll.ts); where the browser has none, the choice is greyed
  // out in Scroll and says why. Settings exist only in the browser, so the check never runs on the server.
  const twoPagesOff = settings?.flow === "scrolled" && props.fileType !== "pdf" && !canWrapColumns();

  const toggleBookmark = async () => {
    if (!where.cfi) return;
    if (bookmarkHere) await forget(bookmarkHere);
    else
      await create({
        kind: "bookmark",
        cfi: CFI.collapse(where.cfi),
        quote: { exact: visibleText.current.slice(0, 160) || where.chapter },
      });
    await reload();
  };

  // Read aloud: highlight the word being spoken, inside the book's own frame
  // (CSS Custom Highlight API, so the book's text is not touched), and turn
  // the page when the voice reaches the end of it.
  const highlightWord = (passageCfi: string, from: number, to: number, inPage?: [number, number] | null): string | null => {
    const v = view.current;
    // Not before the book is open (foliate sets its renderer last), nor in a book that failed to open.
    if (!v?.renderer) return null;
    // A PDF (M13 (e)): the word's place on its page in non-space characters,
    // in the page's text layer; its page is turned to by the player.
    if (props.fileType === "pdf") {
      const page = pdfPage(passageCfi);
      // A word with no place on its page (a scan read aloud from its text edition, where the page's own text has
      // nothing like it): nothing is lit, rather than the wrong word.
      if (inPage === null && page >= 0) {
        spokenPdf.current = null;
        litCfi.current = passageCfi;
        for (const d of pdfDocsOnScreen(v)) (d.defaultView as (Window & { CSS: typeof CSS }) | null)?.CSS.highlights?.delete("nl-spoken");
        return recordLit(listenBar.current, "");
      }
      if (!inPage || page < 0) return null;
      spokenPdf.current = { page, at: inPage };
      // Going on after a pause returns to this page.
      litCfi.current = passageCfi;
      const doc = pdfDocsOnScreen(v).find((d) => d.documentElement.dataset.page === String(page));
      if (doc) return recordLit(listenBar.current, lightPdfWord(v, doc, inPage, "word"));
      // Not shown: the reader turned back from it while it is read. Turn to it
      // again, as an EPUB's pages follow the voice (a page turned to ahead is
      // left alone). Not while a turn is on its way: foliate shows one page at
      // a time, and asking again for a page still opening fails.
      if (!turning.current && pageOpening(v) !== page && page > pdfPage(whereCfi.current ?? "")) {
        turning.current = true;
        mark("nl:turn-request", { page, by: "word" });
        void v
          .goTo(passageCfi)
          .catch(() => undefined)
          .finally(() => {
            turning.current = false;
          });
      }
      return null;
    }
    const { index, anchor } = v.resolveCFI(passageCfi);
    const doc = v.renderer.getContents().find((c) => c.index === index)?.doc;
    if (!doc) return null;
    let range: Range | null = null;
    let el: Element | null = null;
    try {
      const start = anchor(doc).startContainer;
      el = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
      range = el ? rangeForOffsets(el, from, to) : null;
    } catch {
      // A chapter that is still opening has an empty document for a moment: not there yet.
      return null;
    }
    if (!range) return null;
    // Paragraph focus (M21) follows the paragraph read aloud.
    if (el && focusRef.current === "paragraph") {
      spokenBlock.current = el.closest(FOCUS_BLOCKS) ?? el;
      focusBlock(doc, spokenBlock.current);
    }
    const win = doc.defaultView as (Window & { CSS: typeof CSS; Highlight: typeof Highlight }) | null;
    win?.CSS.highlights?.set("nl-spoken", new win.Highlight(range));
    const text = range.toString();
    mark("nl:lit", { index, at: from, text, via: "word" });
    recordLit(listenBar.current, text);
    const wordCfi = v.getCFI(index, range);
    litCfi.current = wordCfi;
    const visible = whereCfi.current;
    if (visible && !turning.current && CFI.compare(wordCfi, CFI.collapse(visible, true)) > 0) {
      // On to the word's page, however many pages on (after a jump in the
      // audio it may be several). foliate ignores a turn asked for while it
      // finishes the last one (about 0.1 s), and then sends no "relocate":
      // so the flag clears when this request is done or ignored, and the
      // next word asks again.
      turning.current = true;
      void v.goTo(wordCfi).finally(() => {
        turning.current = false;
      });
    }
    return text;
  };

  /**
   * Shows a paragraph read aloud, unless it is already on screen. Going on
   * after a pause (`resume`), it shows the word that was being read instead:
   * in a long paragraph that may be on a later page than the paragraph's
   * start, and turning back to the start would only turn forward again.
   */
  const showPassage = (passageCfi: string, opts: { resume?: boolean } = {}) => {
    const v = view.current;
    const visible = whereCfi.current;
    if (!v?.renderer) return;
    const target = opts.resume && litCfi.current ? litCfi.current : passageCfi;
    const at = CFI.collapse(target);
    if (visible && CFI.compare(at, CFI.collapse(visible)) >= 0 && CFI.compare(at, CFI.collapse(visible, true)) <= 0) return;
    if (props.fileType !== "pdf") {
      void v.goTo(target);
      return;
    }
    // A PDF page opens in its own frame. Not asked for again while it opens
    // (foliate fails on that); and until it is open, the word being read does
    // not ask for it either (see highlightWord).
    if (pageOpening(v) === pdfPage(target)) return;
    turning.current = true;
    mark("nl:turn-request", { page: pdfPage(target), by: "passage" });
    void v
      .goTo(target)
      .catch(() => undefined)
      .finally(() => {
        turning.current = false;
      });
  };

  const stopListening = () => {
    litCfi.current = null;
    spokenPdf.current = null;
    // Paragraph focus goes back to the pointer, or the top of the page.
    spokenBlock.current = null;
    refocus();
    // The book may still be opening (no renderer yet): stop all the same.
    for (const { doc } of view.current?.renderer?.getContents() ?? []) {
      (doc.defaultView as (Window & { CSS: typeof CSS }) | null)?.CSS.highlights?.delete("nl-spoken");
    }
    player.stop();
    setListening(false);
  };

  // The app's read-aloud player (components/player): while the bar shows, this
  // page lights its words, turns its pages and draws its bar. Leaving the
  // reader takes the page away; the audio goes on.
  const listenSlot = useRef<HTMLDivElement>(null);
  const forPlayer = useRef({ highlightWord, showPassage, stopListening });
  useEffect(() => {
    forPlayer.current = { highlightWord, showPassage, stopListening };
  });
  const { attach, stop } = player;
  const showsBar = listening && !!where.cfi;
  // On a phone the sidebar's rail is a row under the book, and a panel is a card over the page: the card must end
  // above the rail, or it covers the tools (a tap on Study with Rewrite open did nothing, 2026-11-01). --below-rail is
  // how far the rail's top is from the bottom of the screen.
  useEffect(() => {
    const el = root.current;
    if (!sidebar || !el) return;
    const measure = () => {
      const top = rail.current?.getBoundingClientRect().top;
      if (top === undefined) el.style.removeProperty("--below-rail");
      else el.style.setProperty("--below-rail", `${Math.max(0, window.innerHeight - top)}px`);
    };
    measure();
    const sizes = new ResizeObserver(measure);
    if (host.current) sizes.observe(host.current);
    if (rail.current) sizes.observe(rail.current);
    window.addEventListener("resize", measure);
    return () => {
      sizes.disconnect();
      window.removeEventListener("resize", measure);
      el.style.removeProperty("--below-rail");
    };
  }, [sidebar]);
  // A tap or click outside the selected-text bar closes it (M27 Q1); taps inside the book are caught in its frames.
  // While the Read aloud bar shows (a note open in the selected-text bar, or text selected while listening), the
  // selected-text bar sits above it instead of over it.
  const selecting = !!selection;
  useEffect(() => {
    if (!selecting) return;
    const outside = (e: PointerEvent) => {
      if (!selectionBar.current?.contains(e.target as Node)) dismissSelection();
    };
    document.addEventListener("pointerdown", outside, true);
    const bar = selectionBar.current;
    const lift = () => {
      // The player draws the Read aloud bar into its slot a moment after the slot appears.
      const top = showsBar ? listenSlot.current?.firstElementChild?.getBoundingClientRect().top : undefined;
      if (top === undefined) bar?.style.removeProperty("--above-listen");
      else bar?.style.setProperty("--above-listen", `${Math.max(0, window.innerHeight - top)}px`);
    };
    lift();
    // The Read aloud bar is a row of the reader's grid: it appearing, or wrapping on a phone, resizes the book's box.
    const sizes = new ResizeObserver(lift);
    if (host.current) sizes.observe(host.current);
    window.addEventListener("resize", lift);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      sizes.disconnect();
      window.removeEventListener("resize", lift);
    };
  }, [selecting, showsBar, dismissSelection]);
  // Only once the book is open: before that the page can neither turn nor light a word (coming back
  // to a book still read aloud, the bar would show while the book opens, and its calls would fail).
  // (Opened or failed: a book that could not open still shows the bar, so × can stop its audio.)
  const ready = status !== "loading";
  useEffect(() => {
    const slot = listenSlot.current;
    if (!showsBar || !ready || !slot) return;
    return attach(
      {
        slot,
        onWord: (passageCfi, from, to, inPage) => forPlayer.current.highlightWord(passageCfi, from, to, inPage),
        onPassage: (passageCfi, opts) => forPlayer.current.showPassage(passageCfi, opts),
        renderBar: (view) => <ListenBar view={view} ref={listenBar} onClose={() => forPlayer.current.stopListening()} />,
      },
      props.bookId,
      // Where the reader is now: reading aloud starts here (unless this book is already being read aloud).
      whereCfi.current!,
      // Home's "Listen from here" means from the reading position, even if this book was being read aloud.
      !!props.startListening,
    );
  }, [showsBar, ready, attach, props.bookId, props.startListening]);
  // Another book is being read aloud: opening this one stops it, as leaving the reader did before
  // reading aloud went on from page to page (this reader has no bar for another book).
  const playingBook = player.bookId;
  useEffect(() => {
    if (playingBook && playingBook !== props.bookId) stop();
  }, [playingBook, props.bookId, stop]);

  const update = (patch: Partial<ReaderSettings>) => setSettings((s) => (s ? withEink({ ...s, ...patch }) : s));

  // Read it rewritten (M17): a change here is the account's view too (also on the Account page), so every
  // book and device opens in it. Shown at once; if it cannot be saved, it still holds in this reader.
  const showRewritten = (mode: RewrittenMode) => {
    setRewritten((r) => ({ mode, last: mode === "original" ? r.last : mode }));
    if (props.visitor) return;
    void fetch("/api/account/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rewrittenView: mode }),
    }).catch(() => {});
  };
  const paneMode = rewritten.mode !== "original" && screen ? rewritten.mode : null;
  const percent = Math.round(where.fraction * 100);
  // A panel beside the book on a computer (M19): the same conditions that draw each panel below. Contents is not
  // one of them: it stays over the page on the left and closes once a chapter is picked.
  const panelBeside =
    panel === "notes" ||
    panel === "links" ||
    panel === "images" ||
    panel === "ask" ||
    ((panel === "know" || panel === "questions" || panel === "explain" || panel === "xray" || panel === "genealogy") && Boolean(where.cfi)) ||
    (panel === "picture" && Boolean(activePicture?.picture)) ||
    (panel === "rewrite" && Boolean(rewriteAt)) ||
    (panel === "settings" && Boolean(settings));
  const recallRow = Boolean(withRecall);
  // Full screen with nothing open: the book fills the screen and the bars lie over it (reader.module.css, the end).
  const bare = full && panel === "none" && !sidebar && !focusSession;
  // Answering a whole-book focus saves a note: show it (M26 R5).
  useEffect(() => {
    bookAnswered.current = () => void reload();
  });
  const stageClass = [
    styles.stage,
    paneMode === "side" ? styles.stageSide : "",
    panelBeside ? styles.stagePanel : "",
    sidebar ? styles.stageRail : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={root}
      className={(settings ? readerClass(settings) : styles.reader) + withRecall}
      data-testid="reader"
      data-cfi={where.cfi ?? ""}
      data-status={status}
      data-focus-session={focusSession ? "" : undefined}
      data-fullscreen={full ? "" : undefined}
      data-bare={bare ? "" : undefined}
      data-idle={bare && idle ? "" : undefined}
    >
      {focusSession ? (
        <FocusStrip session={focusSession} onLeave={() => setFocusLeaving(true)} onStay={() => focusWait("DELETE")} />
      ) : (
      <header className={styles.bar}>
        {/* Left, as in Kindle: leave the book, and the table of contents. */}
        <div className={styles.lead}>
          <Link
            href={props.visitor?.backHref ?? "/"}
            className={`${styles.tool} ${styles.leadTool}`}
            aria-label={props.visitor ? "Back to the shelf" : "Back to your library"}
            title={props.visitor ? "Back to the shelf" : "Back to your library"}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10 2.5 4.5 8l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <button
            type="button"
            className={`${styles.tool} ${styles.leadTool}`}
            aria-label="Contents"
            title="Contents"
            aria-expanded={panel === "contents"}
            onClick={() => setPanel(panel === "contents" ? "none" : "contents")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5.5 3.5h8M5.5 8h8M5.5 12.5h8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="2.5" cy="3.5" r="1" fill="currentColor" />
              <circle cx="2.5" cy="8" r="1" fill="currentColor" />
              <circle cx="2.5" cy="12.5" r="1" fill="currentColor" />
            </svg>
          </button>
        </div>
        <p className={styles.title}>
          <span className={styles.titleText}>{props.title}</span>
          {props.author ? <span className={styles.author}> · {props.author}</span> : null}
        </p>
        <div className={styles.tools}>
          {canFull ? (
            <button
              type="button"
              className={`${styles.tool} ${styles.leadTool} ${styles.fullTool}`}
              aria-pressed={full}
              aria-label={full ? "Leave full screen" : "Full screen"}
              title={full ? "Leave full screen (F or Esc)" : "Full screen (F)"}
              onClick={toggleFull}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d={full ? "M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" : "M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            className={styles.tool}
            aria-expanded={panel === "settings"}
            aria-label="Reading settings"
            onClick={() => setPanel(panel === "settings" ? "none" : "settings")}
          >
            Aa
          </button>
          <button
            type="button"
            className={`${styles.tool} ${styles.leadTool}`}
            aria-expanded={sidebar}
            aria-label="Sidebar"
            title={
              props.visitor
                ? sidebar
                  ? "Hide the sidebar: Study, Rewritten"
                  : "Show the sidebar: Study, Rewritten"
                : sidebar
                  ? "Hide the sidebar: Notes, Study, Rewritten, Bookmark, Focus"
                  : "Show the sidebar: Notes, Study, Rewritten, Bookmark, Focus"
            }
            onClick={() => {
              if (sidebar && panel !== "settings" && panel !== "contents") setPanel("none");
              setSidebarOpen(!sidebar);
            }}
          >
            <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true">
              <rect x="1.5" y="2" width="15" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M11.5 2v12" stroke="currentColor" strokeWidth="1.4" />
              {sidebar ? <path d="M11.5 2.7h3.3a1 1 0 0 1 1 1v8.6a1 1 0 0 1-1 1h-3.3z" fill="currentColor" /> : null}
            </svg>
          </button>
        </div>
      </header>
      )}

      {/* M28 S3: a row of its own between the bar and the book, so the strip never covers the page's first lines. */}
      {recallRow ? (
        <div className={styles.recallSlot}>
          {bookFocus.focus ? (
            <BookFocusLine session={bookFocus.focus} onLeave={() => bookFocus.setLeaving(true)} onStay={() => bookFocus.wait("DELETE")} />
          ) : null}
          {props.recall && status === "ready" && !elsewhere ? (
            <WhereWereWeStrip bookId={props.bookId} recall={props.recall!} onSeeMissed={() => setPanel("explain")} onSaved={() => void reload()} />
          ) : null}
        </div>
      ) : null}
      {genealogy ? (
        <GenealogyView
          data={genealogy.data}
          view={genealogy.view}
          focus={genealogy.focus}
          onClose={() => setGenealogy(null)}
          onGo={(cfi) => void view.current?.goTo(cfi)}
          also={props.visitor ? undefined : alsoIn}
        />
      ) : null}
      {xrayCard ? (
        <XrayCard
          bookId={props.bookId}
          cfi={where.cfi}
          entryId={xrayCard}
          onClose={() => setXrayCard(null)}
          onGo={(cfi) => void view.current?.goTo(cfi)}
          onGenealogy={openGenealogy}
          onAll={() => {
            setXrayCard(null);
            setPanel("xray");
          }}
        />
      ) : null}
      {/* With Focus on, the X-ray's dotted underlines are quieter too (xray-marks.ts): a custom highlight cannot dim them (.stage[data-focus]). */}
      <div ref={stage} className={stageClass} data-focus={settings && settings.focus !== "off" ? "" : undefined}>
        <button type="button" className={`${styles.turn} ${styles.turnPrev}`} aria-label="Previous page" onClick={() => turnRef.current("prev")}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M11 3 5 9l6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        {/* Covered by the rewrite alone: kept open (and its turns working) but out of reach. */}
        <div ref={host} className={styles.host} inert={paneMode === "rewritten"} />
        {/* Focus (M21): the ruler's band, over the book and taking no clicks (Reader.module.css, .lens). */}
        <div className={styles.lensClip} aria-hidden="true" hidden={paneMode === "rewritten"}>
          <div ref={lensEl} className={styles.lens} data-testid="ruler" />
        </div>
        <button type="button" className={`${styles.turn} ${styles.turnNext}`} aria-label="Next page" onClick={() => turnRef.current("next")}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="m7 3 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        {status === "loading" ? (
          <p className={styles.notice} role="status">
            Opening the book…{downloaded ? ` ${downloaded} downloaded` : ""}
          </p>
        ) : null}
        {elsewhere && status === "ready" ? (
          <div className={styles.elsewhere} role="status">
            <p>You left off at {Math.round(elsewhere.fraction * 100)}% on another device, or while listening.</p>
            <button
              type="button"
              className={styles.primaryTool}
              onClick={() => {
                ownPlaces.current.add(elsewhere.cfi);
                void view.current?.goTo(elsewhere.cfi);
                setElsewhere(null);
              }}
            >
              Go there
            </button>
            <button
              type="button"
              className={styles.tool}
              onClick={() => {
                ownPlaces.current.add(elsewhere.cfi);
                setElsewhere(null);
              }}
            >
              Stay here
            </button>
          </div>
        ) : null}
        {status === "error" ? (
          <p className={styles.notice} role="alert">
            This book could not be opened. Go back and try again.
          </p>
        ) : null}
        {paneMode && screen ? (
          <RewrittenPane bookId={props.bookId} from={screen.from} to={screen.to} mode={paneMode} onMode={showRewritten} turn={turn} setTurn={setTurn} />
        ) : null}

        {/* The sidebar (sidebar.ts): the reading tools in a rail on the right; a panel opens beside it. */}
        {sidebar ? (
          <nav ref={rail} id="reader-sidebar" className={styles.rail} aria-label="Reading tools">
            {/* M34: a visitor gets Study and Rewritten only (no notes, bookmarks or focus: those need an account). */}
            {props.visitor ? null : (
            <button
              type="button"
              className={styles.railTool}
              aria-expanded={panel === "notes"}
              onClick={() => setPanel(panel === "notes" ? "none" : "notes")}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path d="M4 2.5h7l3 3v10H4z M11 2.5v3h3 M6.5 9h5 M6.5 12h4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              <span className={styles.railWord}>
                Notes{notes.length ? <span> ({notes.length})</span> : null}
              </span>
            </button>
            )}
            {/* Study (M19 P5): "What do I need to know?", Test yourself, Ask and Explain it back, as tabs. */}
            <button
              type="button"
              className={styles.railTool}
              aria-expanded={panel === "know" || panel === "questions" || panel === "ask" || panel === "explain"}
              aria-label="Study"
              title="Study: what this chapter takes for granted, questions on it, and your own summary of it"
              onClick={() => setPanel(panel === "know" || panel === "questions" || panel === "ask" || panel === "explain" ? "none" : "know")}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M8 4.3C6.4 3.1 4.2 2.8 1.8 3.3v9.4c2.4-.5 4.6-.2 6.2 1 1.6-1.2 3.8-1.5 6.2-1V3.3c-2.4-.5-4.6-.2-6.2 1zM8 4.3v9.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
              <span className={styles.railWord}>Study</span>
            </button>
            <button
              type="button"
              className={styles.railTool}
              aria-pressed={rewritten.mode !== "original"}
              aria-label="Rewritten view"
              title="Read it rewritten, in your AI explanations style"
              onClick={() => showRewritten(rewritten.mode !== "original" ? "original" : rewritten.last)}
            >
              <svg width="20" height="18" viewBox="0 0 18 16" aria-hidden="true">
                <rect x="1" y="2" width="7" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <path d="M3 5h3M3 7.5h3M3 10h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                <path d="M10.5 2.5h5.5v11h-5.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.6 1.4" />
                <path d="M12.5 5.5h2M12.5 8h2M12.5 10.5h1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              </svg>
              <span className={styles.railWord}>Rewritten</span>
            </button>
            {/* Who & what (M32), with the names on this page at its top: opened when wanted, never over the text
                (Samuel, 2026-11-08: the "On this page" strip sometimes hid the reading). Not for a visitor (M34),
                whose Study has no Who & what tab either. */}
            {props.visitor ? null : (
            <button
              type="button"
              className={styles.railTool}
              aria-expanded={panel === "xray"}
              title="Who & what: the names on this page, and everyone the book has named so far"
              onClick={() => setPanel(panel === "xray" ? "none" : "xray")}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="5.5" cy="5" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <path d="M1.5 13.5c.4-2.6 2-4 4-4s3.6 1.4 4 4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M10.5 4h4M10.5 7h4M12 10h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              {/* One short word: "Who & what" wrapped onto two lines on a phone, which made the bar taller and the page shorter. */}
              <span className={styles.railWord}>Names</span>
            </button>
            )}
            {props.visitor ? null : (
            <button
              type="button"
              className={styles.railTool}
              aria-pressed={Boolean(bookmarkHere)}
              aria-label={bookmarkHere ? "Remove bookmark" : "Bookmark this page"}
              onClick={() => void toggleBookmark()}
            >
              <svg width="16" height="18" viewBox="0 0 14 16" aria-hidden="true">
                <path d="M2 1.5h10v13l-5-3.5-5 3.5z" fill={bookmarkHere ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
              <span className={styles.railWord}>Bookmark</span>
            </button>
            )}
            {/* A focus session with a question (M26 R3). Not during a whole-book focus (M26 R5): one at a time. */}
            {bookFocus.focus || props.visitor ? null : (
              <button
                type="button"
                className={styles.railTool}
                aria-label="Focus session"
                title="Focus session: write the question you are reading to answer, set a timer, and see only the page"
                aria-haspopup="dialog"
                onClick={() => setFocusStart(true)}
              >
                <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M8 6v3l2 1.5M6 1.5h4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className={styles.railWord}>Focus</span>
              </button>
            )}
          </nav>
        ) : null}

        {/* One panel at a time. On a computer it sits in a column beside the book (M19), never over it. */}
        {panel === "notes" ? (
          <NotesPanel
            bookId={props.bookId}
            title={props.title}
            author={props.author}
            themeEl={() => root.current}
            items={notes}
            activeId={activeId}
            onGo={(a) => {
              const v = view.current;
              if (a.cfi) void v?.goTo(a.cfi);
              // A note from the other version not found here yet: its printed page (it is found when the page is shown).
              else if (a.crossed && props.fileType === "pdf") void v?.goTo(`epubcfi(/6/${a.crossed.page * 2})`);
              else if (a.crossed) {
                const href = v?.book.pageList?.find((item) => item.label === String(a.crossed!.page))?.href;
                if (href) void v?.goTo(href);
              }
            }}
            onSave={saveNote}
            onDelete={removeNote}
            removed={removed?.note ?? null}
            onUndo={() => void undoRemove()}
            notSaved={refused.map((w) => describeRefused(w, notes))}
            onDismiss={(id) => void dismissRefused(id)}
            onAddBookNote={addBookNote}
          />
        ) : null}

        {panel === "know" && where.cfi ? (
          <NeedToKnowPanel key={where.chapter} bookId={props.bookId} cfi={where.cfi} onTab={setPanel} visitor={Boolean(props.visitor)} />
        ) : null}
        {panel === "questions" && where.cfi ? (
          <QuestionsPanel key={where.chapter} bookId={props.bookId} cfi={where.cfi} onTab={setPanel} visitor={Boolean(props.visitor)} />
        ) : null}
        {panel === "ask" ? (
          <AskPanel
            bookId={props.bookId}
            onTab={setPanel}
            onGo={(cfi, close) => {
              void view.current?.goTo(cfi);
              if (close) setPanel("none");
            }}
          />
        ) : null}

        {panel === "explain" && where.cfi ? (
          <ExplainPanel
            key={where.chapter}
            bookId={props.bookId}
            cfi={where.cfi}
            onTab={setPanel}
            onGo={(cfi, close) => {
              void view.current?.goTo(cfi);
              if (close) setPanel("none");
            }}
            onSaved={() => void reload()}
          />
        ) : null}

        {panel === "xray" && where.cfi ? (
          <XrayPanel bookId={props.bookId} cfi={where.cfi} onPage={onPage} onTab={setPanel} onGo={(cfi) => void view.current?.goTo(cfi)} onGenealogy={openGenealogy} />
        ) : null}

        {panel === "genealogy" && where.cfi ? (
          <GenealogyPanel bookId={props.bookId} cfi={where.cfi} onTab={setPanel} onOpen={(data, v, focus) => setGenealogy({ data, view: v, focus })} />
        ) : null}

        {panel === "links" ? <CrossLinksPanel links={links} /> : null}

        {panel === "images" ? (
          <ImagesPanel key={imagesFor} bookId={props.bookId} initialQuery={imagesFor} onPin={imagesAt ? pinPicture : undefined} />
        ) : null}

        {panel === "picture" && activePicture?.picture ? (
          <PictureCard picture={activePicture.picture} url={activePicture.pictureUrl} quote={activePicture.quote.exact} />
        ) : null}

        {panel === "rewrite" && rewriteAt ? <RewritePanel key={rewriteAt} bookId={props.bookId} cfi={rewriteAt} /> : null}

        {panel === "contents" ? (
          <nav className={`${styles.panel} ${styles.panelLeft}`} aria-label="Contents">
            <p className={styles.panelTitle}>Contents</p>
            <JumpTo
              pages={pageCount}
              current={pageCount ? Math.max(pdfPage(where.cfi ?? ""), 0) + 1 : percent}
              onGo={(n) => {
                // A PDF's page n is section n - 1, whose address is epubcfi(/6/2n); an EPUB goes to n% of the book.
                void (pageCount ? view.current?.goTo(`epubcfi(/6/${n * 2})`) : view.current?.goToFraction(n / 100));
                setPanel("none");
              }}
            />
            {props.visitor ? null : (
              <FindInBook
                bookId={props.bookId}
                onGo={(cfi) => {
                  void view.current?.goTo(cfi);
                  setPanel("none");
                }}
              />
            )}
            <TocList
              items={toc}
              current={where.chapter}
              onPick={(href) => {
                void view.current?.goTo(href);
                setPanel("none");
              }}
            />
          </nav>
        ) : null}

        {panel === "settings" && settings ? (
          <section className={styles.panel} aria-label="Reading settings">
            <p className={styles.panelTitle}>Reading settings</p>
            <fieldset className={styles.group}>
              <legend>Pages</legend>
              <Segment
                value={settings.pages}
                options={[
                  ["one", "One page"],
                  ["two", "Two pages", twoPagesOff],
                ]}
                onChange={(pages) => update({ pages })}
              />
              {twoPagesOff ? (
                <p className={styles.hint} data-testid="two-pages-note">
                  Two pages in Scroll needs Chrome or Edge. In this browser, it works with the Pages layout.
                </p>
              ) : null}
            </fieldset>
            {props.fileType === "pdf" ? (
              <p className={styles.hint}>This is a PDF: its pages keep their own layout, so text settings do not apply.</p>
            ) : (
              <>
            <fieldset className={styles.group}>
              <legend>Layout</legend>
              <Segment
                value={settings.flow}
                options={[
                  ["paginated", "Pages"],
                  ["scrolled", "Scroll", settings.eink],
                ]}
                onChange={(flow) => update({ flow })}
              />
              {settings.eink ? (
                <p className={styles.hint} data-testid="eink-scroll-note">
                  E-ink screens smear while scrolling, so E-ink reads in Pages.
                </p>
              ) : null}
            </fieldset>
            <fieldset className={styles.group}>
              <legend>Width</legend>
              <Segment
                value={settings.width}
                options={[["comfortable", "Comfortable"], ["wide", "Wide"], ["full", "Full"]]}
                onChange={(width) => setSettings((s) => (s ? withWidth(s, width) : s))}
              />
              <label className={styles.check}>
                <input type="checkbox" checked={settings.justify} onChange={(e) => update({ justify: e.target.checked })} />
                Justify (straight edges on both sides)
              </label>
              <p className={styles.hint}>
                Wide and Full use more of a big screen, with bigger text; each width keeps its own text size. On a phone the text
                already fills the screen.
              </p>
            </fieldset>
            <fieldset className={styles.group}>
              <legend>Text size</legend>
              <div className={styles.sizeRow}>
                <button
                  type="button"
                  className={styles.step}
                  aria-label="Smaller text"
                  disabled={settings.size === SIZES[0]}
                  onClick={() => update({ size: SIZES[Math.max(0, SIZES.indexOf(settings.size) - 1)] })}
                >
                  A−
                </button>
                <span className={styles.sizeValue} data-testid="text-size">
                  {settings.size}%
                </span>
                <button
                  type="button"
                  className={styles.step}
                  aria-label="Larger text"
                  disabled={settings.size === SIZES.at(-1)}
                  onClick={() => update({ size: SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(settings.size) + 1)] })}
                >
                  A+
                </button>
              </div>
            </fieldset>
            <fieldset className={styles.group}>
              <legend>Line spacing</legend>
              <Segment
                value={settings.spacing}
                options={[["compact", "Compact"], ["normal", "Normal"], ["loose", "Loose"]]}
                onChange={(spacing) => update({ spacing })}
              />
            </fieldset>
            <fieldset className={styles.group}>
              <legend>Typeface</legend>
              <Segment
                value={settings.face}
                options={[["serif", "Serif"], ["sans", "Sans"], ["book", "Book's own"]]}
                onChange={(face) => update({ face })}
              />
            </fieldset>
            <fieldset className={styles.group}>
              <legend>Focus</legend>
              <Segment
                value={settings.focus}
                options={[["off", "Off"], ["ruler", "Ruler"], ["paragraph", "Paragraph"]]}
                onChange={(focus) => update({ focus })}
              />
              <p className={styles.hint}>
                Ruler: a soft band sits on the line under your pointer, or the line you tap; in Scroll it stays put and the
                text moves under it. Paragraph: the paragraph you are on stays clear and the rest dims.
              </p>
            </fieldset>
            {settings.focus === "ruler" ? (
              <fieldset className={styles.group}>
                <legend>Ruler height</legend>
                <Segment
                  value={String(settings.rulerLines) as "1" | "2" | "3"}
                  options={[["1", "1 line"], ["2", "2 lines"], ["3", "3 lines"]]}
                  onChange={(n) => update({ rulerLines: Number(n) as RulerLines })}
                />
                <p className={styles.hint}>Two or three lines in the band at once: the line you tap and the ones after it.</p>
              </fieldset>
            ) : null}
            {props.figures?.length ? (
              <fieldset className={styles.group}>
                <legend>Figures</legend>
                <Segment
                  value={settings.figures}
                  options={[["redrawn", "Redrawn"], ["printed", "As printed"]]}
                  onChange={(figures) => update({ figures })}
                />
                <p className={styles.hint}>
                  {props.figures.length === 1 ? "One figure is" : `${props.figures.length} figures are`} drawn again cleanly by AI from the
                  paper&apos;s own, and checked to match it line for line and word for word. Tap a figure to compare it with the printed one.
                </p>
              </fieldset>
            ) : null}
            {props.citations?.cites.length ? (
              <fieldset className={styles.group}>
                <legend>Citations</legend>
                <Segment
                  value={settings.citations}
                  options={[["as-written", "As written"], ["numbered", "Numbered"], ["hidden", "Hidden"]]}
                  onChange={(citations) => update({ citations })}
                />
                <p className={styles.hint}>
                  Numbered shows each work by its place in the reference list, counted from the top: [12]. On a computer, point at a
                  number to see the work.
                  {props.citations.unmatched
                    ? ` ${props.citations.unmatched} ${props.citations.unmatched === 1 ? "citation names" : "citations name"} a work the list does not hold exactly once, and ${props.citations.unmatched === 1 ? "stays" : "stay"} as written.`
                    : ""}
                </p>
              </fieldset>
            ) : null}
              </>
            )}
            <fieldset className={styles.group}>
              <legend>Screen</legend>
              <label className={styles.check}>
                <input type="checkbox" checked={settings.eink} onChange={(e) => update({ eink: e.target.checked })} />
                E-ink (a paper-like screen, such as a Boox or a Kindle)
              </label>
              <p className={styles.hint}>
                Black on white, nothing that moves or fades, and highlights drawn as lines under the words. Kept on this device
                only.
              </p>
            </fieldset>
            <fieldset className={styles.group}>
              <legend>Theme</legend>
              <Segment
                className={styles.themeChoices}
                value={settings.theme}
                options={[...READER_THEMES]}
                onChange={(theme) => update({ theme })}
              />
              <p className={styles.hint}>
                {settings.eink
                  ? "With E-ink on, every theme is black on white, and Night is white on black."
                  : "North Window is cool daylight with a teal mark. Private Press is bright paper with a red mark. Calfskin is warm hide with a gold mark."}
              </p>
            </fieldset>
            {props.fileType === "pdf" ? (
            <fieldset className={styles.group}>
              <legend>PDF pages at night</legend>
              <Segment
                value={settings.dimPdf ? "dim" : "printed"}
                options={[
                  ["dim", "Dimmed"],
                  ["printed", "As printed"],
                ]}
                onChange={(v) => update({ dimPdf: v === "dim" })}
              />
            </fieldset>
          ) : null}
          <p className={styles.hint}>Auto follows your device&apos;s light or dark setting. Arrow keys turn pages.</p>
            <button type="button" className={styles.linkButton} onClick={() => setShortcuts(true)}>
              Keyboard shortcuts
            </button>
            {props.ownKeys || props.visitor ? <OwnKeysSetting /> : null}
            {props.visitor ? null : (
              <>
                <AiStyleSetting bookId={props.bookId} />
                <p className={styles.hint}>
                  STE is Simplified Technical English: one meaning per word, short sentences. The style is used by the rewritten view,
                  Study and Rewrite; the Account page sets it for every book.
                </p>
                <OfflineSetting bookId={props.bookId} fileUrl={props.fileUrl} fileType={props.fileType} />
              </>
            )}
          </section>
        ) : null}
      </div>

      {/* Between the book and the foot, so it never covers the page's last lines. */}
      {showsBar ? <div ref={listenSlot} className={styles.listenSlot} /> : null}

      <footer className={styles.foot}>
        <span className={styles.chapter}>
          <span className={styles.chapterName}>{where.chapter}</span>
          {links.length ? (
            <button
              type="button"
              className={styles.linksButton}
              aria-expanded={panel === "links"}
              onClick={() => setPanel(panel === "links" ? "none" : "links")}
            >
              {links.length === 1 ? "1 link to your other books" : `${links.length} links to your other books`}
            </button>
          ) : null}
        </span>
        <span className={styles.progress} aria-hidden="true">
          <span className={styles.progressFill} data-progress={Math.round(where.fraction * 50) * 2} />
        </span>
        <span className={styles.footRight}>
          {props.edition ? <EditionSwitch edition={props.edition} scanPage={scanPage} /> : null}
          {props.visitor ? null : (
            <button
              type="button"
              className={styles.listenButton}
              aria-pressed={listening}
              disabled={!where.cfi}
              title="Read aloud"
              onClick={() => {
                // The Read aloud bar opens where the selected-text bar sits (M27 Q1): one at a time.
                if (!listening) dismissSelection();
                if (listening) stopListening();
                else setListening(true);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M2 5h2.5L8 2v10L4.5 9H2z" fill="currentColor" />
                <path d="M10 4.5a3.5 3.5 0 0 1 0 5M11.5 3a5.5 5.5 0 0 1 0 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              Listen
            </button>
          )}
          <span className={styles.percent} aria-label={`${percent}% read`}>
            {percent}%
          </span>
        </span>
      </footer>

      {selection && !props.visitor ? (
        <SelectionBar
          ref={selectionBar}
          bookId={props.bookId}
          selection={selection}
          title={props.title}
          author={props.author}
          themeEl={() => root.current}
          onHighlight={highlight}
          onVoiceNote={saveVoiceNote}
          onSticker={addSticker}
          onDrawing={saveDrawing}
          onImages={() => {
            setImagesFor(selection.exact.slice(0, 80));
            setImagesAt(selection);
            clearSelection();
            setPanel("images");
          }}
          onRewrite={() => {
            setRewriteAt(selection.cfi);
            clearSelection();
            setPanel("rewrite");
          }}
          onClose={clearSelection}
          onBusy={onSelectionBusy}
        />
      ) : null}

      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
      <FigureView figure={figure} onClose={() => setFigure(null)} />
      <TableView table={wholeTable} onClose={() => setWholeTable(null)} />
      <EquationView bookId={props.bookId} equation={equation} onClose={() => setEquation(null)} />
      <StartFocusDialog
        open={focusStart}
        onStart={beginFocus}
        onStartBook={async (question, days) => {
          await bookFocus.start(question, days);
          setFocusStart(false);
        }}
        onCancel={() => setFocusStart(false)}
      />
      <LeaveFocusDialog
        key={`leave-${focusSession?.id ?? ""}`}
        session={focusSession}
        open={Boolean(focusSession) && focusLeaving && !focusEnding}
        waitMinutes={focusWaitMinutes}
        onAnswer={answerFocus}
        onWait={() => focusWait("POST")}
        onCancel={() => setFocusLeaving(false)}
      />
      <EndFocusDialog key={focusSession?.id ?? ""} session={focusSession} open={Boolean(focusSession) && focusEnding} onSave={answerFocus} onSkip={() => finishFocus()} />
      {/* Whole-book focus (M26 R5): the same two dialogs, with the whole book's ways out (150 words, or 24 hours). */}
      <LeaveFocusDialog
        key={`leave-book-${bookFocus.focus?.id ?? ""}`}
        session={bookFocus.focus}
        open={Boolean(bookFocus.focus) && bookFocus.leaving && !bookFocus.ending}
        waitMinutes={bookFocus.waitMinutes}
        minWords={bookFocus.minWords}
        testId="book-focus-leave"
        onAnswer={bookFocus.answer}
        onWait={() => bookFocus.wait("POST")}
        onCancel={() => bookFocus.setLeaving(false)}
      />
      <EndFocusDialog
        key={`end-book-${bookFocus.focus?.id ?? ""}`}
        session={bookFocus.focus}
        open={Boolean(bookFocus.focus) && bookFocus.ending}
        heading={bookFocus.heading}
        testId="book-focus-end"
        onSave={bookFocus.answer}
        onSkip={bookFocus.skip}
      />
    </div>
  );
}

function Segment<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  /** Value, label, and whether this choice is unavailable here (shown greyed out; a note beside says why). */
  options: readonly (readonly [T, string, boolean?])[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={className ? `${styles.segment} ${className}` : styles.segment}>
      {options.map(([v, label, off]) => (
        <button key={v} type="button" className={styles.segmentButton} aria-pressed={value === v} disabled={off} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** The table of contents; the chapter being read is marked (as in Kindle). */
/**
 * Go to a page of a PDF, or to a percentage of an EPUB (M20 Q4): the way to
 * move far in a book without turning page by page, for a keyboard or a
 * screen reader too (the progress bar at the foot is only a picture).
 */
function JumpTo({ pages, current, onGo }: { pages: number; current: number; onGo: (n: number) => void }) {
  const [value, setValue] = useState(String(current));
  const pdf = pages > 0;
  const [min, max] = pdf ? [1, pages] : [0, 100];
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= min && n <= max;
  return (
    <form
      className={styles.jumpTo}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onGo(n);
      }}
    >
      <label htmlFor="jump-to" className={styles.groupLabel}>
        {pdf ? `Go to page (1 to ${pages})` : "Go to a percentage of the book"}
      </label>
      <div className={styles.jumpRow}>
        <input
          id="jump-to"
          className={styles.jumpInput}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {pdf ? null : <span className={styles.hint}>%</span>}
        <button type="submit" className={styles.tool} disabled={!valid}>
          Go
        </button>
      </div>
    </form>
  );
}

function TocList({ items, onPick, current }: { items: TocItem[]; onPick: (href: string) => void; current: string }) {
  if (!items.length) return <p className={styles.hint}>This book has no table of contents.</p>;
  return (
    <ol className={styles.toc}>
      {items.map((t, i) => (
        <li key={`${t.href}-${i}`}>
          <button
            type="button"
            className={styles.tocItem}
            aria-current={current && t.label.trim() === current ? "true" : undefined}
            onClick={() => onPick(t.href)}
          >
            {t.label.trim()}
          </button>
          {t.subitems?.length ? <TocList items={t.subitems} onPick={onPick} current={current} /> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * Scan | Text (M25, Samuel's C1): a scanned PDF and its text edition, side by side in the footer. Each opens at the
 * page being read: the scan at that page, the text edition at that page's marker. In the text edition, a link names
 * the scan's page, to check a word against the printed page.
 */
function EditionSwitch({ edition, scanPage }: { edition: { scanId: string; textId: string; current: "scan" | "text" }; scanPage: number | null }) {
  // view=scan: the scan itself, asked for (a scan with a text edition otherwise opens the edition).
  const scanHref = `/books/${edition.scanId}/read?view=scan${scanPage ? `&at=${encodeURIComponent(`epubcfi(/6/${scanPage * 2})`)}` : ""}`;
  const textHref = `/books/${edition.textId}/read${scanPage ? `?page=${scanPage}` : ""}`;
  return (
    <>
      <span className={styles.edition} role="group" aria-label="Edition">
        {edition.current === "scan" ? (
          <span className={styles.editionOn} aria-current="page">
            Scan
          </span>
        ) : (
          <a className={styles.editionOff} href={scanHref}>
            Scan
          </a>
        )}
        {edition.current === "text" ? (
          <span className={styles.editionOn} aria-current="page">
            Text
          </span>
        ) : (
          <a className={styles.editionOff} href={textHref} title="The same book as flowing text, read from the scan by Claude">
            Text
          </a>
        )}
      </span>
      {edition.current === "text" && scanPage ? (
        <a className={styles.scanPage} href={scanHref} aria-label={`Scan page ${scanPage}`}>
          <span className={styles.scanPageWord}>Scan page </span>
          <span className={styles.scanPageShort} aria-hidden="true">
            p.{" "}
          </span>
          {scanPage}
        </a>
      ) : null}
    </>
  );
}
