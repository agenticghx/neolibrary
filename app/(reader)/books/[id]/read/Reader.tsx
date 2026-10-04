"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as CFI from "foliate-js/epubcfi.js";
import { Mark } from "@/components/Mark";
import type { Annotation, Color, Kind } from "@/lib/library/annotations";
import { addToOutbox, flushOutbox, isOffline, outboxFor, removeFromOutbox } from "@/lib/outbox";
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
import { rangeForOffsets } from "@/lib/reader/text-range";
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
  book: { toc?: TocItem[]; dir?: string };
  renderer: HTMLElement & { setStyles?(css: string): void; getContents(): { doc: Document; index: number }[] };
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
  r.setAttribute("max-column-count", "1");
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
}) {
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const view = useRef<FoliateView | null>(null);
  const [settings, setSettings] = useState<ReaderSettings | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [panel, setPanel] = useState<"none" | "contents" | "settings" | "notes" | "rewrite" | "know" | "questions" | "links" | "images" | "picture">("none");
  const [imagesFor, setImagesFor] = useState("");
  const [imagesAt, setImagesAt] = useState<PendingSelection | null>(null);
  const [links, setLinks] = useState<CrossLink[]>([]);
  const [listening, setListening] = useState(false);
  const tracker = useReadingTracker(props.bookId, listening);
  const trackerRef = useRef(tracker);
  useEffect(() => {
    trackerRef.current = tracker;
  });
  const whereCfi = useRef<string | null>(props.initialCfi);
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
    if (e.key === "ArrowRight" || e.key === "PageDown") void view.current?.next();
    else if (e.key === "ArrowLeft" || e.key === "PageUp") void view.current?.prev();
    else if (e.key === "Escape") setPanel("none");
  }, []);

  // Open the book once. Settings live on this device (localStorage).
  useEffect(() => {
    if (view.current) return;
    let cancelled = false;
    (async () => {
      try {
        const initial = loadSettings();
        await import("foliate-js/view.js");
        const res = await fetch(props.fileUrl);
        if (!res.ok) throw new Error(`file ${res.status}`);
        const blob = await res.blob();
        const book =
          props.fileType === "pdf"
            ? await (await import("@/lib/reader/pdf-book")).makePdfBook(blob)
            : new File([blob], "book.epub", { type: "application/epub+zip" });
        if (cancelled) return;
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
          setWhere({ cfi: d.cfi, fraction: d.fraction, chapter: d.tocItem?.label?.trim() ?? "" });
          whereCfi.current = d.cfi;
          visibleText.current = clean(d.range?.toString() ?? "");
          const label = d.tocItem?.label?.trim() ?? "";
          const chapterKey = d.tocItem?.href ?? label;
          trackerRef.current.onPage(
            CFI.collapse(d.cfi),
            visibleText.current,
            chapterKey ? { key: chapterKey, label, position: d.fraction } : undefined,
          );
          pending.current = d;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            flush();
            lookForLinks(visibleText.current);
          }, 600);
        });
        v.addEventListener("load", (e: Event) => {
          const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;
          doc.addEventListener("keydown", onKey);
          doc.addEventListener("keydown", () => trackerRef.current.onActivity());
          doc.addEventListener("pointerdown", () => trackerRef.current.onActivity());
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
        setStatus("ready");
      } catch (err) {
        console.error(err);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.bookId, props.fileUrl, props.fileType, props.initialCfi, flush, onKey, lookForLinks]);

  // Re-style when settings or the colour scheme change.
  useEffect(() => {
    if (!settings) return;
    saveSettings(settings);
    // The theme class must be on the element before colours are read from it.
    if (root.current) root.current.className = readerClass(settings);
    if (view.current && root.current) applySettings(view.current, settings, root.current);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => view.current && root.current && applySettings(view.current, settings, root.current);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
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
    const base = server ?? notesRef.current.filter((a) => !a.pending);
    const known = new Set(base.map((a) => a.id));
    setAll([...base, ...waiting.filter((w) => !known.has(w.id)).map((w) => localAnnotation(w.id, w.body, w.savedAt))]);
  };

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
    await api(`/api/annotations/${a.id}`, "PATCH", { body });
    await reload();
  };

  const removeNote = async (a: Annotation) => {
    // Not sent yet: it only exists on this device.
    if (a.pending) await removeFromOutbox(a.id);
    else await api(`/api/annotations/${a.id}`, "DELETE");
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
    if (bookmarkHere?.pending) await removeFromOutbox(bookmarkHere.id);
    else if (bookmarkHere) await api(`/api/annotations/${bookmarkHere.id}`, "DELETE");
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
  const highlightWord = (passageCfi: string, from: number, to: number): string | null => {
    const v = view.current;
    if (!v) return null;
    const { index, anchor } = v.resolveCFI(passageCfi);
    const doc = v.renderer.getContents().find((c) => c.index === index)?.doc;
    if (!doc) return null;
    const start = anchor(doc).startContainer;
    const el = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
    const range = el ? rangeForOffsets(el, from, to) : null;
    if (!range) return null;
    const win = doc.defaultView as (Window & { CSS: typeof CSS; Highlight: typeof Highlight }) | null;
    win?.CSS.highlights?.set("nl-spoken", new win.Highlight(range));
    const visible = whereCfi.current;
    if (visible && CFI.compare(v.getCFI(index, range), CFI.collapse(visible, true)) > 0) void v.next();
    return range.toString();
  };

  const showPassage = (passageCfi: string) => {
    const v = view.current;
    const visible = whereCfi.current;
    if (!v) return;
    if (!visible || CFI.compare(passageCfi, CFI.collapse(visible)) < 0 || CFI.compare(passageCfi, CFI.collapse(visible, true)) > 0) void v.goTo(passageCfi);
  };

  const stopListening = () => {
    for (const { doc } of view.current?.renderer.getContents() ?? []) {
      (doc.defaultView as (Window & { CSS: typeof CSS }) | null)?.CSS.highlights?.delete("nl-spoken");
    }
    setListening(false);
  };

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
        <Link href={`/books/${props.bookId}`} className={styles.brand} aria-label="Back to the book page">
          <Mark size={22} />
        </Link>
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
            aria-expanded={panel === "contents"}
            onClick={() => setPanel(panel === "contents" ? "none" : "contents")}
          >
            Contents
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
        <button type="button" className={`${styles.turn} ${styles.turnPrev}`} aria-label="Previous page" onClick={() => void view.current?.prev()}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M11 3 5 9l6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <div ref={host} className={styles.host} />
        <button type="button" className={`${styles.turn} ${styles.turnNext}`} aria-label="Next page" onClick={() => void view.current?.next()}>
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
            disabled={!where.cfi || props.fileType === "pdf"}
            title={props.fileType === "pdf" ? "Reading aloud works for EPUB books" : "Read aloud"}
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

      {listening && where.cfi ? (
        <ListenBar bookId={props.bookId} startCfi={where.cfi} onWord={highlightWord} onPassage={showPassage} onClose={stopListening} />
      ) : null}

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
        <nav className={styles.panel} aria-label="Contents">
          <p className={styles.panelTitle}>Contents</p>
          <TocList
            items={toc}
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
          {props.fileType === "epub" ? <OfflineSetting bookId={props.bookId} fileUrl={props.fileUrl} /> : null}
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

function TocList({ items, onPick }: { items: TocItem[]; onPick: (href: string) => void }) {
  if (!items.length) return <p className={styles.hint}>This book has no table of contents.</p>;
  return (
    <ol className={styles.toc}>
      {items.map((t, i) => (
        <li key={`${t.href}-${i}`}>
          <button type="button" className={styles.tocItem} onClick={() => onPick(t.href)}>
            {t.label.trim()}
          </button>
          {t.subitems?.length ? <TocList items={t.subitems} onPick={onPick} /> : null}
        </li>
      ))}
    </ol>
  );
}
