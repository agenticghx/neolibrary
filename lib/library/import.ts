import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import type { Storage } from "@/lib/storage";
import { safeUnzip } from "@/lib/readalong/zipread";
import { EPUB_ZIP_LIMITS, ImportError, readBook } from "./ebook";
import { isMarkdownName, markdownToEpub, type MarkdownBook } from "./markdown-epub";
import { Pictures } from "./markdown-pictures";
import { markdownIn, ZIP_NOT_A_BOOK } from "./zip-names";
import { pickBook, sameBook, UUID } from "./paths";
import { restoreEditions } from "./remove-book";
import { buildSections } from "./sections-store";
import { buildXray } from "./xray";
import { isOwnBook } from "@/lib/library/own-book";

export type ImportResult = (
  | { status: "added" | "attached"; bookId: string; title: string }
  | { status: "duplicate"; bookId: string; title: string }
  /** The reader had removed this book (M19): it comes back, with its notes, rather than as a second copy. */
  | { status: "restored"; bookId: string; title: string }
) & {
  /** M41 R2: a Markdown book's pictures, in a sentence ("With 33 pictures.", or which ones were not found). */
  note?: string;
};



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
  // M29: a Markdown book becomes an EPUB here, and is an ordinary EPUB from then on (its file name stays the .md's).
  // M41 R2: so does a .zip holding one Markdown file and its pictures (a paper and its figures).
  let book: MarkdownBook | null = null;
  if (isMarkdownName(file.name)) book = markdownBook(file.bytes, file.name);
  else if (/\.zip$/i.test(file.name)) book = markdownZip(file.bytes);
  if (book) file = { name: file.name, bytes: book.bytes };
  const result = await importFile(db, storage, ownerId, file, opts);
  const note = book && result.status !== "duplicate" ? picturesNote(book.pictures, /\.zip$/i.test(file.name)) : null;
  return note ? { ...result, note } : result;
}

async function importFile(
  db: Db,
  storage: Storage,
  ownerId: string,
  file: { name: string; bytes: Uint8Array },
  opts: { attachTo?: string | null },
): Promise<ImportResult> {
  const info = await readBook(file.bytes, file.name);
  let wanted: { id: string; title: string; author: string } | undefined;
  if (opts.attachTo) {
    const [target] = UUID.test(opts.attachTo)
      ? await db
          .select({ id: books.id, title: books.title, author: books.author, fileKey: books.fileKey })
          .from(books)
          .where(isOwnBook(opts.attachTo, ownerId))
      : [];
    if (!target) throw new ImportError("That title was not found.");
    if (target.fileKey) throw new ImportError("That title already has its book file.");
    wanted = target;
  } else {
    const mine = await db
      .select({ id: books.id, title: books.title, author: books.author, fileKey: books.fileKey })
      .from(books)
      .where(and(eq(books.ownerId, ownerId), isNull(books.deletedAt), isNull(books.editionOf)));
    // Typed titles (M14 step 5) can make two waiting titles with one short title and two authors: the author decides.
    const same = mine.filter((b) => sameBook(info.title, info.author, b));
    const withFile = same.find((b) => b.fileKey);
    if (withFile) return { status: "duplicate", bookId: withFile.id, title: withFile.title };
    // Removed from the library earlier (M19): bring that book back, its notes and place with it, instead of a copy.
    const removed = await db
      .select({ id: books.id, title: books.title, author: books.author })
      .from(books)
      .where(and(eq(books.ownerId, ownerId), isNotNull(books.deletedAt), isNotNull(books.fileKey), isNull(books.editionOf)));
    const back = removed.find((b) => sameBook(info.title, info.author, b));
    if (back) {
      await db.update(books).set({ deletedAt: null, removedByReader: false }).where(eq(books.id, back.id));
      await restoreEditions(db, ownerId, back.id);
      return { status: "restored", bookId: back.id, title: back.title };
    }
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
  // A title waiting on a Path may already show a cover found in a catalogue (M22): the file's own cover replaces
  // it; a file without one (most PDFs) keeps it.
  const [had] = wanted ? await db.select({ coverKey: books.coverKey }).from(books).where(eq(books.id, bookId)) : [];
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
      ...(coverKey ? { coverKey, coverSource: "file" as const, coverRef: null, coverPage: null } : {}),
      language: info.language,
      publisher: info.publisher,
      description: info.description,
      toc: info.toc,
      pageCount: info.pageCount,
      // A wanted book keeps the title and author it was given (a reading list's, or the reader's);
      // an author left blank when the title was typed comes from the file.
      ...(wanted ? (wanted.author.trim() ? {} : { author: info.author }) : { title: info.title, author: info.author }),
      updatedAt: new Date(),
    })
    .where(eq(books.id, bookId));
  if (coverKey && had?.coverKey && had.coverKey !== coverKey) await storage.delete(had.coverKey);
  await buildSections(db, bookId, file.bytes, info.toc, info.type);
  // M32 X1: the X-ray index from the text alone, so the Who & what tab has something the moment the book opens.
  await buildXray(db, bookId);
  return { status: wanted ? "attached" : "added", bookId, title: wanted?.title ?? info.title };
}

