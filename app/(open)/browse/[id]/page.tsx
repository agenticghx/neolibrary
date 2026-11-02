import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Cover } from "@/components/Cover";
import { getDb } from "@/lib/db";
import { visitorCoverSigner } from "@/lib/library/covers";
import { getOpenBook, goodreadsUrl } from "@/lib/library/open-shelf";
import styles from "../../open.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const book = await getOpenBook(await getDb(), (await params).id);
  return { title: book?.title ?? "Not found" };
}

/** One book on the open shelf. A book that is not on it is "not found", never "sign in": that would say it exists. */
export default async function OpenBookPage({ params }: { params: Promise<{ id: string }> }) {
  const book = await getOpenBook(await getDb(), (await params).id);
  if (!book) notFound();
  const sign = await visitorCoverSigner();

  return (
    <main className={styles.main}>
      <Link href="/browse" className={styles.back}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M9 2 4 7l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        The shelf
      </Link>
      <div className={styles.book}>
        <div className={styles.bookCover}>
          <Cover title={book.title} size="fill" caption={false} decorative available={book.freeToRead ? { read: true, listen: false } : { read: false, listen: false }} imageUrl={sign(book.coverKey)} />
        </div>
        <div className={styles.info}>
          <h1 className={styles.title}>{book.title}</h1>
          {book.author ? <p className={styles.author}>{book.author}</p> : null}
          {book.freeToRead ? (
            <p className={styles.freeNote}>In the public domain: free to read here (the reader opens for visitors in the next step).</p>
          ) : (
            <p>
              <a className={styles.action} href={goodreadsUrl(book.title, book.author)} rel="noopener noreferrer" target="_blank">
                Find it on Goodreads
              </a>
            </p>
          )}
          {book.publisher || book.pageCount ? (
            <p className={styles.meta}>
              {[book.publisher, book.pageCount ? `${book.pageCount} pages` : null].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {book.description ? <p className={styles.description}>{book.description}</p> : null}
        </div>
      </div>
    </main>
  );
}
