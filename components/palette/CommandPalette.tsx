"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/shell/icons";
import type { PaletteData } from "@/lib/palette/data";
import { buildItems, results, type PaletteItem } from "@/lib/palette/items";
import styles from "./CommandPalette.module.css";

/** Cmd+K on a Mac, Ctrl+K elsewhere; no Shift or Alt (the reader's own keys never use Cmd or Ctrl). */
const isPaletteKey = (e: KeyboardEvent) => e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;

/** The reader's book view (foliate-js): its pages are frames, listed by its renderer. */
type FoliateView = Element & { renderer?: { getContents?(): { doc: Document }[] } };

/** How to put focus back where it was: on the page, or inside the book's own page (a frame) in the reader. */
function focusBack(frame?: Document): () => void {
  if (frame) {
    const win = frame.defaultView;
    const el = frame.activeElement as HTMLElement | null;
    return () => {
      win?.focus();
      el?.focus?.({ preventScroll: true });
    };
  }
  const el = document.activeElement;
  return () => {
    if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
  };
}

const SERIF: PaletteItem["kind"][] = ["book", "read", "path", "pillar", "note"];

/**
 * The command palette (M21): Cmd+K or Ctrl+K anywhere in the signed-in app, the reader included, opens a box
 * that jumps to a book, a Path or one of its sections, a page, or a recent note, or searches the library.
 *
 * Accessibility: a modal <dialog> (the page behind is inert), an ARIA combobox (the text box) that controls a
 * listbox; the highlighted row is announced through aria-activedescendant, so focus never leaves the box, and a
 * status line says how many results there are. Escape closes it and puts focus back where it was.
 */
