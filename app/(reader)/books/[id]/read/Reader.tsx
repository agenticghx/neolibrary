"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as CFI from "foliate-js/epubcfi.js";
import { Mark } from "@/components/Mark";
import type { Annotation, Color } from "@/lib/library/annotations";
import { NotesPanel } from "./NotesPanel";
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
  renderer: HTMLElement & { setStyles?(css: string): void };
  getCFI(index: number, range: Range): string;
  addAnnotation(a: { value: string }): Promise<unknown>;
  deleteAnnotation(a: { value: string }): Promise<unknown>;
};
type Relocate = { cfi: string; fraction: number; tocItem?: { label?: string }; range?: Range };
type DrawFn = (rects: unknown, opts?: unknown) => SVGElement;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

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

const TOKENS = { paper: "--paper", ink: "--ink-900", accent: "--accent", highlight: "--highlight" } as const;

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
  const [panel, setPanel] = useState<"none" | "contents" | "settings" | "notes">("none");
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
        v.addEventListener("create-overlay", () => {
          for (const a of notesRef.current) if (a.kind === "highlight" && a.cfi) void v.addAnnotation({ value: a.cfi });
        });
        v.addEventListener("draw-annotation", (e: Event) => {
          const { draw, annotation } = (e as CustomEvent<{ draw: (f: DrawFn, o: unknown) => void; annotation: { value: string } }>).detail;
          const a = notesRef.current.find((x) => x.cfi === annotation.value);
          const color = getComputedStyle(root.current!).getPropertyValue(`--mark-${a?.color ?? "sage"}`).trim();
          draw(Overlayer.highlight, { color });
        });
        v.addEventListener("show-annotation", (e: Event) => {
          const a = notesRef.current.find((x) => x.cfi === (e as CustomEvent<{ value: string }>).detail.value);
          if (a) {
            setActiveId(a.id);
            setPanel("notes");
          }
        });
        root.current!.className = readerClass(initial);
        applySettings(v, initial, root.current!);
        setSettings(initial);
        v.addEventListener("relocate", (e: Event) => {
          const d = (e as CustomEvent<Relocate>).detail;
          setWhere({ cfi: d.cfi, fraction: d.fraction, chapter: d.tocItem?.label?.trim() ?? "" });
          visibleText.current = clean(d.range?.toString() ?? "");
          pending.current = d;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => flush(), 600);
        });
        v.addEventListener("load", (e: Event) => {
          const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;
          doc.addEventListener("keydown", onKey);
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
  }, [props.bookId, props.fileUrl, props.fileType, props.initialCfi, flush, onKey]);

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

  const reload = async () => setAll((await api(`/api/books/${props.bookId}/annotations`, "GET")).annotations);

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
    const a: Annotation = await api(`/api/books/${props.bookId}/annotations`, "POST", {
      kind: "highlight",
      cfi: picked.cfi,
      quote: { exact: picked.exact, prefix: picked.prefix, suffix: picked.suffix },
      color,
      body,
    });
    await reload();
    await view.current?.addAnnotation({ value: a.cfi! });
  };

  const saveNote = async (a: Annotation, body: string) => {
    await api(`/api/annotations/${a.id}`, "PATCH", { body });
    await reload();
  };

  const removeNote = async (a: Annotation) => {
    await api(`/api/annotations/${a.id}`, "DELETE");
    if (a.kind === "highlight" && a.cfi) await view.current?.deleteAnnotation({ value: a.cfi });
    await reload();
  };

  const addBookNote = async (body: string) => {
    await api(`/api/books/${props.bookId}/annotations`, "POST", { kind: "note", body });
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
    if (bookmarkHere) await api(`/api/annotations/${bookmarkHere.id}`, "DELETE");
    else
      await api(`/api/books/${props.bookId}/annotations`, "POST", {
        kind: "bookmark",
        cfi: CFI.collapse(where.cfi),
        quote: { exact: visibleText.current.slice(0, 160) || where.chapter },
      });
    await reload();
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
        <span className={styles.chapter}>{where.chapter}</span>
        <span className={styles.progress} aria-hidden="true">
          <span className={styles.progressFill} data-progress={Math.round(where.fraction * 50) * 2} />
        </span>
        <span className={styles.percent} aria-label={`${percent}% read`}>
          {percent}%
        </span>
      </footer>

      {selection ? (
        <SelectionBar selection={selection} title={props.title} author={props.author} onHighlight={highlight} onClose={clearSelection} />
      ) : null}

      {panel === "notes" ? (
        <NotesPanel
          bookId={props.bookId}
          title={props.title}
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
