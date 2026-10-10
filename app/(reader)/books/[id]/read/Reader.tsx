"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as CFI from "foliate-js/epubcfi.js";
import { usePlayer } from "@/components/player/PlayerProvider";
import type { Annotation, Color, Kind } from "@/lib/library/annotations";
import { addToOutbox, flushOutbox, isOffline, opOf, outboxFor, removeFromOutbox, type OutboxItem } from "@/lib/outbox";
import type { CrossLink } from "@/lib/library/crosslinks";
import { STICKERS, type Sticker } from "@/lib/library/stickers";
import { PEN_PATHS } from "@/lib/library/drawings";
import { AiStyleSetting } from "./AiStyleSetting";
import { OfflineSetting } from "./OfflineSetting";
import { CrossLinksPanel } from "./CrossLinksPanel";
import { ListenBar } from "./ListenBar";
import { useReadingTracker } from "./useReadingTracker";
import { ImagesPanel } from "./ImagesPanel";
import { PictureCard } from "./PictureCard";
import { PICTURE_PATHS, type PinnedPicture } from "@/lib/library/pinned";
import { mark } from "@/lib/perf-marks";
import { spreadForPages, TEXT_LAYER_EVENT } from "@/lib/reader/pdf-book";
import { bindSpineClick, pdfSpread, turnWithSpine, type SpineBook } from "@/lib/reader/spine-fold";
import { rangeForNonSpace, rangeForOffsets } from "@/lib/reader/text-range";
import { NeedToKnowPanel } from "./NeedToKnowPanel";
import { NotesPanel } from "./NotesPanel";
import { QuestionsPanel } from "./QuestionsPanel";
import { RewritePanel } from "./RewritePanel";
import { SelectionBar, type PendingSelection } from "./SelectionBar";
import { bookCss, loadSettings, saveSettings, SIZES, type ReaderSettings } from "./settings";
import styles from "./reader.module.css";

type TocItem = { label: string; href: string; subitems?: TocItem[] };
type FoliateView = HTMLElement & {
  open(book: File | object): Promise<void>;
  init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number): Promise<void>;
  prev(): Promise<void>;
  next(): Promise<void>;
  close(): void;
  book: { toc?: TocItem[]; dir?: string; rendition?: { spread?: string } };
  /** `index`: in a PDF, the page shown, or being opened once a turn has begun. */
  renderer: HTMLElement & { setStyles?(css: string): void; getContents(): { doc: Document; index: number }[]; readonly index?: number };
  getCFI(index: number, range: Range): string;
  resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range };
  addAnnotation(a: { value: string }): Promise<unknown>;
  deleteAnnotation(a: { value: string }): Promise<unknown>;
};
type Relocate = { cfi: string; fraction: number; tocItem?: { label?: string; href?: string }; range?: Range };
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

const readerClass = (s: ReaderSettings) => (s.theme === "auto" ? styles.reader : `${styles.reader} theme-${s.theme}`);

const TOKENS = { paper: "--paper", ink: "--ink-900", accent: "--accent", highlight: "--highlight", spoken: "--highlight-active" } as const;

function applySettings(v: FoliateView, s: ReaderSettings, themeEl: Element) {
  const r = v.renderer;
  if (!r.setStyles) return; // PDFs (fixed layout): pages are pictures; only the reader's chrome is themed.
  r.setAttribute("flow", s.flow);
  r.setAttribute("max-inline-size", "680px");
  // "2" is only the wide-window maximum. Scroll stays one column. A window taller than it is wide still forces one (the paginator's portrait rule).
  r.setAttribute("max-column-count", s.flow === "paginated" && s.pages === "two" ? "2" : "1");
  r.setAttribute("margin", "40px");
  r.setAttribute("gap", "7%");
  r.setStyles?.(bookCss(s, themeColors(themeEl, s), location.origin));
}

