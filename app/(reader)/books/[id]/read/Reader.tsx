"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mark } from "@/components/Mark";
import { bookCss, loadSettings, saveSettings, SIZES, type ReaderSettings } from "./settings";
import styles from "./reader.module.css";

type TocItem = { label: string; href: string; subitems?: TocItem[] };
type FoliateView = HTMLElement & {
  open(file: File): Promise<void>;
  init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number): Promise<void>;
  prev(): Promise<void>;
  next(): Promise<void>;
  close(): void;
  book: { toc?: TocItem[]; dir?: string };
  renderer: HTMLElement & { setStyles?(css: string): void };
};
type Relocate = { cfi: string; fraction: number; tocItem?: { label?: string } };

const TOKENS = { paper: "--paper", ink: "--ink-900", accent: "--accent", highlight: "--highlight" } as const;

function applySettings(v: FoliateView, s: ReaderSettings) {
  const r = v.renderer;
  r.setAttribute("flow", s.flow);
  r.setAttribute("max-inline-size", "680px");
  r.setAttribute("max-column-count", "1");
  r.setAttribute("margin", "40px");
  r.setAttribute("gap", "7%");
  r.setStyles?.(bookCss(s, themeColors(), location.origin));
}

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const colors: Record<string, string> = Object.fromEntries(
    Object.entries(TOKENS).map(([k, v]) => [k, cs.getPropertyValue(v).trim()]),
  );
  colors.scheme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return colors;
}

export function Reader(props: {
  bookId: string;
  title: string;
  author: string;
  fileUrl: string;
  initialCfi: string | null;
  initialFraction: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<FoliateView | null>(null);
  const [settings, setSettings] = useState<ReaderSettings | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [panel, setPanel] = useState<"none" | "contents" | "settings">("none");
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
        const file = new File([await res.blob()], "book.epub", { type: "application/epub+zip" });
        if (cancelled) return;
        const v = document.createElement("foliate-view") as FoliateView;
        v.className = styles.view;
        host.current!.append(v);
        view.current = v;
        await v.open(file);
        applySettings(v, initial);
        setSettings(initial);
        v.addEventListener("relocate", (e: Event) => {
          const d = (e as CustomEvent<Relocate>).detail;
          setWhere({ cfi: d.cfi, fraction: d.fraction, chapter: d.tocItem?.label?.trim() ?? "" });
          pending.current = d;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => flush(), 600);
        });
        v.addEventListener("load", (e: Event) => {
          const doc = (e as CustomEvent<{ doc: Document }>).detail.doc;
          doc.addEventListener("keydown", onKey);
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
  }, [props.fileUrl, props.initialCfi, flush, onKey]);

  // Re-style when settings or the colour scheme change.
  useEffect(() => {
    if (!settings) return;
    saveSettings(settings);
    if (view.current) applySettings(view.current, settings);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => view.current && applySettings(view.current, settings);
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

  const update = (patch: Partial<ReaderSettings>) => setSettings((s) => (s ? { ...s, ...patch } : s));
  const percent = Math.round(where.fraction * 100);

  return (
    <div className={styles.reader} data-testid="reader" data-cfi={where.cfi ?? ""} data-status={status}>
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
          <p className={styles.hint}>Light or dark follows your device. Arrow keys turn pages.</p>
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
