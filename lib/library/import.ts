import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import type { Storage } from "@/lib/storage";
import { readBook } from "./ebook";
import { normaliseTitle } from "./paths";
import { buildSections } from "./sections-store";

export type ImportResult =
  | { status: "added" | "attached"; bookId: string; title: string }
  | { status: "duplicate"; bookId: string; title: string };

/**
 * Adds an uploaded file to the owner's library:
 * - a wanted book (no file yet) with the same title gets the file attached,
 *   so it lights up in its Path instead of appearing twice;
 * - a title already on the shelf with a file is reported as a duplicate;
 * - otherwise a new book is created.
 */
export async function importBook(
  db: Db,
  storage: Storage,
  ownerId: string,
  file: { name: string; bytes: Uint8Array },
): Promise<ImportResult> {
  const info = await readBook(file.bytes, file.name);
  const key = normaliseTitle(info.title);
  const mine = await db
    .select({ id: books.id, title: books.title, fileKey: books.fileKey })
    .from(books)
    .where(and(eq(books.ownerId, ownerId), isNull(books.deletedAt)));
  const sameTitle = mine.filter((b) => normaliseTitle(b.title) === key);
  const withFile = sameTitle.find((b) => b.fileKey);
  if (withFile) return { status: "duplicate", bookId: withFile.id, title: withFile.title };
  const wanted = sameTitle.find((b) => !b.fileKey);

  const bookId =
    wanted?.id ??
    (
      await db
        .insert(books)
        .values({ ownerId, title: info.title, author: info.author })
        .returning({ id: books.id })
    )[0].id;

  const fileKey = `books/${ownerId}/${bookId}.${info.type}`;
  await storage.put(fileKey, file.bytes, info.type === "epub" ? "application/epub+zip" : "application/pdf");
  let coverKey: string | null = null;
  if (info.cover) {
    coverKey = `covers/${ownerId}/${bookId}.${info.cover.ext}`;
    await storage.put(coverKey, info.cover.data, info.cover.contentType);
  }
  await db
    .update(books)
    .set({
      fileKey,
      fileName: file.name.slice(0, 255),
      fileType: info.type,
      fileSize: file.bytes.byteLength,
      coverKey,
      language: info.language,
      publisher: info.publisher,
      description: info.description,
      toc: info.toc,
      pageCount: info.pageCount,
      // A wanted book keeps the title and author from the reading list.
      ...(wanted ? {} : { title: info.title, author: info.author }),
      updatedAt: new Date(),
    })
    .where(eq(books.id, bookId));
  await buildSections(db, bookId, file.bytes, info.toc, info.type);
  return { status: wanted ? "attached" : "added", bookId, title: wanted?.title ?? info.title };
}

/** Owner of a stored file, from its key (books/<owner>/…, covers/<owner>/…). */
export function fileOwner(key: string): string | null {
  const m = /^(?:books|covers|audio|images)\/([0-9a-f-]{36})\//.exec(key);
  return m ? m[1] : null;
}
