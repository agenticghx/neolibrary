import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Cover } from "@/components/Cover";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { coverSigner } from "@/lib/library/covers";
import { getBook } from "@/lib/library/paths";
import { NotesExport, NotesImport } from "@/components/NotesExport";
import { listAnnotations } from "@/lib/library/annotations";
import { availabilityLabel } from "@/lib/library/availability";
import { needsReread } from "@/lib/library/questions";
import { collectionsForBook } from "@/lib/library/shelf";
import { listImports } from "@/lib/readalong/importer";
import { AudiobookUpload } from "./AudiobookUpload";
import { toggleCollectionAction } from "../../actions";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Book" };
export const dynamic = "force-dynamic";

const KIND = { N: "narrative, read first", E: "engineering & economics, read second", extra: "extra", master: "master key, read last" };

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const found = await getBook(await getDb(), user.id, (await params).id);
  if (!found) notFound();
  const { book, available, places } = found;
  // Most of this page needs the book file (its chapters, collections, questions, audiobooks).
  const hasFile = available.read;
  const inCollections = hasFile ? await collectionsForBook(await getDb(), user.id, book.id) : [];
  const marks = await listAnnotations(await getDb(), user.id, book.id);
  const reread = hasFile ? await needsReread(await getDb(), user.id, book.id) : [];
  // M13: uploaded read-along audiobooks, only for a book whose file is here.
  const audiobooks = hasFile && book.fileType ? await listImports(await getDb(), user.id, book.id) : [];
  const count = (k: string) => marks.filter((a) => a.kind === k).length;
  const firstKind = places[0]?.kind;

  return (
    <main className={styles.main}>
      <Link href="/" className={styles.back}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className={styles.backIcon}>
          <path d="M9 2 4 7l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        Path
      </Link>
      <div className={styles.layout}>
        <Cover
          title={book.title}
          slot={firstKind}
          tone={firstKind === "E" ? "green" : "navy"}
          available={available}
          caption={false}
          progress={book.progress}
          imageUrl={(await coverSigner())(book.coverKey)}
        />
        <div className={styles.info}>
          <h1 className={styles.title}>{book.title}</h1>
          {book.author ? <p className={styles.author}>{book.author}</p> : null}
          {hasFile && book.fileType ? (
            <Link href={`/books/${book.id}/read`} className={styles.read}>
              {book.progress > 0 ? "Continue reading" : "Read"}
            </Link>
          ) : null}
          {places.length ? (
            <ul className={styles.places}>
              {places.map((p) => (
                <li key={`${p.pathSlug}-${p.pillarSlug}-${p.kind}`}>
                  {p.path} › {p.pillar} · <span className={styles.kind}>{KIND[p.kind]}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {book.note ? <p className={styles.note}>{book.note}</p> : null}
          {hasFile ? (
            <p className={styles.meta}>
              {book.fileType?.toUpperCase()}
              {book.pageCount ? ` · ${book.pageCount} pages` : ""}
              {book.toc.length ? ` · ${book.toc.length} chapters` : ""}
              {book.publisher ? ` · ${book.publisher}` : ""}
            </p>
          ) : null}
          {hasFile && book.description ? <p className={styles.description}>{book.description}</p> : null}
          {hasFile && book.toc.length ? (
            <details className={styles.toc}>
              <summary>Contents</summary>
              <ol>
                {book.toc.map((t, i) => (
                  <li key={`${t.href}-${i}`}>{t.label}</li>
                ))}
              </ol>
            </details>
          ) : null}
          {book.unverified ? (
            <p className={styles.unverified}>
              Suggested by an agent and not checked against a catalog. Confirm the title, author and edition before
              buying.
            </p>
          ) : null}
          {inCollections.length ? (
            <div className={styles.collections}>
              <p className={styles.collectionsTitle}>Collections</p>
              <ul>
                {inCollections.map((c) => (
                  <li key={c.id}>
                    <form action={toggleCollectionAction}>
                      <input type="hidden" name="bookId" value={book.id} />
                      <input type="hidden" name="collectionId" value={c.id} />
                      <input type="hidden" name="inside" value={c.inside ? "0" : "1"} />
                      <button type="submit" className={styles.collection} aria-pressed={c.inside}>
                        {c.name}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {hasFile || marks.length ? (
            <section className={styles.notes} aria-labelledby="your-notes">
              <h2 id="your-notes" className={styles.collectionsTitle}>
                Your notes
              </h2>
              <p className={styles.notesSummary}>
                {marks.length
                  ? `${count("highlight")} highlights · ${count("note")} notes on the book · ${count("bookmark")} bookmarks`
                  : "Nothing yet. Highlights and notes you make while reading appear here."}
              </p>
              {marks.length ? <NotesExport bookId={book.id} title={book.title} /> : null}
              <NotesImport bookId={book.id} />
            </section>
          ) : null}
          {reread.length ? (
            <section className={styles.notes} aria-labelledby="reread">
              <h2 id="reread" className={styles.collectionsTitle}>
                Needs a re-read
              </h2>
              <p className={styles.notesSummary}>Chapters where you marked a question-bank answer wrong.</p>
              <ul className={styles.reread}>
                {reread.map((c) => (
                  <li key={c.id}>
                    <Link href={`/books/${book.id}/read?at=${encodeURIComponent(c.cfi)}`}>{c.label}</Link>
                    <span className={styles.rereadCount}>
                      {" "}
                      · {c.wrong} of {c.marked} wrong
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {hasFile && book.fileType ? <AudiobookUpload bookId={book.id} imports={audiobooks} /> : null}
          <p className={styles.status}>
            <span className={styles.available}>{availabilityLabel(available)}</span>
            {hasFile
              ? ` · ${Math.round(book.progress * 100)}% read`
              : ". Add the book file (EPUB or PDF) and it attaches here."}
          </p>
        </div>
      </div>
    </main>
  );
}
