"use client";

// The reader's small controls, moved out of Reader.tsx unchanged (2026-11-10, the Reader split): a segmented
// choice, "go to page", the table of contents, and the Scan | Text switch. Each takes only what it is handed.
import { useState } from "react";
import styles from "./reader.module.css";

export type TocItem = { label: string; href: string; subitems?: TocItem[] };

export function Segment<T extends string>({
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
export function JumpTo({ pages, current, onGo }: { pages: number; current: number; onGo: (n: number) => void }) {
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

export function TocList({ items, onPick, current }: { items: TocItem[]; onPick: (href: string) => void; current: string }) {
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
export function EditionSwitch({ edition, scanPage }: { edition: { scanId: string; textId: string; current: "scan" | "text" }; scanPage: number | null }) {
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
