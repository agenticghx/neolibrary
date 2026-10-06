import type { Metadata } from "next";
import { ContinueCard } from "@/components/home/ContinueCard";
import { LibraryGrid, LibrarySpines, NotYetGroup } from "@/components/home/Library";
import { LibraryViews } from "@/components/home/LibraryViews";
import { SortMenu } from "@/components/home/SortMenu";
import styles from "@/components/home/Home.module.css";
import { StarterPaths } from "@/components/StarterPaths";
import { ImportButton, ImportRoot, ImportZone } from "@/components/upload/HomeImport";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { coverSigner } from "@/lib/library/covers";
import { continueBooks, latestNotes, libraryItems, notYetAvailable } from "@/lib/library/home";
import { chapterFor } from "@/lib/library/prerequisites";
import { listShelf, parseSort } from "@/lib/library/shelf";
import { addSampleBooksAction } from "./actions";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

/** Home is the library (M14, Samuel's picks): Continue at the top, then the whole library, with Import. */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const user = await requireUser();
  const db = await getDb();
  const sort = parseSort((await searchParams).sort);
  const [shelf, waiting, opened] = await Promise.all([listShelf(db, user.id, { sort }), notYetAvailable(db, user.id), continueBooks(db, user.id, 2)]);
  const sign = await coverSigner();
  // One pass for both lists: the notes and audiobook look-ups run once.
  const waitingIds = new Set(waiting.map((b) => b.id));
  const [all, notes] = await Promise.all([
    libraryItems(db, user.id, [...shelf, ...waiting], sign),
    latestNotes(
      db,
      user.id,
      opened.map((b) => b.id),
    ),
  ]);
  const items = all.filter((i) => !waitingIds.has(i.id));
  const waitingItems = all.filter((i) => waitingIds.has(i.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  const continuing = await Promise.all(
    opened
      .filter((b) => byId.has(b.id))
      .map(async (b) => ({
        item: byId.get(b.id)!,
        note: notes.get(b.id) ?? null,
        chapter: b.position ? await chapterFor(db, user.id, b.id, { cfi: b.position }).then((c) => c.label || null, () => null) : null,
      })),
  );
  const firstName = user.name.split(" ")[0];
  const nothing = !items.length && !waitingItems.length;

  return (
    <ImportRoot className={styles.main}>
      <header className={styles.head}>
        <h1 className={styles.title}>Home</h1>
        <ImportButton />
      </header>

      {nothing ? (
        <>
          <p className={styles.lede}>Good to see you, {firstName}. Your library is empty.</p>
          <ImportZone />
          <SampleOffer />
          <h2 className={styles.sectionTitle}>Start from a reading list</h2>
          <StarterPaths />
        </>
      ) : (
        <>
          {continuing.length ? (
            <section aria-labelledby="continue-h" className={styles.section}>
              <h2 id="continue-h" className={styles.sectionTitle}>
                Continue
              </h2>
              <div className={styles.cards}>
                {continuing.map((c) => (
                  <ContinueCard key={c.item.id} item={c.item} chapter={c.chapter} note={c.note} />
                ))}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="library-h" className={styles.section}>
            {items.length ? (
              <LibraryViews
                header={
                  <div className={styles.libraryHead}>
                    <h2 id="library-h" className={styles.sectionTitle}>
                      Your library <span className={styles.count}>{items.length === 1 ? "1 title" : `${items.length} titles`}</span>
                    </h2>
                    <SortMenu />
                  </div>
                }
                between={<ImportZone hideOnPhone />}
                grid={<LibraryGrid items={items} />}
                spines={<LibrarySpines items={items} />}
              />
            ) : (
              <>
                <h2 id="library-h" className={styles.sectionTitle}>
                  Your library
                </h2>
                <p className={styles.lede}>No book files yet. Your Paths&apos; titles wait below until you add their files.</p>
                <ImportZone />
                <SampleOffer />
              </>
            )}
            <NotYetGroup items={waitingItems} />
          </section>
        </>
      )}
    </ImportRoot>
  );
}

function SampleOffer() {
  return (
    <form action={addSampleBooksAction} className={styles.samples}>
      <p className={styles.samplesText}>
        No books to hand? Start with three free classics: <em>Frankenstein</em>, <em>Jekyll and Hyde</em> and <em>The Time Machine</em>{" "}
        (public-domain editions from Standard Ebooks).
      </p>
      <button type="submit" className={styles.samplesButton}>
        Add three free classics
      </button>
    </form>
  );
}
