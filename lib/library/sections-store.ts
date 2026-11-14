import { and, asc, eq, isNotNull, isNull, notExists, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { appSettings, books, sections } from "@/lib/db/schema";
import type { Storage } from "@/lib/storage";
import { extractPdfSections } from "./pdf-sections";
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

export async function buildSections(
  db: Db,
  bookId: string,
  bytes: Uint8Array,
  toc: { label: string; href: string }[],
  type: "epub" | "pdf" = "epub",
) {
  const list = type === "pdf" ? await extractPdfSections(bytes) : extractSections(bytes, toc);
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
      form: sections.form,
    })
    .from(sections)
    .innerJoin(books, eq(books.id, sections.bookId))
    .where(and(eq(sections.bookId, bookId), eq(books.ownerId, ownerId), isNull(books.deletedAt)))
    .orderBy(asc(sections.position));
}

/**
 * The files the start-up pass read and found no paragraphs in (a scanned book before its text edition, or a file that
 * could not be read), as book id -> file key. Without it every such file was downloaded and read at every server start,
 * which waits for it (audit 2026-11-09). A book given another file is read again; deleting this row retries them all.
 */
export const NO_PARAGRAPHS = "sections-none";

/** Builds sections for books (EPUB or PDF) that have none: uploaded before the section model existed, or not built at upload. */
export async function backfillSections(db: Db, storage: Storage) {
  const missing = await db
    .select({ id: books.id, fileKey: books.fileKey, toc: books.toc, fileType: books.fileType })
    .from(books)
    .where(
      and(
        isNotNull(books.fileType),
        isNotNull(books.fileKey),
        isNull(books.deletedAt),
        notExists(db.select({ one: sql`1` }).from(sections).where(eq(sections.bookId, books.id))),
      ),
    );
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.name, NO_PARAGRAPHS));
  const tried = row?.value ?? {};
  const none: Record<string, string> = {};
  let done = 0;
  for (const b of missing) {
    if (tried[b.id] === b.fileKey) {
      none[b.id] = b.fileKey!;
      continue;
    }
    const file = await storage.get(b.fileKey!).catch(() => null);
    if (!file) continue; // the bucket did not answer: try again at the next start
    // One file that cannot be read must not stop the books after it (this runs at every server start).
    try {
      if (await buildSections(db, b.id, file.data, b.toc as { label: string; href: string }[], b.fileType ?? "epub")) done += 1;
      else none[b.id] = b.fileKey!;
    } catch (e) {
      console.error(`Paragraphs could not be built for book ${b.id}:`, e);
      none[b.id] = b.fileKey!;
    }
  }
  // Kept to the books still without paragraphs, so a removed book or one that has them now leaves the list.
  const same = (a: Record<string, string>, b: Record<string, string>) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  if (!same(none, tried)) {
    await db
      .insert(appSettings)
      .values({ name: NO_PARAGRAPHS, value: none })
      .onConflictDoUpdate({ target: appSettings.name, set: { value: none, updatedAt: new Date() } });
  }
  return done;
}