/** Colours for book pages, read from the design tokens on the reader element (so a theme class applies). */
function themeColors(el: Element, s: ReaderSettings) {
  const cs = getComputedStyle(el);
  const colors: Record<string, string> = Object.fromEntries(
    Object.entries(TOKENS).map(([k, v]) => [k, cs.getPropertyValue(v).trim()]),
  );
  colors.scheme =
    s.theme === "night" || (s.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  return colors;
}

/**
 * Read along in a PDF (M13 (e)): lights non-space characters [a, b) of a
 * page's text layer, in that page's own frame; returns their text, or null
 * if the text layer is not drawn yet. `via`: who asked (the player's frame,
 * or the page's text arriving), for the tests' timing marks. Every other
 * page frame loses its lit word: with two pages side by side, the page read
 * before kept its last word lit while the next page was read (2026-10-09).
 */
function lightPdfWord(v: FoliateView, doc: Document, [a, b]: [number, number], via: "word" | "text-layer"): string | null {
  const layer = doc.querySelector(".textLayer");
  const range = layer ? rangeForNonSpace(layer, a, b) : null;
  if (!range) return null;
  for (const item of v.renderer?.getContents() ?? []) {
    if (item.doc && item.doc !== doc) (item.doc.defaultView as (Window & { CSS: typeof CSS }) | null)?.CSS.highlights?.delete("nl-spoken");
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

/** How long a book may take to open before the reader says it could not be opened. */
const OPEN_TIMEOUT_MS = 30_000;

/** Fired once a book's notes have loaded: send what waits in the outbox (M12). */
const SYNC_EVENT = "neolibrary:sync-notes";

export function Reader(props: {
  bookId: string;
  title: string;
  author: string;
  fileUrl: string;
  fileType: "epub" | "pdf";
  initialCfi: string | null;
  initialFraction: number;
  /** Open with the Read aloud bar showing (Home's "Listen from here"); the reader still presses Play (Safari needs the click). */
  startListening?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const view = useRef<FoliateView | null>(null);
  /** The open PDF, when this book is one, so a fold can draw a page that is not on screen yet. */
  const bookRef = useRef<SpineBook | null>(null);
  const turnRef = useRef<(dir: "next" | "prev") => void>(() => {});
  // A click, an arrow key, or Previous/Next. Read aloud turns with goTo and does not come through here.
  useEffect(() => {
    turnRef.current = (dir) => {
      const v = view.current;
      if (!v) return;
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
  const [panel, setPanel] = useState<"none" | "contents" | "settings" | "notes" | "rewrite" | "know" | "questions" | "links" | "images" | "picture">("none");
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
  const tracker = useReadingTracker(props.bookId, listening);
  const trackerRef = useRef(tracker);
  useEffect(() => {
    trackerRef.current = tracker;
  });
  const whereCfi = useRef<string | null>(props.initialCfi);
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
  const [notes, setNotes] = useState<Annotation[]>([]);
  const notesRef = useRef<Annotation[]>([]);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const selectionDoc = useRef<Document | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const visibleText = useRef("");
  const [where, setWhere] = useState<{ cfi: string | null; fraction: number; chapter: string }>({
    cfi: props.initialCfi,
    fraction: props.initialFraction,
    chapter: "",
  });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const pending = useRef<Relocate | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(
    (keepalive = false) => {
      const loc = pending.current;
      if (!loc) return;
      pending.current = null;
      void fetch(`/api/books/${props.bookId}/position`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cfi: loc.cfi, fraction: loc.fraction }),
        keepalive,
      }).catch(() => {});
    },
    [props.bookId],
  );

  // Highlights in other books that share this page's ideas (cross-book links).
  const lookForLinks = useCallback(
    (text: string) => {
      if (!text || text === linkedText.current) return;
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
    [props.bookId],
  );

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") turnRef.current("next");
    else if (e.key === "ArrowLeft" || e.key === "PageUp") turnRef.current("prev");
    else if (e.key === "Escape") setPanel("none");
  }, []);

  // Open the book once. Settings live on this device (localStorage).
  useEffect(() => {
    if (view.current) return;
    let cancelled = false;
    // Never wait forever: some failures inside the book's frames are thrown
    // where this code cannot catch them (this hid a Safari problem, 2026-10-04).
    const giveUp = setTimeout(() => {
      if (!cancelled) setStatus((s) => (s === "loading" ? "error" : s));
    }, OPEN_TIMEOUT_MS);
    (async () => {
      try {
        const initial = loadSettings();
        await import("foliate-js/view.js");
        const res = await fetch(props.fileUrl);
        if (!res.ok) throw new Error(`file ${res.status}`);
        const blob = await res.blob();
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
        // Highlights: load them, and draw each one when its page is rendered.
        const { Overlayer } = (await import("foliate-js/overlayer.js")) as { Overlayer: { highlight: DrawFn } };
        const loaded: Annotation[] = (await (await fetch(`/api/books/${props.bookId}/annotations`)).json()).annotations ?? [];
        notesRef.current = loaded;
        setNotes(loaded);
        // Send anything made offline earlier, and show what is still waiting (see the sync effect below).
        window.dispatchEvent(new Event(SYNC_EVENT));
        v.addEventListener("create-overlay", () => {
          for (const a of notesRef.current) if (["highlight", "sticker", "drawing", "image"].includes(a.kind) && a.cfi) void v.addAnnotation({ value: a.cfi });
        });
        v.addEventListener("draw-annotation", (e: Event) => {
          const { draw, annotation, range } = (e as CustomEvent<{ draw: (f: DrawFn, o: unknown) => void; annotation: { value: string }; range: Range | null }>)
            .detail;
          const a = notesRef.current.find((x) => x.cfi === annotation.value);
          const cs = getComputedStyle(root.current!);
          if (a?.kind === "sticker" && a.sticker) {
            const fill = cs.getPropertyValue(`--mark-${STICKERS[a.sticker].color}`).trim();
            draw(drawBadge(STICKERS[a.sticker].paths, fill, cs.getPropertyValue("--ink-900").trim(), Overlayer.highlight, range ?? null), {});
            return;
          }
          if (a?.kind === "image") {
            draw(drawBadge(PICTURE_PATHS, cs.getPropertyValue("--mark-sage").trim(), cs.getPropertyValue("--ink-900").trim(), Overlayer.highlight, range ?? null, "right"), {});
            return;
          }
          if (a?.kind === "drawing") {
            draw(drawBadge(PEN_PATHS, cs.getPropertyValue("--mark-sky").trim(), cs.getPropertyValue("--ink-900").trim(), Overlayer.highlight, range ?? null, "right"), {});
            return;
          }
          const color = cs.getPropertyValue(`--mark-${a?.color ?? "sage"}`).trim();
          draw(Overlayer.highlight, { color });
        });
        v.addEventListener("show-annotation", (e: Event) => {
          const a = notesRef.current.find((x) => x.cfi === (e as CustomEvent<{ value: string }>).detail.value);
          if (a) {
            setActiveId(a.id);
            setPanel(a.kind === "image" ? "picture" : "notes");
          }
        });
        root.current!.className = readerClass(initial);
        applySettings(v, initial, root.current!);
        setSettings(initial);
        v.addEventListener("relocate", (e: Event) => {
          const d = (e as CustomEvent<Relocate>).detail;
          if (props.fileType === "pdf") {
            const shown = pdfDocsOnScreen(v)
              .map((doc) => Number(doc.documentElement.dataset.page))
              .filter((n) => Number.isInteger(n) && n >= 0);
            const reported = pdfPage(d.cfi);
            // The patched viewer names the page on screen. Drop an address for a page that is not showing.
            if (shown.length > 0 && reported >= 0 && !shown.includes(reported)) return;
            const held = heldCfi.current?.cfi;
            if (held && pdfPage(d.cfi) !== pdfPage(held)) return;
          }
          const cfi = d.cfi;
          mark("nl:relocate", { cfi });
          setWhere({ cfi, fraction: d.fraction, chapter: d.tocItem?.label?.trim() ?? "" });
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
        });
        v.addEventListener("load", (e: Event) => {
          const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;
          mark("nl:frame-load", { index, page: doc.documentElement.dataset.page ?? null });
          // A PDF page's text layer is complete (the page was just shown) or
          // was laid out for a new size: light the spoken word on it again.
          doc.addEventListener(TEXT_LAYER_EVENT, () => {
            const w = spokenPdf.current;
            if (w && doc.documentElement.dataset.page === String(w.page)) recordLit(listenBar.current, lightPdfWord(v, doc, w.at, "text-layer"));
          });
          doc.addEventListener("keydown", onKey);
          doc.addEventListener("keydown", () => trackerRef.current.onActivity());
          doc.addEventListener("pointerdown", () => trackerRef.current.onActivity());
          if (props.fileType === "pdf") {
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
        await v.init({ lastLocation: props.initialCfi, showTextStart: !props.initialCfi });
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
  }, [props.bookId, props.fileUrl, props.fileType, props.initialCfi, flush, onKey, lookForLinks]);

  // Re-style when settings or the colour scheme change. A PDF's spread is read only when its renderer opens, so a new page choice reopens on the same page.
  useEffect(() => {
    if (!settings) return;
    saveSettings(settings);
    // The theme class must be on the element before colours are read from it.
    if (root.current) root.current.className = readerClass(settings);
    const v = view.current;
    if (v && root.current) applySettings(v, settings, root.current);
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
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => view.current && root.current && applySettings(view.current, settings, root.current);
    mq.addEventListener("change", onChange);
    return () => {
      stop = true;
      mq.removeEventListener("change", onChange);
    };
  }, [settings]);

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
    let server: Annotation[] | null = null;
    try {
      server = (await api(`/api/books/${props.bookId}/annotations`, "GET")).annotations;
    } catch (e) {
      if (!isOffline(e)) throw e;
    }
    const waiting = await outboxFor(props.bookId).catch(() => []);
    setAll(withOutbox(server ?? notesRef.current, waiting));
  };

  const madeOffline = useRef(new Set<string>());

  /** Shows what waits in the outbox on top of the server's list: new notes added, edits applied, removals hidden. */
  const withOutbox = (base: Annotation[], waiting: OutboxItem[]) => {
    const created = waiting.filter((w) => opOf(w) === "create");
    const createdIds = new Set(created.map((w) => w.id));
    madeOffline.current = createdIds;
    let list = [...base.filter((a) => !createdIds.has(a.id)), ...created.map((w) => localAnnotation(w.id, w.body, w.savedAt))];
    for (const w of waiting) {
      if (opOf(w) === "edit") list = list.map((a) => (a.id === w.annotationId ? { ...a, ...(w.body as Partial<Annotation>), pending: true } : a));
      if (opOf(w) === "remove") list = list.filter((a) => a.id !== w.annotationId);
    }
    return list;
  };

  /** Edits or removes a note the server has; with no network the change waits in the outbox (M12). */
  const change = async (a: Annotation, op: "edit" | "remove", body: Record<string, unknown> = {}) => {
    const changeId = crypto.randomUUID();
    try {
      if (op === "edit") await api(`/api/annotations/${a.id}`, "PATCH", { ...body, changeId });
      else await api(`/api/annotations/${a.id}?changeId=${changeId}`, "DELETE");
    } catch (e) {
      if (!isOffline(e)) throw e;
      await addToOutbox({ id: changeId, op, annotationId: a.id, bookId: props.bookId, body, savedAt: new Date().toISOString() });
    }
  };

  /**
   * A note made offline and not sent yet: its waiting item, if any. Known
   * from the last reload without asking the device's database, so ordinary
   * saves go to the server at once.
   */
  const waitingCreate = async (id: string) =>
    madeOffline.current.has(id) ? (await outboxFor(props.bookId).catch(() => [])).find((w) => w.id === id && opOf(w) === "create") : undefined;

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
      await addToOutbox({ id, bookId: props.bookId, body, savedAt: new Date().toISOString() });
      return localAnnotation(id, body);
    }
  };

  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });

  // Send notes made offline: when the page opens, when the network returns, and every 30 s while any wait.
  useEffect(() => {
    const sync = async () => {
      await flushOutbox().catch(() => ({ sent: 0 }));
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
  }, []);

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
    const res = await fetch(`/api/books/${props.bookId}/voice-notes`, { method: "POST", body: form });
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
    if (waiting) await addToOutbox({ ...waiting, body: { ...waiting.body, body } });
    else await change(a, "edit", { body });
    await reload();
  };

  /** Removes a note: if it was made offline and never sent, it (and its edits) just leave the outbox. */
  const forget = async (a: Annotation) => {
    if (await waitingCreate(a.id)) {
      for (const w of await outboxFor(props.bookId)) if (w.id === a.id || w.annotationId === a.id) await removeFromOutbox(w.id);
    } else await change(a, "remove");
  };

  const removeNote = async (a: Annotation) => {
    await forget(a);
    if (a.kind === "highlight" && a.cfi) await view.current?.deleteAnnotation({ value: a.cfi });
    await reload();
  };

  const addBookNote = async (body: string) => {
    await create({ kind: "note", body });
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
  const highlightWord = (passageCfi: string, from: number, to: number, inPage?: [number, number]): string | null => {
    const v = view.current;
    // Not before the book is open (foliate sets its renderer last), nor in a book that failed to open.
    if (!v?.renderer) return null;
    // A PDF (M13 (e)): the word's place on its page in non-space characters,
    // in the page's text layer; its page is turned to by the player.
    if (props.fileType === "pdf") {
      const page = pdfPage(passageCfi);
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
    try {
      const start = anchor(doc).startContainer;
      const el = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
      range = el ? rangeForOffsets(el, from, to) : null;
    } catch {
      // A chapter that is still opening has an empty document for a moment: not there yet.
      return null;
    }
    if (!range) return null;
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

  const update = (patch: Partial<ReaderSettings>) => setSettings((s) => (s ? { ...s, ...patch } : s));
  const percent = Math.round(where.fraction * 100);

  return (
    <div
      ref={root}
      className={settings ? readerClass(settings) : styles.reader}
      data-testid="reader"
      data-cfi={where.cfi ?? ""}
      data-status={status}
    >
      <header className={styles.bar}>
        {/* Left, as in Kindle: leave the book, and the table of contents. */}
        <div className={styles.lead}>
          <Link href="/" className={`${styles.tool} ${styles.leadTool}`} aria-label="Back to your library" title="Back to your library">
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
          <button
            type="button"
            className={styles.tool}
            aria-pressed={Boolean(bookmarkHere)}
            aria-label={bookmarkHere ? "Remove bookmark" : "Bookmark this page"}
            onClick={() => void toggleBookmark()}
          >
            <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
              <path d="M2 1.5h10v13l-5-3.5-5 3.5z" fill={bookmarkHere ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.tool}
            aria-expanded={panel === "know" || panel === "questions"}
            aria-label="What do I need to know?"
            title="What do I need to know? Test yourself"
            onClick={() => setPanel(panel === "know" || panel === "questions" ? "none" : "know")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.75c-.5.22-.8.6-.8 1.15v.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="8" cy="11.6" r=".85" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.tool}
            aria-expanded={panel === "notes"}
            onClick={() => setPanel(panel === "notes" ? "none" : "notes")}
          >
            Notes{notes.length ? ` (${notes.length})` : ""}
          </button>
          <button
            type="button"
            className={styles.tool}
            aria-expanded={panel === "settings"}
            aria-label="Reading settings"
            onClick={() => setPanel(panel === "settings" ? "none" : "settings")}
          >
            Aa
          </button>
        </div>
      </header>

      <div className={styles.stage}>
        <button type="button" className={`${styles.turn} ${styles.turnPrev}`} aria-label="Previous page" onClick={() => turnRef.current("prev")}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M11 3 5 9l6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <div ref={host} className={styles.host} />
        <button type="button" className={`${styles.turn} ${styles.turnNext}`} aria-label="Next page" onClick={() => turnRef.current("next")}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="m7 3 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        {status === "loading" ? <p className={styles.notice}>Opening the book…</p> : null}
        {status === "error" ? (
          <p className={styles.notice} role="alert">
            This book could not be opened. Go back and try again.
          </p>
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
          <button
            type="button"
            className={styles.listenButton}
            aria-pressed={listening}
            disabled={!where.cfi}
            title="Read aloud"
            onClick={() => (listening ? stopListening() : setListening(true))}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 5h2.5L8 2v10L4.5 9H2z" fill="currentColor" />
              <path d="M10 4.5a3.5 3.5 0 0 1 0 5M11.5 3a5.5 5.5 0 0 1 0 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Listen
          </button>
          <span className={styles.percent} aria-label={`${percent}% read`}>
            {percent}%
          </span>
        </span>
      </footer>

      {selection ? (
        <SelectionBar
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
        />
      ) : null}

      {panel === "notes" ? (
        <NotesPanel
          bookId={props.bookId}
          title={props.title}
          author={props.author}
          themeEl={() => root.current}
          items={notes}
          activeId={activeId}
          onGo={(a) => {
            if (a.cfi) void view.current?.goTo(a.cfi);
          }}
          onSave={saveNote}
          onDelete={removeNote}
          onAddBookNote={addBookNote}
        />
      ) : null}

      {panel === "know" && where.cfi ? (
        <NeedToKnowPanel key={where.chapter} bookId={props.bookId} cfi={where.cfi} onQuestions={() => setPanel("questions")} />
      ) : null}
      {panel === "questions" && where.cfi ? (
        <QuestionsPanel key={where.chapter} bookId={props.bookId} cfi={where.cfi} onBack={() => setPanel("know")} />
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
                ["two", "Two pages"],
              ]}
              onChange={(pages) => update({ pages })}
            />
          </fieldset>
          {props.fileType === "pdf" ? (
            <p className={styles.hint}>This is a PDF: its pages keep their own layout, so text settings do not apply.</p>
          ) : (
            <>
          <fieldset className={styles.group}>
            <legend>Layout</legend>
            <Segment value={settings.flow} options={[["paginated", "Pages"], ["scrolled", "Scroll"]]} onChange={(flow) => update({ flow })} />
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
            </>
          )}
          <fieldset className={styles.group}>
            <legend>Theme</legend>
            <Segment
              value={settings.theme}
              options={[["auto", "Auto"], ["paper", "Paper"], ["sepia", "Sepia"], ["night", "Night"]]}
              onChange={(theme) => update({ theme })}
            />
          </fieldset>
          <p className={styles.hint}>Auto follows your device&apos;s light or dark setting. Arrow keys turn pages.</p>
          <AiStyleSetting bookId={props.bookId} />
          <p className={styles.hint}>
            STE is Simplified Technical English: one meaning per word, short sentences. It applies to &ldquo;What do I need to
            know?&rdquo; and other AI explanations; rewrites choose their own level.
          </p>
          <OfflineSetting bookId={props.bookId} fileUrl={props.fileUrl} fileType={props.fileType} />
        </section>
      ) : null}
    </div>
  );
}

function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className={styles.segment}>
      {options.map(([v, label]) => (
        <button key={v} type="button" className={styles.segmentButton} aria-pressed={value === v} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** The table of contents; the chapter being read is marked (as in Kindle). */
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
