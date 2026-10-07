import type { Metadata } from "next";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { AudiobookUpload } from "@/app/(app)/books/[id]/AudiobookUpload";
import { ImportRoot, ImportZone } from "@/components/upload/HomeImport";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { books } from "@/lib/db/schema";
import { listImports } from "@/lib/readalong/importer";
import forms from "@/components/forms.module.css";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Import" };

/**
 * Import (M14 follow-up V3a; Samuel's verdict on #90): the one place to add
 * things. Books (EPUB or PDF), dropped anywhere on the page or chosen; your
 * own audiobook for a book you have (a read-along package); and how books are
 * heard. Home's Import goes here; the Library no longer has a drop box.
 */
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ book?: string }> }) {
  const user = await requireUser();
  const db = await getDb();
  const { book } = await searchParams;
  // An audiobook goes with a book whose file is here.
  const withFile = await db
    .select({ id: books.id, title: books.title, author: books.author })
    .from(books)
    .where(and(eq(books.ownerId, user.id), isNull(books.deletedAt), isNotNull(books.fileKey)))
    .orderBy(asc(sql`lower(${books.title})`));
  const chosen = withFile.find((b) => b.id === book) ?? null;
  const imports = chosen ? await listImports(db, user.id, chosen.id) : [];

  return (
    <ImportRoot className={styles.main}>
      <header className={styles.head}>
        <h1 className={styles.title}>Import</h1>
        <p className={styles.lede}>Add your books, and your own audiobooks for them.</p>
      </header>

      <section aria-labelledby="books-h" className={styles.section}>
        <h2 id="books-h" className={styles.sectionTitle}>
          Add books
        </h2>
        <p className={styles.note}>EPUB or PDF files, free of DRM (copy protection). Several at once is fine.</p>
        <ImportZone />
      </section>

      <section aria-labelledby="audio-h" className={styles.section}>
        <h2 id="audio-h" className={styles.sectionTitle}>
          Add your audiobook to a book
        </h2>
        <p className={styles.note}>
          A read-along package made from that book&apos;s file: the audio, the script that was read, and the time of every word, so the word
          being said is lit as you listen.
        </p>
        {withFile.length ? (
          // #audio-h: after Choose, the page opens at this section (on a phone it is below the fold).
          <form method="get" action="/import#audio-h" className={styles.choose}>
            <label htmlFor="audio-book" className={forms.label}>
              Book
            </label>
            <select id="audio-book" name="book" className={`${forms.input} ${styles.select}`} defaultValue={chosen?.id ?? ""} required>
              <option value="" disabled>
                Choose one of your books
              </option>
              {withFile.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.author ? `${b.title}, by ${b.author}` : b.title}
                </option>
              ))}
            </select>
            <button type="submit" className={styles.button}>
              Choose
            </button>
          </form>
        ) : (
          <p className={styles.note}>Add a book first: an audiobook goes with a book you have.</p>
        )}
        {chosen ? (
          <div className={styles.upload}>
            <AudiobookUpload bookId={chosen.id} imports={imports} headingLevel={3} />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="heard-h" className={styles.section}>
        <h2 id="heard-h" className={styles.sectionTitle}>
          How books are heard
        </h2>
        <p className={styles.lede}>
          To hear a book, add its file first. Then an EPUB can be read aloud paragraph by paragraph by an AI voice (paid the first time each
          paragraph plays, then free), or any book, EPUB or PDF, can get your own audiobook, which plays straight through for free.
        </p>
      </section>
    </ImportRoot>
  );
}
