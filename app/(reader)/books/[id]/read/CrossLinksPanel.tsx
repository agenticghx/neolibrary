"use client";

import Link from "next/link";
import type { CrossLink } from "@/lib/library/crosslinks";
import styles from "./reader.module.css";

/** Your highlights and notes in other books that share this page's ideas (M6). */
export function CrossLinksPanel({ links }: { links: CrossLink[] }) {
  return (
    <section className={styles.panel} aria-label="Elsewhere in your library">
      <p className={styles.panelTitle}>Elsewhere in your library</p>
      <p className={styles.hint}>Your highlights and notes in other books that share ideas with this page.</p>
      {links.length ? (
        <ol className={styles.notes} data-testid="crosslinks">
          {links.map((l) => (
            <li key={l.annotationId} className={styles.noteItem}>
              <p className={styles.groupLabel}>
                {l.bookTitle}
                {l.chapter ? ` · ${l.chapter}` : ""}
              </p>
              <blockquote className={styles.noteQuote}>“{l.quote.length > 220 ? `${l.quote.slice(0, 220)}…` : l.quote}”</blockquote>
              {l.note ? <p className={styles.noteBody}>{l.note}</p> : null}
              {/* A link within the app, not a whole new page (the app's read-aloud player lives across pages). */}
              <Link className={styles.backLink} href={`/books/${l.bookId}/read?at=${encodeURIComponent(l.cfi)}`}>
                Open in {l.bookTitle}
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.hint}>Nothing on this page links to your other books yet.</p>
      )}
    </section>
  );
}
