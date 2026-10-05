import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Cover } from "@/components/Cover";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { availabilityLabel, availabilityOf } from "@/lib/library/availability";
import { audiobookBookIds, narrationOn } from "@/lib/library/listenable";
import { coverSigner } from "@/lib/library/covers";
import { listCollections, listShelf, parseSort } from "@/lib/library/shelf";
import { addSampleBooksAction, deleteCollectionAction } from "../actions";
import { Controls } from "./Controls";
import { Dropzone } from "./Dropzone";
import { NewCollection } from "./NewCollection";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Shelf" };
export const dynamic = "force-dynamic";

const progressLabel = (p: number) => (p >= 1 ? "Finished" : p > 0 ? `${Math.round(p * 100)}% read` : "Unread");

export default async function ShelfPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; q?: string; c?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const sp = await searchParams;
  const sort = parseSort(sp.sort);
  const collectionList = await listCollections(db, user.id);
  const active = collectionList.find((c) => c.id === sp.c) ?? null;
  const [shelf, everything] = await Promise.all([
    listShelf(db, user.id, { sort, q: sp.q, collectionId: active?.id }),
    listShelf(db, user.id),
  ]);
  const sign = await coverSigner();
  const audiobooks = await audiobookBookIds(
    db,
    user.id,
    shelf.map((b) => b.id),
  );
  const narration = narrationOn();
  const chipHref = (c?: string) => {
    const p = new URLSearchParams();
    if (c) p.set("c", c);
    if (sp.sort) p.set("sort", sp.sort);
    if (sp.q) p.set("q", sp.q);
    const s = p.toString();
    return s ? `/shelf?${s}` : "/shelf";
  };

  return (
    <main className={styles.main}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Library</p>
        <h1 className={styles.title}>Your library</h1>
        <p className={styles.lede}>
          {everything.length === 0
            ? "Nothing here yet. Add your own DRM-free books."
            : `${everything.length} ${everything.length === 1 ? "book" : "books"}.`}
        </p>
      </header>
      <Dropzone />
      {everything.length === 0 ? (
        <form action={addSampleBooksAction} className={styles.samples}>
          <p className={styles.samplesText}>
            No books to hand? Start with three free classics: <em>Frankenstein</em>, <em>Jekyll and Hyde</em> and{" "}
            <em>The Time Machine</em> (public-domain editions from Standard Ebooks).
          </p>
          <button type="submit" className={styles.samplesButton}>
            Add three free classics
          </button>
        </form>
      ) : null}

      {everything.length ? (
        <section className={styles.browse} aria-label="Browse your shelf">
          <Suspense>
            <Controls />
          </Suspense>
          <nav className={styles.chips} aria-label="Collections">
            <Link href={chipHref()} className={styles.chip} aria-current={active ? undefined : "page"}>
              All
            </Link>
            {collectionList.map((c) => (
              <Link
                key={c.id}
                href={chipHref(c.id)}
                className={styles.chip}
                aria-current={active?.id === c.id ? "page" : undefined}
              >
                {c.name} <span className={styles.chipCount}>{c.count}</span>
              </Link>
            ))}
            <NewCollection />
          </nav>
          {active ? (
            <form action={deleteCollectionAction} className={styles.collectionBar}>
              <input type="hidden" name="id" value={active.id} />
              <span>
                Collection <strong>{active.name}</strong>. Add books to it from each book&apos;s page.
              </span>
              <button type="submit" className={styles.linkButton}>
                Delete collection
              </button>
            </form>
          ) : null}

          {shelf.length ? (
            <ul className={styles.grid} data-testid="shelf">
              {shelf.map((b) => {
                const available = availabilityOf(b, audiobooks.has(b.id), narration);
                return (
                  <li key={b.id}>
                    <Link href={`/books/${b.id}`} className={styles.item}>
                      <Cover title={b.title} available={available} caption={false} imageUrl={sign(b.coverKey)} progress={b.progress} />
                      <span className={styles.itemTitle}>{b.title}</span>
                      <span className={styles.itemAuthor}>{b.author}</span>
                      <span className={styles.itemAvailable}>{availabilityLabel(available)}</span>
                      <span className={styles.itemProgress}>{progressLabel(b.progress)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.empty}>{sp.q ? `Nothing matches “${sp.q}”.` : "No books in this collection yet."}</p>
          )}
        </section>
      ) : null}

      <footer className={styles.data}>
        <p>
          Your library is yours: <a href="/api/export">download it as a file</a> (books, paths, collections) or{" "}
          <Link href="/data">bring one back</Link>. How you read: <Link href="/stats">your reading stats</Link>.
        </p>
      </footer>
    </main>
  );
}