/** Markdown bytes as text; refuses text that is not UTF-8. */
function markdownText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ImportError("This Markdown file is not plain text (UTF-8).");
  }
  if (text.includes("\u0000")) throw new ImportError("This Markdown file is not plain text (UTF-8).");
  return text;
}

/** A Markdown file's bytes as an EPUB; refuses text that is not UTF-8, or has no text. */
function markdownBook(bytes: Uint8Array, name: string, pictures?: Pictures): MarkdownBook {
  const text = markdownText(bytes);
  try {
    return markdownToEpub(text, name, undefined, pictures);
  } catch {
    throw new ImportError("This Markdown file has no text.");
  }
}

/**
 * M41 R2: a .zip holding one Markdown file and its pictures as an EPUB. Pictures are found relative to the Markdown
 * file's folder in the zip, as on disk; a zip with no Markdown file (an audiobook's package, say) or several is refused.
 */
function markdownZip(bytes: Uint8Array): MarkdownBook {
  let files: Record<string, Uint8Array>;
  try {
    files = safeUnzip(bytes, EPUB_ZIP_LIMITS);
  } catch {
    throw new ImportError("This .zip could not be opened.");
  }
  const mds = markdownIn(Object.keys(files));
  if (!mds.length) throw new ImportError(ZIP_NOT_A_BOOK);
  if (mds.length > 1) throw new ImportError(`This .zip holds ${mds.length} Markdown files. A .zip is added as one book: put one Markdown file, with its pictures, in each .zip.`);
  const path = mds[0];
  const slash = path.lastIndexOf("/");
  return markdownBook(files[path], path.slice(slash + 1), new Pictures(files, slash < 0 ? "" : path.slice(0, slash)));
}

/** "With 33 pictures.", or which pictures were not found, and (for a lone .md) how to bring them. */
export function picturesNote(pictures: MarkdownBook["pictures"], fromZip: boolean): string | null {
  const { used, missing } = pictures;
  const count = (n: number) => `${n} picture${n === 1 ? "" : "s"}`;
  if (!missing.length) return used ? `With ${count(used)}.` : null;
  const names = missing.slice(0, 3).join(", ") + (missing.length > 3 ? ", …" : "");
  if (!fromZip) return `${count(missing.length)} not in this file (${names}). To include them, add the .md and its pictures together as one .zip.`;
  return `${used ? `With ${count(used)}; ` : ""}${count(missing.length)} not found in the .zip (${names}).`;
}

/** Owner of a stored file, from its key (books/<owner>/…, covers/<owner>/…). */
export function fileOwner(key: string): string | null {
  const m = /^(?:books|covers|audio|images)\/([0-9a-f-]{36})\//.exec(key);
  return m ? m[1] : null;
}
