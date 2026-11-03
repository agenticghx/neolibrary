"use client";

import { createElement, useEffect, useRef, type ReactNode } from "react";
import { deepActive } from "./FigureView";
import type { TableNode, TappedTable } from "./figure";
import styles from "./reader.module.css";

/** React's names for the two cell attributes a table keeps (cleanTable in figure.ts); the rest pass as written. */
const PROP: Record<string, string> = { colspan: "colSpan", rowspan: "rowSpan" };

function draw(node: TableNode | string, key: number): ReactNode {
  if (typeof node === "string") return node;
  const props: Record<string, string | number> = { key };
  for (const [name, value] of Object.entries(node.attrs)) props[PROP[name] ?? name] = value;
  // Elements and attributes come from a fixed list (cleanTable), text is text: nothing from the book runs here.
  return createElement(node.tag, props, ...node.kids.map(draw));
}

/**
 * A table wider than its column, whole (M41): over the reader on the page's own paper, scrolled both ways, its caption
 * above it. On a phone the page's swipe turns pages, so a clipped table's far columns are read here. Escape, Close or
 * a tap beside it shuts it, and the keyboard goes back to the page, as with a figure (FigureView.tsx).
 */
export function TableView({ table, onClose }: { table: TappedTable | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (table && !d.open) {
      back.current = deepActive();
      d.showModal();
      close.current?.focus();
    } else if (!table && d.open) {
      d.close();
      const to = back.current;
      back.current = null;
      if (to?.isConnected) to.focus({ preventScroll: true });
    }
  }, [table]);

  const name = table?.caption.split(/(?<=\.)\s/)[0].replace(/\.$/, "") || "Table";
  return (
    <dialog
      ref={dialog}
      className={styles.tableView}
      aria-modal="true"
      aria-label={name}
      data-testid="table-view"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        // The reader's own keys (page turns) wait while the table is open; arrows scroll it.
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {table ? (
        <>
          <div className={styles.figureBar}>
            <button ref={close} type="button" className={`${styles.tool} ${styles.figureTool}`} onClick={onClose}>
              Close
            </button>
          </div>
          {/* Scrolls both ways; focusable, so the arrow keys move it. */}
          <div className={styles.tableWhole} tabIndex={0} role="region" aria-label={`${name}, whole`}>
            {table.caption ? <p className={styles.tableCaption}>{table.caption}</p> : null}
            {draw(table.table, 0)}
          </div>
        </>
      ) : null}
    </dialog>
  );
}
