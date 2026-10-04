import { and, asc, eq, isNotNull, isNull, notExists, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, sections } from "@/lib/db/schema";
import type { Storage } from "@/lib/storage";
import { extractSections, type Section } from "./sections";

/** Replaces a book's sections with freshly extracted ones. */
export async function saveSections(db: Db, bookId: string, list: Section[]) {
  await db.transaction(async (tx) => {
    await tx.delete(sections).where(eq(sections.bookId, bookId));
    for (let i = 0; i < list.length; i += 500) {
      await tx.insert(sections).values(list.slice(i, i + 500).map((s) => ({ ...s, bookId })));
    }
  });
}

export async function buildSections(db: Db, bookId: string, bytes: Uint8Array, toc: { label: string; href: string }[]) {
  const list = extractSections(bytes, toc);
  await saveSections(db, bookId, list);
  return list.length;
}

/** A book's sections in reading order, for its owner only. */
export async function getSections(db: Db, ownerId: string, bookId: string) {
  return db
    .select({
      id: sections.id,
      kind: sections.kind,
      parentId: sections.parentId,
      position: sections.position,
      chapterIndex: sections.chapterIndex,
      href: sections.href,
      cfi: sections.cfi,
      label: sections.label,
      text: sections.text,
    })
    .from(sections)
    .innerJoin(books, eq(books.id, sections.bookId))
    .where(and(eq(sections.bookId, bookId), eq(books.ownerId, ownerId)))
    .orderBy(asc(sections.position));
}

/** Builds sections for EPUBs uploaded before the section model existed. */
export async function backfillSections(db: Db, storage: Storage) {
  const missing = await db
    .select({ id: books.id, fileKey: books.fileKey, toc: books.toc })
    .from(books)
    .where(
      and(
        eq(books.fileType, "epub"),
        isNotNull(books.fileKey),
        isNull(books.deletedAt),
        notExists(db.select({ one: sql`1` }).from(sections).where(eq(sections.bookId, books.id))),
      ),
    );
  let done = 0;
  for (const b of missing) {
    const file = await storage.get(b.fileKey!).catch(() => null);
    if (!file) continue;
    await buildSections(db, b.id, file.data, b.toc as { label: string; href: string }[]);
    done += 1;
  }
  return done;
}
