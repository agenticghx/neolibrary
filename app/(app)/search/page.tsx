import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { searchLibrary, searchNotes, type SearchHit } from "@/lib/library/search";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const q = ((await searchParams).q ?? "").slice(0, 200);
  const db = await getDb();
  const [hits, noteHits] = q ? await Promise.all([searchLibrary(db, user.id, q), searchNotes(db, user.id, q)]) : [[], []];
  const byBook = new Map<string, SearchHit[]>();
  for (const h of hits) byBook.set(h.bookId, [...(byBook.get(h.bookId) ?? []), h]);

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Search</p>
      <h1 className={styles.title}>Find a passage</h1>
      <form action="/search" className={styles.form} role="search">
        <label htmlFor="q" className="visually-hidden">
          Search inside your books
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          className={styles.input}
          placeholder={'Words, or an "exact phrase"'}
          autoFocus={!q}
        />
        <button type="submit" className={styles.button}>
          Search
        </button>
      </form>
      {q ? (
        <p className={styles.summary} role="status">
          {hits.length === 0 && noteHits.length === 0
            ? `Nothing in your books or notes matches “${q}”.`
            : [
                hits.length
                  ? `${hits.length}${hits.length === 60 ? "+" : ""} ${hits.length === 1 ? "passage" : "passages"} in ${byBook.size} ${byBook.size === 1 ? "book" : "books"}`
                  : "",
                noteHits.length ? `${noteHits.length} in your notes` : "",
              ]
                .filter(Boolean)
                .join(", ") + "."}
        </p>
      ) : (
        <p className={styles.summary}>Searches the text of every book on your shelf, and your highlights and notes. Put a minus before a word to leave it out.</p>
      )}
      {noteHits.length ? (
        <section className={styles.book} aria-labelledby="your-notes">
          <h2 id="your-notes" className={styles.bookTitle}>
            Your notes
          </h2>
          <ol className={styles.hits}>
            {noteHits.map((h) => (
              <li key={h.annotationId}>
                <Link
                  href={!h.bookId ? "/" : h.cfi ? `/books/${h.bookId}/read?at=${encodeURIComponent(h.cfi)}` : `/books/${h.bookId}`}
                  className={styles.hit}
                >
                  <span className={styles.chapter}>
                    {h.kind === "note" ? "Note" : h.kind === "bookmark" ? "Bookmark" : h.kind === "voice" ? "Voice note" : "Highlight"} · {h.bookTitle}
                  </span>
                  <span className={styles.snippet}>
                    {h.snippet.map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {[...byBook.values()].map((list) => (
        <section key={list[0].bookId} className={styles.book} aria-labelledby={`b-${list[0].bookId}`}>
          <h2 id={`b-${list[0].bookId}`} className={styles.bookTitle}>
            {list[0].bookTitle}
            {list[0].bookAuthor ? <span className={styles.author}> · {list[0].bookAuthor}</span> : null}
          </h2>
          <ol className={styles.hits}>
            {list.map((h) => (
              <li key={h.sectionId}>
                <Link href={`/books/${h.bookId}/read?at=${encodeURIComponent(h.cfi)}`} className={styles.hit}>
                  {h.chapter ? <span className={styles.chapter}>{h.chapter}</span> : null}
                  <span className={styles.snippet}>
                    {h.snippet.map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  );
}
