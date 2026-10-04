import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { statsByBook } from "@/lib/library/reading-stats";
import styles from "../admin/invites/page.module.css";
import own from "./page.module.css";

export const metadata: Metadata = { title: "Reading stats" };
export const dynamic = "force-dynamic";

const time = (seconds: number) => {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** Your own reading, honestly measured (M10): active time only, words on the pages you saw. */
export default async function StatsPage() {
  const user = await requireUser();
  const books = await statsByBook(await getDb(), user.id);
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Your reading</p>
      <h1 className={styles.title}>Reading stats</h1>
      <p className={styles.lede}>
        Only active reading counts: the clock stops when the tab is hidden, after two minutes with no page turn or tap, and
        while the book is read aloud to you. Words are the words on the pages you saw, each page once per sitting.
      </p>
      <section aria-labelledby="by-book" className={styles.list}>
        <h2 id="by-book" className={styles.listTitle}>
          By book
        </h2>
        {books.length === 0 ? (
          <p className={styles.empty}>Nothing yet. Read a book for a minute or more and it appears here.</p>
        ) : (
          <table className={own.table} data-testid="stats-books">
            <thead>
              <tr>
                <th scope="col">Book</th>
                <th scope="col">Time</th>
                <th scope="col">Words</th>
                <th scope="col">Words per minute</th>
              </tr>
            </thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.bookId}>
                  <th scope="row">
                    <Link href={`/books/${b.bookId}`}>{b.title}</Link>
                  </th>
                  <td>{time(b.activeSeconds)}</td>
                  <td>{b.words.toLocaleString("en-GB")}</td>
                  <td data-testid={`wpm-${b.bookId}`}>{b.wpm ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
