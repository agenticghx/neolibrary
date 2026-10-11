"use client";

import { useEffect, useRef } from "react";
import styles from "./reader.module.css";

/**
 * The reader's keyboard shortcuts (M21): only keys the reader really answers to. Reader.tsx's onKey handles the
 * page turns, Escape and "?" (in the page around the book and inside the book's own frames); StudyTabs.tsx moves
 * between Study's two tabs with the arrow keys. Change this list when those change.
 */
export const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ["Right arrow", "Page Down"], what: "Next page" },
  { keys: ["Left arrow", "Page Up"], what: "Previous page" },
  { keys: ["Esc"], what: "Close the open panel, or this list" },
  { keys: ["?"], what: "Show this list" },
  { keys: ["Left arrow", "Right arrow"], what: "In Study, move between Need to know and Test yourself" },
];

/** The arrow keys are drawn (the bundled fonts have no arrow characters), and named for screen readers. */
const ARROWS: Record<string, string> = { "Right arrow": "M1 5h11M8.5 1.5 12 5 8.5 8.5", "Left arrow": "M13 5H2M5.5 1.5 2 5l3.5 3.5" };

function Key({ name }: { name: string }) {
  const arrow = ARROWS[name];
  if (!arrow) return <kbd className={styles.kbd}>{name}</kbd>;
  return (
    <kbd className={styles.kbd}>
      <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
        <path d={arrow} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="visually-hidden">{name}</span>
    </kbd>
  );
}

/** The element that has the keyboard, looking inside the book viewer (its frames sit in shadow roots). */
function deepActive(): HTMLElement | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

/**
 * A modal dialog: the rest of the reader cannot be reached while it is open, the keyboard stays inside it (Tab and
 * Shift+Tab go round), Escape or Close shuts it, and the keyboard goes back to where it was (a button, the
 * Keyboard shortcuts link, or the book's page).
 */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      back.current = deepActive();
      d.showModal();
      close.current?.focus();
    } else if (!open && d.open) {
      d.close();
      const to = back.current;
      back.current = null;
      if (to?.isConnected) to.focus({ preventScroll: true });
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={styles.shortcuts}
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      // The browser's own close request (Escape, a phone's back gesture): closed through React, so focus goes back.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        // The reader's own keys (page turns, Escape for panels) wait while the list is open.
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
          return;
        }
        if (e.key !== "Tab") return;
        const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])"));
        const first = items[0];
        const last = items.at(-1);
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      <div className={styles.shortcutsHead}>
        <h2 id="shortcuts-title" className={styles.panelTitle}>
          Keyboard shortcuts
        </h2>
        <button ref={close} type="button" className={styles.tool} onClick={onClose}>
          Close
        </button>
      </div>
      <dl className={styles.shortcutList}>
        {SHORTCUTS.map(({ keys, what }) => (
          <div key={what} className={styles.shortcutRow}>
            <dt>
              {keys.map((k, i) => (
                <span key={k}>
                  {i > 0 ? <span className={styles.shortcutOr}> or </span> : null}
                  <Key name={k} />
                </span>
              ))}
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.hint}>The keys do nothing while you type in a box, such as Find in this book.</p>
    </dialog>
  );
}
