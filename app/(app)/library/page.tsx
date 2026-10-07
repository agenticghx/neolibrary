import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LibraryGrid, LibrarySpines, NotYetGroup } from "@/components/home/Library";
import { LibraryViews } from "@/components/home/LibraryViews";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { coverSigner } from "@/lib/library/covers";
import { libraryItems, notYetAvailable } from "@/lib/library/home";
import { listCollections, listShelf, parseShow, parseSort, SHOWS } from "@/lib/library/shelf";
import { addSampleBooksAction, deleteCollectionAction } from "../actions";
import { Controls } from "./Controls";
import { NewCollection } from "./NewCollection";
import styles from "./page.module.css";

/** The tab's title follows the filter ("Want to Read · Neolibrary"). */
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ show?: string }> }): Promise<Metadata> {
  const show = parseShow((await searchParams).show);
  return { title: show === "all" ? "Library" : SHOWS[show] };
}
export const dynamic = "force-dynamic";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; q?: string; c?: string; new?: string; show?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const sp = await searchParams;
  const sort = parseSort(sp.sort);
  const show = parseShow(sp.show);
  const collectionList = await listCollections(db, user.id);
  const active = collectionList.find((c) => c.id === sp.c) ?? null;
  const [shelf, everything] = await Promise.all([
    listShelf(db, user.id, { sort, q: sp.q, collectionId: active?.id, show }),
    listShelf(db, user.id),
  ]);
  const items = await libraryItems(db, user.id, shelf, await coverSigner());
  // All and Want to Read (no search, no collection) end with the titles not available yet (D3, D5).
  const waiting = !sp.q && !active && (show === "all" || show === "want") ? await libraryItems(db, user.id, await notYetAvailable(db, user.id)) : [];
  const chipHref = (c?: string) => {
    const p = new URLSearchParams();
    if (show !== "all") p.set("show", show);
    if (c) p.set("c", c);
    if (sp.sort) p.set("sort", sp.sort);
    if (sp.q) p.set("q", sp.q);
    const s = p.toString();
    return s ? `/library?${s}` : "/library";
  };

  return (
    <main className={styles.main}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Library</p>
        <h1 className={styles.title}>{show === "all" ? "Your library" : SHOWS[show]}</h1>
        <p className={styles.lede}>
          {show !== "all"
            ? <>
                <span>{`${items.length} ${items.length === 1 ? "title" : "titles"}${waiting.length ? `, and ${waiting.length} not available yet` : ""}.`}</span>{" "}
                <Link href="/library">Show the whole library</Link>
              </>
            : everything.length === 0
              ? <>
                  Nothing here yet. Add your own DRM-free books on the <Link href="/import">Import</Link> page.
                </>
              : `${everything.length} ${everything.length === 1 ? "book" : "books"}.`}
        </p>
      </header>
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

      {/* Collections show even before the first book, so New collection (also in the sidebar) always works. */}
      {everything.length || collectionList.length || sp.new === "collection" ? (
        <section className={styles.browse} aria-label="Browse your library">
          {everything.length ? (
            <Suspense>
              <Controls />
            </Suspense>
          ) : null}
          {/* On a phone the Library tab shows the filters as chips, just above the collections (on desktop they are in the sidebar). */}
          <nav className={[styles.chips, styles.filters].join(" ")} aria-label="Filters">
            <span className={styles.chipsLabel}>Show</span>
            {Object.entries(SHOWS).map(([key, label]) => (
              <Link
                key={key}
                href={key === "all" ? "/library" : `/library?show=${key}`}
                className={styles.chip}
                aria-current={show === key ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <nav className={styles.chips} aria-label="Collections">
            <span className={styles.chipsLabel}>Collections</span>
            <Link href={chipHref()} className={styles.chip} aria-current={active ? undefined : "page"}>
              All collections
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
            <NewCollection key={sp.new ?? ""} startOpen={sp.new === "collection"} />
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

          {items.length ? (
            <LibraryViews
              header={<p className={styles.count}>{items.length === 1 ? "1 title" : `${items.length} titles`}</p>}
              grid={<LibraryGrid items={items} />}
              spines={<LibrarySpines items={items} />}
            />
          ) : (
            <p className={styles.empty}>
              {sp.q
                ? `Nothing matches “${sp.q}”${show !== "all" ? ` in ${SHOWS[show]}` : ""}.`
                : active
                  ? `No books in this collection${show !== "all" ? ` under ${SHOWS[show]}` : ""} yet.`
                  : `No books here yet${waiting.length ? "; the titles not available yet are below" : ""}.`}
            </p>
          )}
        </section>
      ) : null}

      <NotYetGroup items={waiting} />

      <footer className={styles.data}>
        <p>
          Your library is yours: <a href="/api/export">download it as a file</a> (books, paths, collections) or{" "}
          <Link href="/data">bring one back</Link>. How you read: <Link href="/stats">your reading stats</Link>.
        </p>
      </footer>
    </main>
  );
}
