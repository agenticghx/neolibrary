import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BookCarousel } from "@/components/home/BookCarousel";
import { LibrarySpines, NotYetGroup } from "@/components/home/Library";
import { LibraryViews } from "@/components/home/LibraryViews";
import { PapersHeaderWithUpload } from "@/components/upload/QuickPaperUpload";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { coverSigner } from "@/lib/library/covers";
import { libraryItems, notYetAvailable } from "@/lib/library/home";
import { listCollections, listShelf, OLD_SHOWS, parseShow, parseSort, parseStatus, SHOWS, STATUSES, type ReadingStatus } from "@/lib/library/shelf";
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

/** /library with these settings (show, status, audio, collection, sort, search), so a chip changes one and keeps the rest. */
function libraryHref(v: { show?: string; status?: ReadingStatus; audio?: boolean; c?: string; sort?: string; q?: string }) {
  const p = new URLSearchParams();
  if (v.show && v.show !== "all") p.set("show", v.show);
  if (v.status && v.status !== "all") p.set("status", v.status);
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
  searchParams: Promise<{ sort?: string; q?: string; c?: string; new?: string; show?: string; status?: string; audio?: string }>;
}) {
  const user = await requireUser();
  const given = await searchParams;
  // "?q=a&q=b" arrives as a list: only one search at a time.
  const sp = { ...given, q: typeof given.q === "string" ? given.q : undefined };
  // Books, Audiobooks and PDFs were three filters until 2026-10-29; their old addresses open Books.
  if (sp.show && Object.hasOwn(OLD_SHOWS, sp.show)) redirect(libraryHref({ ...sp, show: "all", status: parseStatus(sp.status), audio: OLD_SHOWS[sp.show].audio }));
  const db = await getDb();
  const sort = parseSort(sp.sort);
  const show = parseShow(sp.show);
  const status: ReadingStatus = show === "want" || show === "finished" ? show : parseStatus(sp.status);
  const section: "all" | "papers" = show === "papers" ? "papers" : "all";
  // Has audio is a filter inside Books only.
  const audio = section === "all" && sp.audio === "1";
  const collectionList = await listCollections(db, user.id);
  const active = collectionList.find((c) => c.id === sp.c) ?? null;
  const unfiltered = !sp.q && !active && section === "all" && status === "all" && !audio;
  const showWaiting = !sp.q && !active && !audio && section === "all" && (status === "all" || status === "want");
  const [shelf, allRows, waitingRows, sign] = await Promise.all([
    listShelf(db, user.id, { sort, q: sp.q, collectionId: active?.id, show: section, status, audio }),
    unfiltered ? Promise.resolve(null) : listShelf(db, user.id),
    showWaiting ? notYetAvailable(db, user.id) : Promise.resolve([]),
    coverSigner(),
  ]);
  const everything = allRows ?? shelf;
  // Books (without Has audio) and Want to Read, with no search and no collection, end with the titles not available yet (D3, D5).
  const combined = await libraryItems(db, user.id, [...shelf, ...waitingRows], sign);
  const items = combined.slice(0, shelf.length);
  const waiting = combined.slice(shelf.length);
  const chipHref = (c?: string) => libraryHref({ show: section, status, audio, c, sort: sp.sort, q: sp.q });
  const filtered = show !== "all" || status !== "all" || audio;

  return (
    <main className={styles.main}>
      {show === "papers" ? (
        <PapersHeaderWithUpload
          eyebrow="Library"
          title={SHOWS[show]}
          countText={`${items.length} ${items.length === 1 ? "title" : "titles"}.`}
          allLibraryHref="/library"
        />
      ) : (
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
      )}
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
          {/* On a phone the Library tab switches between Books and Papers (on desktop they are in the sidebar). */}
          <nav className={[styles.chips, styles.filters].join(" ")} aria-label="Filters">
            <span className={styles.chipsLabel}>Show</span>
            {(
              [
                ["all", "Books"],
                ["papers", "Papers"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={key === "all" ? "/library" : `/library?show=${key}`}
                className={styles.chip}
                aria-current={section === key ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          {/* Option A · Reading status filter pills inside both Books and Papers (plus Has audio under Books). */}
          <nav className={styles.chips} aria-label="Status">
            <span className={styles.chipsLabel}>Status</span>
            {(Object.entries(STATUSES) as [ReadingStatus, string][]).map(([key, label]) => (
              <Link
                key={key}
                href={libraryHref({ show: section, status: key, c: active?.id, sort: sp.sort, q: sp.q })}
                className={styles.chip}
                aria-current={!audio && status === key ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
            {section === "all" ? (
              <Link
                href={libraryHref({ show: "all", audio: true, c: active?.id, sort: sp.sort, q: sp.q })}
                className={styles.chip}
                aria-current={audio ? "page" : undefined}
              >
                Has audio
              </Link>
            ) : null}
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
          Your library is yours: <a href="/api/export" download>download it as a file</a> (books, paths, collections) or{" "}
          <Link href="/data">bring one back</Link>. How you read: <Link href="/stats">your reading stats</Link>.
        </p>
      </footer>
    </main>
  );
}
