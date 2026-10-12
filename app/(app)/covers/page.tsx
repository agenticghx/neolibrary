import type { Metadata } from "next";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { books } from "@/lib/db/schema";
import { coverSigner } from "@/lib/library/covers";
import { CoverLists } from "./CoverLists";
import { FindCovers } from "./FindCovers";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Covers" };
export const dynamic = "force-dynamic";

/**
 * Covers (M22): the covers found for the reader's titles in public catalogues, each with where it came from, "Not
 * this cover" and "Choose another"; the titles still without one, with "Choose a cover" (C3a); and "Find covers
 * now". The server also looks covers up by itself (lib/library/cover-job.ts), so this page is for checking them.
 */
export default async function CoversPage() {
  const user = await requireUser();
  const db = await getDb();
  const rows = await db
    .select({ id: books.id, title: books.title, author: books.author, coverKey: books.coverKey, coverSource: books.coverSource, coverPage: books.coverPage })
    .from(books)
    .where(and(eq(books.ownerId, user.id), isNull(books.deletedAt)))
    .orderBy(asc(sql`lower(${books.title})`));
  const sign = await coverSigner();
  const found = rows
    .filter((b) => b.coverKey && b.coverSource && b.coverSource !== "file")
    .map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      imageUrl: sign(b.coverKey)!,
      // Only a web address becomes a link (an imported library could carry anything).
      pageUrl: b.coverPage && /^https:\/\//.test(b.coverPage) ? b.coverPage : null,
      source: b.coverSource!,
    }));
  const none = rows.filter((b) => !b.coverKey).map((b) => ({ id: b.id, title: b.title, author: b.author }));
  const fromFile = rows.filter((b) => b.coverKey && b.coverSource === "file").length;

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Library</p>
      <h1 className={styles.title}>Covers</h1>
      <p className={styles.lede}>
        Covers for your titles, found in public book catalogues by title and author. A cover inside a book&rsquo;s file always comes first. If a
        cover shows the wrong book or a poor picture, choose <strong>Not this cover</strong>: the next match takes its place, and that picture is
        never offered again. Or <strong>Choose another</strong>, and pick one yourself from a search of the catalogues.
      </p>
      <FindCovers found={found.length} none={none.length} />

      <CoverLists found={found} none={none} />
      {fromFile ? (
        <p className={styles.note}>
          {fromFile} {fromFile === 1 ? "title has the cover inside its book file." : "titles have the cover inside their book file."}
        </p>
      ) : null}
    </main>
  );
}
