import Link from "next/link";
import { Cover } from "@/components/Cover";
import type { Annotation } from "@/lib/library/annotations";
import type { LibraryItem } from "@/lib/library/home";
import styles from "./Home.module.css";

const MAX = 220;
const clip = (s: string) => (s.length > MAX ? `${s.slice(0, MAX).trimEnd()}…` : s);

/** What the box on the card says: the reader's own words, or the highlighted passage. */
export function noteShown(note: Annotation): { label: string; text: string; highlight: boolean } {
  if (note.kind === "highlight") return { label: "Your last highlight here", text: clip(note.quote.exact), highlight: true };
  const words = note.kind === "voice" ? note.voice?.transcript || "A voice note" : note.body;
  return { label: "Your last note here", text: clip(words), highlight: false };
}

/**
 * Continue (Samuel's pick B): the book, where you are, your last note or
 * highlight in it, and Read from here / Listen from here (D7). Listen opens the
 * reader with the Read aloud bar; step 6 makes it play on Home instead.
 */
export function ContinueCard({ item, chapter, note }: { item: LibraryItem; chapter: string | null; note: Annotation | null }) {
  const shown = note ? noteShown(note) : null;
  const pct = Math.round(item.progress * 100);
  const titleId = `continue-${item.id}`;
  return (
    <article className={styles.card} aria-labelledby={titleId} data-testid="continue-card">
      <div className={styles.cardCover}>
        <Cover title={item.title} available={item.available} caption={false} decorative size="mini" imageUrl={item.coverUrl} />
      </div>
      <div className={styles.cardHead}>
        <h3 id={titleId} className={styles.cardTitle}>
          {item.title}
        </h3>
        <p className={styles.cardWhere}>
          <span>
            {chapter ? `${chapter} · ` : ""}
            {pct}%
          </span>
          <span className={styles.cardBar} aria-hidden="true">
            <span className={styles.cardFill} data-progress={Math.round(item.progress * 20) * 5} />
          </span>
        </p>
      </div>
      {shown ? (
        <div className={styles.note}>
          <span className={styles.noteLabel}>{shown.label}</span>
          <p className={shown.highlight ? styles.noteQuote : styles.noteWords}>
            {shown.highlight ? <mark className={styles.noteMark}>{shown.text}</mark> : shown.text}
          </p>
        </div>
      ) : null}
      <div className={styles.cardActions}>
          <Link href={`/books/${item.id}/read`} className={styles.primary}>
            Read from here
          </Link>
          {item.available.listen ? (
            <Link href={`/books/${item.id}/read?listen=1`} className={styles.secondary}>
              <svg className={styles.listenIcon} width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                <path d="M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H5a1 1 0 0 1-1-1zM20 15h-3v5h2a1 1 0 0 0 1-1z" />
              </svg>
              Listen from here
            </Link>
          ) : null}
      </div>
    </article>
  );
}
