import Link from "next/link";
import { Cover } from "@/components/Cover";
import { availabilityLabel } from "@/lib/library/availability";
import type { LibraryItem } from "@/lib/library/home";
import styles from "./Library.module.css";

export const progressLabel = (p: number) => (p >= 1 ? "Finished" : p > 0 ? `${Math.round(p * 100)}% read` : "Unread");

/** Progress in steps of 5% for the CSS (inline styles would bypass the design tokens). */
const step = (p: number) => Math.round(Math.min(1, Math.max(0, p)) * 20) * 5;

/** The library as covers: each with its marks, title, author, what is available and how far you are (Samuel's pick, Home A). */
export function LibraryGrid({ items, testId = "shelf" }: { items: LibraryItem[]; testId?: string }) {
  return (
    <ul className={styles.grid} data-testid={testId}>
      {items.map((b) => (
        <li key={b.id}>
          <Link href={`/books/${b.id}`} className={styles.item}>
            <Cover
              title={b.title}
              available={b.available}
              caption={false}
              size="fill"
              imageUrl={b.coverUrl}
              marks={{ notes: b.notes, audiobook: b.audiobook, finished: b.progress >= 1 }}
            />
            <span className={styles.itemTitle}>{b.title}</span>
            {b.author ? <span className={styles.itemAuthor}>{b.author}</span> : null}
            <span className={styles.itemAvailable}>{availabilityLabel(b.available)}</span>
            {b.available.read || b.available.listen ? (
              <span className={styles.itemProgress}>
                {progressLabel(b.progress)}
                <span className={styles.bar} aria-hidden="true">
                  <span className={styles.fill} data-progress={step(b.progress)} />
                </span>
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A stable number from a book's id, so each spine keeps its height between visits. */
const hash = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** The spine's width (1 to 5) follows the book's length; an unknown length gets the middle width. */
export function spineWidth(pageCount: number | null): 1 | 2 | 3 | 4 | 5 {
  if (!pageCount) return 3;
  return pageCount < 150 ? 1 : pageCount < 300 ? 2 : pageCount < 450 ? 3 : pageCount < 650 ? 4 : 5;
}

const spineFoot = (b: LibraryItem) => (!b.available.read && !b.available.listen ? "" : b.progress >= 1 ? "Done" : b.progress > 0 ? `${Math.round(b.progress * 100)}%` : "New");

/** The library as spines standing on shelves, each filling from the bottom as you read (Samuel's pick: the View switch). */
export function LibrarySpines({ items }: { items: LibraryItem[] }) {
  return (
    <ul className={styles.spines} data-testid="spines">
      {items.map((b) => {
        const any = b.available.read || b.available.listen;
        return (
          <li key={b.id} className={styles.spineSlot}>
            <Link
              href={`/books/${b.id}`}
              className={[styles.spine, any ? (hash(b.id) % 2 ? styles.navy : styles.green) : styles.emptySpine].join(" ")}
              data-w={spineWidth(b.pageCount)}
              data-h={hash(b.id) % 8}
              aria-label={`${b.title}, ${any ? progressLabel(b.progress).toLowerCase() : "not available yet"}`}
            >
              <span className={styles.spineFill} data-progress={step(b.progress)} aria-hidden="true" />
              <span className={styles.spineTitle} aria-hidden="true">
                {b.title}
              </span>
              <span className={styles.spineFoot} aria-hidden="true">
                {spineFoot(b)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Titles with nothing to read or listen to yet, in one closed group at the end (D3: they must not flood the grid). */
export function NotYetGroup({ items }: { items: LibraryItem[] }) {
  if (!items.length) return null;
  return (
    <details className={styles.notYet}>
      <summary className={styles.notYetSummary}>Not available yet ({items.length})</summary>
      <p className={styles.notYetNote}>Titles waiting on your Paths. Add a book file and the title takes its colour.</p>
      <LibraryGrid items={items} testId="not-yet" />
    </details>
  );
}
