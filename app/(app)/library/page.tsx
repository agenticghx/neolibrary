import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BookCarousel } from "@/components/home/BookCarousel";
import { LibrarySpines, NotYetGroup } from "@/components/home/Library";
import { LibraryViews } from "@/components/home/LibraryViews";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { coverSigner } from "@/lib/library/covers";
import { libraryItems, notYetAvailable } from "@/lib/library/home";
import { listCollections, listShelf, OLD_SHOWS, parseShow, parseSort, SHOWS } from "@/lib/library/shelf";
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

/** /library with these settings (Has audio, collection, sort, search), so a chip changes one and keeps the rest. */
function libraryHref(v: { show?: string; audio?: boolean; c?: string; sort?: string; q?: string }) {
  const p = new URLSearchParams();
  if (v.show && v.show !== "all") p.set("show", v.show);
  if (v.audio) p.set("audio", "1");
  if (v.c) p.set("c", v.c);
  if (v.sort) p.set("sort", v.sort);
  if (v.q) p.set("q", v.q);
  const s = p.toString();
  return s ? `/library?${s}` : "/library";
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; q?: string; c?: string; new?: string; show?: string; audio?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  // Books, Audiobooks and PDFs were three filters until 2026-10-29; their old addresses open Books.
  if (sp.show && Object.hasOwn(OLD_SHOWS, sp.show)) redirect(libraryHref({ ...sp, show: "all", audio: OLD_SHOWS[sp.show].audio }));
  const db = await getDb();
  const sort = parseSort(sp.sort);
  const show = parseShow(sp.show);
  // Has audio is a filter inside Books only.
  const audio = show === "all" && sp.audio === "1";
  const collectionList = await listCollections(db, user.id);
  const active = collectionList.find((c) => c.id === sp.c) ?? null;
  const [shelf, everything] = await Promise.all([
    listShelf(db, user.id, { sort, q: sp.q, collectionId: active?.id, show, audio }),
    listShelf(db, user.id),
  ]);
  const sign = await coverSigner();
  const items = await libraryItems(db, user.id, shelf, sign);
  // Books (without Has audio) and Want to Read, with no search and no collection, end with the titles not available yet (D3, D5).
  const waiting = !sp.q && !active && !audio && (show === "all" || show === "want") ? await libraryItems(db, user.id, await notYetAvailable(db, user.id), sign) : [];
  const chipHref = (c?: string) => libraryHref({ show, audio, c, sort: sp.sort, q: sp.q });
  const filtered = show !== "all" || audio;

  return (
    <main className={styles.main}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Library</p>
        <h1 className={styles.title}>{show === "all" ? "Your library" : SHOWS[show]}</h1>
        <p className={styles.lede}>
          {filtered
            ? <>
                <span>{`${items.length} ${items.length === 1 ? "title" : "titles"}${audio ? " with audio" : ""}${waiting.length ? `, and ${waiting.length} not available yet` : ""}.`}</span>{" "}
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
          {/* Inside Books: everything, or only the titles you can also listen to (an uploaded audiobook). */}
          {show === "all" ? (
            <nav className={styles.chips} aria-label="Books">
              <span className={styles.chipsLabel}>Books</span>
              <Link href={libraryHref({ c: active?.id, sort: sp.sort, q: sp.q })} className={styles.chip} aria-current={audio ? undefined : "page"}>
                All
              </Link>
              <Link href={libraryHref({ audio: true, c: active?.id, sort: sp.sort, q: sp.q })} className={styles.chip} aria-current={audio ? "page" : undefined}>
                Has audio
              </Link>
            </nav>
          ) : null}
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
              carousel={<BookCarousel items={items} label="Your library" testId="shelf" />}
              spines={<LibrarySpines items={items} />}
            />
          ) : (
            <p className={styles.empty}>
              {sp.q
                ? `Nothing matches “${sp.q}”${audio ? " among the titles with audio" : show !== "all" ? ` in ${SHOWS[show]}` : ""}.`
                : active
                  ? `No books in this collection${audio ? " with audio" : show !== "all" ? ` under ${SHOWS[show]}` : ""} yet.`
                  : audio
                    ? "No titles with audio yet. Add an audiobook to a book on the Import page."
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
