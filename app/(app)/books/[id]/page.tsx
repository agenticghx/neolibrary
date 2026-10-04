import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Cover } from "@/components/Cover";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { coverSigner } from "@/lib/library/covers";
import { getBook } from "@/lib/library/paths";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Book" };
export const dynamic = "force-dynamic";

const KIND = { N: "narrative, read first", E: "engineering & economics, read second", extra: "extra", master: "master key, read last" };

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const found = await getBook(await getDb(), user.id, (await params).id);
  if (!found) notFound();
  const { book, owned, places } = found;
  const firstKind = places[0]?.kind;

  return (
    <main className={styles.main}>
      <Link href="/" className={styles.back}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className={styles.backIcon}>
          <path d="M9 2 4 7l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        Path
      </Link>
      <div className={styles.layout}>
        <Cover
          title={book.title}
          slot={firstKind}
          tone={firstKind === "E" ? "green" : "navy"}
          owned={owned}
          progress={book.progress}
          imageUrl={(await coverSigner())(book.coverKey)}
        />
        <div className={styles.info}>
          <h1 className={styles.title}>{book.title}</h1>
          {book.author ? <p className={styles.author}>{book.author}</p> : null}
          {places.length ? (
            <ul className={styles.places}>
              {places.map((p) => (
                <li key={`${p.pathSlug}-${p.pillarSlug}-${p.kind}`}>
                  {p.path} › {p.pillar} · <span className={styles.kind}>{KIND[p.kind]}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {book.note ? <p className={styles.note}>{book.note}</p> : null}
          {owned ? (
            <p className={styles.meta}>
              {book.fileType?.toUpperCase()}
              {book.pageCount ? ` · ${book.pageCount} pages` : ""}
              {book.toc.length ? ` · ${book.toc.length} chapters` : ""}
              {book.publisher ? ` · ${book.publisher}` : ""}
            </p>
          ) : null}
          {owned && book.description ? <p className={styles.description}>{book.description}</p> : null}
          {owned && book.toc.length ? (
            <details className={styles.toc}>
              <summary>Contents</summary>
              <ol>
                {book.toc.map((t, i) => (
                  <li key={`${t.href}-${i}`}>{t.label}</li>
                ))}
              </ol>
            </details>
          ) : null}
          {book.unverified ? (
            <p className={styles.unverified}>
              Suggested by an agent and not checked against a catalog. Confirm the title, author and edition before
              buying.
            </p>
          ) : null}
          <p className={styles.status}>
            {owned
              ? `${Math.round(book.progress * 100)}% read`
              : "Not on your shelf yet. When you upload a DRM-free copy, it attaches here."}
          </p>
        </div>
      </div>
    </main>
  );
}
