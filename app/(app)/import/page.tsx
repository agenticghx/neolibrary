import type { Metadata } from "next";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { AudiobookUpload } from "@/app/(app)/books/[id]/AudiobookUpload";
import { ImportRoot, ImportZone } from "@/components/upload/HomeImport";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { books } from "@/lib/db/schema";
import { mayNarrateWholeBooks, OWNER_ONLY, runningNarrations } from "@/lib/library/narration";
import { listImports } from "@/lib/readalong/importer";
import forms from "@/components/forms.module.css";
import styles from "./page.module.css";
import { WholeBookNarration } from "./WholeBookNarration";

export const metadata: Metadata = { title: "Import" };

/**
 * Import (M14 follow-up V3a; Samuel's verdict on #90): the one place to add
 * things. Books (EPUB or PDF), dropped anywhere on the page or chosen; your
 * own audiobook for a book you have (a read-along package); AI voice
 * narration for an entire EPUB, made in advance and paid up front, only when
 * chosen on purpose (V5, Samuel's decision of 2026-10-06), by the library's
 * owner only, for now (mayNarrateWholeBooks: anyone else sees one line,
 * OWNER_ONLY, instead of the form, and the page sends no request about it);
 * and how books are heard. Home's Import goes here; the Library no longer has
 * a drop box.
 */
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ book?: string }> }) {
  const user = await requireUser();
  const db = await getDb();
  const { book } = await searchParams;
  // An audiobook goes with a book whose file is here.
  const withFile = await db
    .select({ id: books.id, title: books.title, author: books.author, fileType: books.fileType })
    .from(books)
    .where(and(eq(books.ownerId, user.id), isNull(books.deletedAt), isNotNull(books.fileKey)))
    .orderBy(asc(sql`lower(${books.title})`));
  const chosen = withFile.find((b) => b.id === book) ?? null;
  const imports = chosen ? await listImports(db, user.id, chosen.id) : [];
  // Whole-book narration: the library's owner only, for now; EPUBs only (an AI voice cannot be lined up with a PDF page yet).
  const owner = mayNarrateWholeBooks(user);
  const epubs = withFile.filter((b) => b.fileType === "epub").map(({ id, title, author }) => ({ id, title, author }));
  const narrating = owner ? runningNarrations(user.id).filter((r) => epubs.some((b) => b.id === r.bookId)) : [];

  return (
    <ImportRoot className={styles.main}>
      <header className={styles.head}>
        <h1 className={styles.title}>Import</h1>
        <p className={styles.lede}>
          {owner
            ? "Add your books and your own audiobooks for them, or create AI voice narration for an entire EPUB, paid up front."
            : "Add your books and your own audiobooks for them."}
        </p>
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

      <section aria-labelledby="narrate-h" className={styles.section}>
        <h2 id="narrate-h" className={styles.sectionTitle}>
          Create AI voice narration for an entire book
        </h2>
        {owner ? (
          <>
            <p className={styles.note}>
              A separate choice, made on purpose: an AI voice reads the whole book now, paragraph by paragraph, and saves each one, so the book then
              plays for free. You pay for the whole book up front. EPUB only: an AI voice cannot be lined up with a PDF page yet. Before anything is
              made, this says how many paragraphs it is and what it costs, and nothing starts until you confirm.
            </p>
            {epubs.length ? (
              <WholeBookNarration books={epubs} running={narrating} />
            ) : (
              <p className={styles.note}>Add an EPUB first: whole-book narration is for a book you have, as an EPUB.</p>
            )}
          </>
        ) : (
          // Anyone else: one line, no form, and no request about it (the narration route refuses them too: 403).
          <p className={styles.note}>{OWNER_ONLY}</p>
        )}
      </section>

      <section aria-labelledby="heard-h" className={styles.section}>
        <h2 id="heard-h" className={styles.sectionTitle}>
          How books are heard
        </h2>
        <p className={styles.lede}>
          To hear a book, add its file first. Then an EPUB can be read aloud paragraph by paragraph by an AI voice (paid the first time each
          paragraph plays, then free), or any book, EPUB or PDF, can get your own audiobook, which plays straight through for free.
        </p>
        {owner ? (
          <p className={styles.lede}>
            An AI voice can also narrate an entire EPUB in advance, paid up front, when you choose it above under “Create AI voice narration for an
            entire book”.
          </p>
        ) : null}
      </section>
    </ImportRoot>
  );
}
