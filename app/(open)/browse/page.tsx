import type { Metadata } from "next";
import Link from "next/link";
import { Cover } from "@/components/Cover";
import { getDb } from "@/lib/db";
import { visitorCoverSigner } from "@/lib/library/covers";
import { listOpenShelf, OPEN_SORTS, parseOpenSort, shelfOwner } from "@/lib/library/open-shelf";
import styles from "../open.module.css";

export const metadata: Metadata = { title: "The shelf" };
export const dynamic = "force-dynamic";

const NOTHING = { read: false, listen: false };
const READ = { read: true, listen: false };

/** /browse with these settings, so a chip changes one and keeps the rest. */
function shelfHref(v: { free?: boolean; sort?: string; q?: string }) {
  const p = new URLSearchParams();
  if (v.free) p.set("free", "1");
  if (v.sort && v.sort !== "title") p.set("sort", v.sort);
  if (v.q) p.set("q", v.q);
  const s = p.toString();
  return s ? `/browse?${s}` : "/browse";
}

export default async function OpenShelfPage({ searchParams }: { searchParams: Promise<{ q?: string; free?: string; sort?: string }> }) {
  const sp = await searchParams;
  const free = sp.free === "1";
  const sort = parseOpenSort(sp.sort);
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const db = await getDb();
  const [shown, all, owner] = await Promise.all([listOpenShelf(db, { q, free, sort }), listOpenShelf(db), shelfOwner(db)]);
  const freeCount = all.filter((b) => b.freeToRead).length;
  const sign = await visitorCoverSigner();

  return (
    <main className={styles.main}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>The shelf</p>
        <h1 className={styles.title}>{owner ? `${owner.name.split(" ")[0]}’s library` : "The library"}</h1>
        <p className={styles.lede}>
          {all.length} {all.length === 1 ? "book" : "books"} on the shelf.{" "}
          {freeCount
            ? `${freeCount} of them ${freeCount === 1 ? "is" : "are"} in the public domain and free to read here; for the others, find a copy on Goodreads.`
            : "Find a copy of any of them on Goodreads."}
        </p>
      </header>

      <form className={styles.controls} action="/browse" role="search">
        <label className={styles.searchLabel}>
          <span className="visually-hidden">Search by title or author</span>
          <input className={styles.search} type="search" name="q" defaultValue={q} placeholder="Search by title or author" />
        </label>
        {free ? <input type="hidden" name="free" value="1" /> : null}
        {sort !== "title" ? <input type="hidden" name="sort" value={sort} /> : null}
      </form>
      <nav className={styles.chips} aria-label="Show and sort">
        <Link href={shelfHref({ sort, q })} className={styles.chip} aria-current={!free ? "true" : undefined}>
          Every book
        </Link>
        <Link href={shelfHref({ free: true, sort, q })} className={styles.chip} aria-current={free ? "true" : undefined}>
          Free to read
        </Link>
        <span className={styles.chipGap} aria-hidden="true" />
        {(Object.keys(OPEN_SORTS) as (keyof typeof OPEN_SORTS)[]).map((s) => (
          <Link key={s} href={shelfHref({ free, sort: s, q })} className={styles.chip} aria-current={sort === s ? "true" : undefined}>
            By {OPEN_SORTS[s].toLowerCase()}
          </Link>
        ))}
      </nav>

      {shown.length ? (
        <ul className={styles.grid} data-testid="open-shelf-grid">
          {shown.map((b) => (
            <li key={b.id}>
              <Link href={`/browse/${b.id}`} className={styles.item}>
                <Cover title={b.title} size="fill" caption={false} decorative available={b.freeToRead ? READ : NOTHING} imageUrl={sign(b.coverKey)} />
                <span className={styles.itemTitle}>{b.title}</span>
                {b.author ? <span className={styles.itemAuthor}>{b.author}</span> : null}
                {b.freeToRead ? <span className={styles.free}>Free to read</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.lede}>
          Nothing matches. <Link href="/browse">Show every book</Link>
        </p>
      )}
    </main>
  );
}
