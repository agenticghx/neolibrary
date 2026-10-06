import type { Metadata } from "next";
import Link from "next/link";
import { ContinueCard } from "@/components/home/ContinueCard";
import { LibraryGrid, LibrarySpines, NotYetGroup } from "@/components/home/Library";
import { LibraryViews } from "@/components/home/LibraryViews";
import { SortMenu } from "@/components/home/SortMenu";
import styles from "@/components/home/Home.module.css";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { StarterPaths } from "@/components/StarterPaths";
import { ImportLink } from "@/components/upload/HomeImport";
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
        at: b.position,
        note: notes.get(b.id) ?? null,
        chapter: b.position ? await chapterFor(db, user.id, b.id, { cfi: b.position }).then((c) => c.label || null, () => null) : null,
      })),
  );
  const firstName = user.name.split(" ")[0];
  const nothing = !items.length && !waitingItems.length;

  return (
    <main className={styles.main}>
      <header className={styles.head}>
        <h1 className={styles.title}>Home</h1>
        <div className={styles.headActions}>
          <ImportLink />
          {/* On a phone the account (Reading stats, Your data, Invite, Sign out) lives here, on Home only
              (Samuel's choice B, 2026-10-06); on desktop it is at the foot of the sidebar. */}
          <div className={styles.phoneOnly}>
            <AccountMenu name={user.name} admin={user.role === "admin"} />
          </div>
        </div>
      </header>

      {nothing ? (
        <>
          <p className={styles.lede}>
            Good to see you, {firstName}. Your library is empty. Add your books on the <Link href="/import">Import</Link> page.
          </p>
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
                  <ContinueCard key={c.item.id} item={c.item} chapter={c.chapter} note={c.note} at={c.at} />
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
                grid={<LibraryGrid items={items} />}
                spines={<LibrarySpines items={items} />}
              />
            ) : (
              <>
                <h2 id="library-h" className={styles.sectionTitle}>
                  Your library
                </h2>
                <p className={styles.lede}>
                  No book files yet: add them on the <Link href="/import">Import</Link> page. Your Paths&apos; titles wait below until you add
                  their files.
                </p>
                <SampleOffer />
              </>
            )}
            <NotYetGroup items={waitingItems} />
          </section>
        </>
      )}
    </main>
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