export function CommandPalette({ admin }: { admin: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [data, setData] = useState<PaletteData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnTo = useRef<(() => void) | null>(null);
  const openRef = useRef(false);
  const router = useRouter();
  const pathname = usePathname();
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  const items = useMemo(() => buildItems(data, admin), [data, admin]);
  const shown = useMemo(() => results(items, data, query), [items, data, query]);

  const close = useCallback((restoreFocus: boolean) => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    dialog.current?.close();
    const back = returnTo.current;
    returnTo.current = null;
    if (restoreFocus) back?.();
  }, []);

  /** `from`: the book's own page (a frame in the reader), when the keys were pressed there. */
  const show = useCallback((from?: Document) => {
    if (openRef.current) return;
    openRef.current = true;
    returnTo.current = focusBack(from);
    setQuery("");
    setActive(0);
    setOpen(true);
    dialog.current?.showModal();
    input.current?.focus();
    // Fresh each time it opens (a note made a minute ago is there); the last answer shows meanwhile.
    setLoading(true);
    fetch("/api/palette", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<PaletteData>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setData(d);
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  // The shortcut, on the page and inside the reader's book. The book's pages are frames from this site inside
  // the reader's foliate-view (a closed shadow root, so they cannot be reached from the page): a click in the
  // book puts focus in a frame, and keys pressed there never reach this window. So each frame is listened to as
  // foliate announces it ("load", caught on its way down to the foliate-view), and any already open on a blur.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteKey(e)) return;
      e.preventDefault();
      const target = e.target as Node | null;
      const doc = target && "ownerDocument" in target ? (target.ownerDocument ?? (target as Document)) : null;
      if (openRef.current) close(true);
      else show(doc && doc !== document ? doc : undefined);
    };
    const frames = new WeakSet<Document>();
    const listen = (doc: unknown) => {
      if (!doc || typeof (doc as Document).addEventListener !== "function" || frames.has(doc as Document)) return;
      frames.add(doc as Document);
      (doc as Document).addEventListener("keydown", onKey);
    };
    const onLoad = (e: Event) => listen((e as CustomEvent<{ doc?: Document } | null>).detail?.doc);
    const onBlur = () => {
      for (const view of document.querySelectorAll("foliate-view")) {
        for (const { doc } of (view as FoliateView).renderer?.getContents?.() ?? []) listen(doc);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("load", onLoad, true);
    window.addEventListener("blur", onBlur);
    onBlur();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("load", onLoad, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [close, show]);

  // A new page (the browser's Back, say) closes it.
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    if (open) setOpen(false);
  }
  useEffect(() => {
    if (!open && openRef.current) close(false);
  }, [open, close]);

  // Keep the highlighted row in view.
  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId is derived from id, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  const go = (item: PaletteItem | undefined, read = false) => {
    if (!item) return;
    // Shift+Enter on a book opens it in the reader, when it has a file.
    const target = read && item.kind === "book" ? (items.find((i) => i.key === `read:${item.key.slice(5)}`) ?? item) : item;
    close(false);
    router.push(target.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const last = shown.length - 1;
    if (e.key === "ArrowDown") setActive((a) => (a >= last ? 0 : a + 1));
    else if (e.key === "ArrowUp") setActive((a) => (a <= 0 ? last : a - 1));
    else if (e.key === "Home" && e.ctrlKey) setActive(0);
    else if (e.key === "End" && e.ctrlKey) setActive(last);
    else if (e.key === "PageDown") setActive((a) => Math.min(last, a + 8));
    else if (e.key === "PageUp") setActive((a) => Math.max(0, a - 8));
    else if (e.key === "Enter") go(shown[active], e.shiftKey);
    else if (e.key === "Escape") {
      // Handled here, before the dialog's own cancel, the reader's keys and the account menu's.
      e.stopPropagation();
      close(true);
    } else return;
    e.preventDefault();
  };

  // Focus stays inside: Tab moves between the box and Close, and wraps.
  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== "Tab") return;
    const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>("input, button") ?? [])];
    const at = focusable.indexOf(document.activeElement as HTMLElement);
    const next = focusable[(at + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length];
    e.preventDefault();
    next?.focus();
  };

  const count = shown.filter((i) => i.kind !== "search").length;
  const status = !open
    ? ""
    : `${count === 0 ? "No matches" : `${count} ${count === 1 ? "result" : "results"}`}${query.trim() ? ", and Search the library" : ""}.${
        loading && !data ? " Loading your books." : failed && !data ? " Your books could not be loaded; pages only." : ""
      }`;
  const current = shown[Math.min(active, shown.length - 1)];

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      onKeyDown={onDialogKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        close(true);
      }}
      // The close event comes a moment after the dialog closes: if Cmd+K opened it again meanwhile, it is stale.
      onClose={() => {
        if (!dialog.current?.open) close(false);
      }}
      // A click on the dimmed page around the panel closes it.
      onClick={(e) => {
        if (e.target === e.currentTarget) close(true);
      }}
      data-testid="command-palette"
    >
      <div className={`${styles.panel} glass-card`}>
        <h2 id={`${id}-title`} className="visually-hidden">
          Go to
        </h2>
        <div className={styles.field}>
          <Icon name="search" className={styles.icon} />
          <label htmlFor={`${id}-input`} className="visually-hidden">
            Go to a book, path, page or note
          </label>
          <input
            ref={input}
            id={`${id}-input`}
            className={styles.input}
            type="text"
            role="combobox"
            aria-expanded={open && shown.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && current ? optionId(Math.min(active, shown.length - 1)) : undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Go to a book, path, page or note…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <button type="button" className={styles.close} onClick={() => close(true)}>
            Close
          </button>
        </div>
        <ul id={listId} role="listbox" aria-label={query.trim() ? "Results" : "Suggestions"} className={styles.list}>
          {open
            ? shown.map((item, i) => (
                <li
                  key={item.key}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={styles.option}
                  // Keep focus in the box: a click picks the row, it does not take focus.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={(e) => go(item, e.shiftKey)}
                >
                  <span className={styles.text}>
                    <span
                      className={[styles.label, SERIF.includes(item.kind) ? styles.serif : "", item.kind === "note" ? styles.note : ""].join(" ")}
                    >
                      {item.label}
                    </span>
                    {item.detail ? <span className={styles.detail}>{item.detail}</span> : null}
                  </span>
                  <span className={styles.tag}>{item.tag}</span>
                </li>
              ))
            : null}
        </ul>
        <p role="status" className="visually-hidden">
          {status}
        </p>
        <p className={styles.foot} aria-hidden="true">
          <span>
            <kbd className={styles.kbd}>↑</kbd> <kbd className={styles.kbd}>↓</kbd> move
          </span>
          <span>
            <kbd className={styles.kbd}>Enter</kbd> open
          </span>
          <span>
            <kbd className={styles.kbd}>Shift</kbd> <kbd className={styles.kbd}>Enter</kbd> read a book
          </span>
          <span>
            <kbd className={styles.kbd}>Esc</kbd> close
          </span>
        </p>
      </div>
    </dialog>
  );
}
