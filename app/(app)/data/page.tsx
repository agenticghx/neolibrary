import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listRemovedAnnotations, type Kind, type RemovedAnnotation } from "@/lib/library/annotations";
import { listRemovedBooks } from "@/lib/library/remove-book";
import { restoreBookAction, restoreNoteAction } from "../actions";
import { ImportForm } from "./ImportForm";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Your data" };

const KIND_LABEL: Record<Kind, string> = {
  highlight: "Highlight",
  bookmark: "Bookmark",
  note: "Note",
  voice: "Voice note",
  sticker: "Sticker",
  drawing: "Handwritten note",
  image: "Pinned picture",
};

/** A removed note in a line: its words (the passage, the note or what was said), cut short. */
function excerpt(n: RemovedAnnotation) {
  const text = (n.body || n.quote.exact || n.voice?.transcript || "").replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function DataPage() {
  const user = await requireUser();
  // Removed notes (M19): nothing is erased (ground rule 9), so each can be brought back. Shown only when there are some.
  const removed = await listRemovedAnnotations(await getDb(), user.id, 50);
  const removedBooks = await listRemovedBooks(await getDb(), user.id);
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Your data</p>
      <h1 className={styles.title}>No lock-in</h1>
      <p className={styles.lede}>
        Everything in your library can leave with you. The file holds your books&apos; details, your paths and your
        collections; the book files themselves stay where you uploaded them.
      </p>
      <section className={`${styles.card} glass-card`} aria-labelledby="export">
        <h2 id="export" className={styles.cardTitle}>
          Take it with you
        </h2>
        <p className={styles.cardText}>A single JSON file you can keep, read or bring back later.</p>
        <a href="/api/export" className={styles.button}>
          Download your library
        </a>
      </section>
      <section className={`${styles.card} glass-card`} aria-labelledby="import">
        <h2 id="import" className={styles.cardTitle}>
          Bring it back
        </h2>
        <p className={styles.cardText}>Works into an empty library, so nothing you have is ever overwritten.</p>
        <ImportForm />
      </section>
      <section className={`${styles.card} glass-card`} aria-labelledby="agents">
        <h2 id="agents" className={styles.cardTitle}>
          Let an agent use it
        </h2>
        <p className={styles.cardText}>Tokens for AI agents, which you can revoke at any time.</p>
        <Link href="/agents" className={styles.button}>
          Agent access
        </Link>
      </section>
      {removedBooks.length ? (
        <section className={`${styles.card} glass-card`} aria-labelledby="removed-books">
          <h2 id="removed-books" className={styles.cardTitle}>
            Removed books
          </h2>
          <p className={styles.cardText}>Their files and notes are kept. Bring a book back and it returns to your shelves.</p>
          <ul className={styles.removedList} data-testid="removed-books">
            {removedBooks.map((b) => (
              <li key={b.id} className={styles.removedItem}>
                <span className={styles.removedWhat}>
                  {b.title}
                  {b.author ? <span className={styles.removedText}> · {b.author}</span> : null}
                </span>
                <span className={styles.removedMeta}>removed {day(b.removedAt)}</span>
                <form action={restoreBookAction}>
                  <input type="hidden" name="bookId" value={b.id} />
                  <button type="submit" className={styles.smallButton} aria-label={`Bring back: ${b.title}`}>
                    Bring back
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {removed.length ? (
        <section className={`${styles.card} glass-card`} aria-labelledby="removed">
          <h2 id="removed" className={styles.cardTitle}>
            Removed notes
          </h2>
          <p className={styles.cardText}>Nothing you remove is erased. Bring a note back and it returns to its page.</p>
          <ul className={styles.removedList} data-testid="removed-notes">
            {removed.map((n) => (
              <li key={n.id} className={styles.removedItem}>
                <span className={styles.removedWhat}>
                  {KIND_LABEL[n.kind]}
                  {excerpt(n) ? <span className={styles.removedText}> · {excerpt(n)}</span> : null}
                </span>
                <span className={styles.removedMeta}>
                  {n.on ? `${n.on} · ` : ""}removed {day(n.removedAt)}
                </span>
                <form action={restoreNoteAction}>
                  <input type="hidden" name="id" value={n.id} />
                  <button
                    type="submit"
                    className={styles.smallButton}
                    aria-label={`Bring back: ${KIND_LABEL[n.kind]}${excerpt(n) ? `, ${excerpt(n)}` : ""}`}
                  >
                    Bring back
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
