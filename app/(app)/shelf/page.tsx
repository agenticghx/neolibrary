import type { Metadata } from "next";
import Link from "next/link";
import { Cover } from "@/components/Cover";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { coverSigner } from "@/lib/library/covers";
import { listShelf } from "@/lib/library/paths";
import { Dropzone } from "./Dropzone";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Shelf" };
export const dynamic = "force-dynamic";

export default async function ShelfPage() {
  const user = await requireUser();
  const shelf = await listShelf(await getDb(), user.id);
  const sign = await coverSigner();
  return (
    <main className={styles.main}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Your shelf</p>
        <h1 className={styles.title}>Books you own</h1>
        <p className={styles.lede}>
          {shelf.length === 0
            ? "Nothing here yet. Add your own DRM-free books; ones on your path light up there too."
            : `${shelf.length} ${shelf.length === 1 ? "book" : "books"}.`}
        </p>
      </header>
      <Dropzone />
      {shelf.length ? (
        <ul className={styles.grid} data-testid="shelf">
          {shelf.map((b) => (
            <li key={b.id}>
              <Link href={`/books/${b.id}`} className={styles.item}>
                <Cover title={b.title} owned imageUrl={sign(b.coverKey)} progress={b.progress} />
                <span className={styles.itemTitle}>{b.title}</span>
                <span className={styles.itemAuthor}>{b.author}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
