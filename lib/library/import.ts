import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import type { Storage } from "@/lib/storage";
import { ImportError, readBook } from "./ebook";
import { pickBook, sameBook, UUID } from "./paths";
import { buildSections } from "./sections-store";

export type ImportResult =
  | { status: "added" | "attached"; bookId: string; title: string }
  | { status: "duplicate"; bookId: string; title: string };

/**
 * Adds an uploaded file to the owner's library:
 * - a wanted book (no file yet) that it could be (lib/library/paths.ts
 *   sameBook: the same short title, an author that agrees, no two different
 *   subtitles) gets the file attached, so it lights up in its Path instead
 *   of appearing twice; when several waiting titles could be it, the reader
 *   is asked to choose (Choose the book file on the right title);
 * - a book already on the shelf with a file is reported as a duplicate;
 * - otherwise a new book is created.
 * With `attachTo` (M14 step 5: "Add the book file" on a title not available
 * yet), the file goes to that title whatever its name: it must be the
 * reader's, not deleted, and have no file yet.
 */
export async function importBook(
  db: Db,
  storage: Storage,
  ownerId: string,
  file: { name: string; bytes: Uint8Array },
  opts: { attachTo?: string | null } = {},
): Promise<ImportResult> {
  const info = await readBook(file.bytes, file.name);
  let wanted: { id: string; title: string } | undefined;
  if (opts.attachTo) {
    const [target] = UUID.test(opts.attachTo)
      ? await db
          .select({ id: books.id, title: books.title, fileKey: books.fileKey })
          .from(books)
          .where(and(eq(books.id, opts.attachTo), eq(books.ownerId, ownerId), isNull(books.deletedAt)))
      : [];
    if (!target) throw new ImportError("That title was not found.");
    if (target.fileKey) throw new ImportError("That title already has its book file.");
    wanted = target;
  } else {
    const mine = await db
      .select({ id: books.id, title: books.title, author: books.author, fileKey: books.fileKey })
      .from(books)
      .where(and(eq(books.ownerId, ownerId), isNull(books.deletedAt)));
    // Typed titles (M14 step 5) can make two waiting titles with one short title and two authors: the author decides.
    const same = mine.filter((b) => sameBook(info.title, info.author, b));
    const withFile = same.find((b) => b.fileKey);
    if (withFile) return { status: "duplicate", bookId: withFile.id, title: withFile.title };
    const waiting = same.filter((b) => !b.fileKey);
    wanted = pickBook(waiting, info.title);
    if (!wanted && waiting.length > 1) {
      throw new ImportError("More than one title waiting in your library could be this book. Open the right one and use Choose the book file.");
    }
  }

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
