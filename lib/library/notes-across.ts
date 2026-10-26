/**
 * Notes cross between a scan and its text edition (Open unknowns row 23 (1),
 * decided by Samuel 2026-10-26: "do it now not later"). The edition is a book
 * of its own (books.edition_of), so each note stays where it was made, under
 * that book's id, with its own place (a CFI) and its quoted words: exporting
 * a book still gives its own notes only. The reader of one version is also
 * given the other's notes, each with the printed page it is on, and finds
 * the quoted words on that page itself (lib/reader/find-quote.ts).
 *
 * The page of a note on the scan is its spine step (one spine item a page).
 * The page of a note in the text edition is the page break before its quoted
 * words in the edition's own file (text-epub.ts pageMark), so notes made
 * before this change, or by an agent, have it too.
 */
import { and, eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import type { Db } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import { findLetters, lettersOf } from "@/lib/reader/find-quote";
import type { Storage } from "@/lib/storage";
import { listAnnotations, type Annotation } from "./annotations";

/** Which version a note crossed from, and the printed page it is on (from 1). */
export type Crossed = NonNullable<Annotation["crossed"]>;

/** The other version of a book: its text edition (this is the scan), or its scan (this is the edition). */
export async function otherVersion(db: Db, ownerId: string, bookId: string) {
  const [book] = await db
    .select({ id: books.id, editionOf: books.editionOf, fileKey: books.fileKey })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (!book) return null;
  if (book.editionOf) return { here: "text" as const, otherId: book.editionOf, editionKey: book.fileKey };
  const [edition] = await db
    .select({ id: books.id, fileKey: books.fileKey })
    .from(books)
    .where(and(eq(books.ownerId, ownerId), eq(books.editionOf, bookId)));
  return edition ? { here: "scan" as const, otherId: edition.id, editionKey: edition.fileKey } : null;
}

/** One spine item of a text edition: its letters, and where each page break falls in them. */
type Chapter = { letters: string; breaks: { at: number; page: number }[] };

const MARK = /<span\b[^>]*\brole="doc-pagebreak"[^>]*\bid="page-(\d+)"[^>]*>\s*<\/span>/g;

/** A text edition's spine items in reading order (the spine of its content.opf), as letters with their page breaks. */
export function editionChapters(epub: Uint8Array): Chapter[] {
  const files = unzipSync(epub);
  const text = (path: string) => (files[path] ? strFromU8(files[path]) : "");
  const opf = text("OEBPS/content.opf");
  const hrefs = new Map([...opf.matchAll(/<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  return [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map((m) => {
    const html = text(`OEBPS/${hrefs.get(m[1]) ?? ""}`).replace(/^[\s\S]*?<body[^>]*>/, "");
    const chapter: Chapter = { letters: "", breaks: [] };
    let last = 0;
    const add = (part: string) => {
      chapter.letters += lettersOf(
        part
          .replace(/<[^>]+>/g, " ")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&"),
      );
    };
    for (const b of html.matchAll(MARK)) {
      add(html.slice(last, b.index));
      chapter.breaks.push({ at: chapter.letters.length, page: Number(b[1]) });
      last = (b.index ?? 0) + b[0].length;
    }
    add(html.slice(last));
    return chapter;
  });
}

/**
 * The printed page of a note in the text edition: the last page break before
 * its quoted words in its spine item (or before the item, from the items
 * before it); with its words not found, the page the item starts on. Null
 * for a note before the first page (the edition's own "About" page).
 */
export function editionPageOf(chapters: Chapter[], cfi: string, quote: { exact: string; prefix: string }): number | null {
  const index = Number(/^epubcfi\(\/\d+\/(\d+)/.exec(cfi)?.[1] ?? NaN) / 2 - 1;
  const chapter = chapters[index];
  if (!chapter) return null;
  let page: number | null = null;
  for (const c of chapters.slice(0, index)) if (c.breaks.length) page = c.breaks[c.breaks.length - 1].page;
  const found = findLetters(chapter.letters, lettersOf(quote.exact), lettersOf(quote.prefix));
  const upTo = found ? found[0] : 0;
  for (const b of chapter.breaks) if (b.at <= upTo || (!found && page === null)) page = b.page;
  return page;
}

/** A scan's page of a note made on it: its spine step (epubcfi(/6/2) is page 1). */
const scanPageOf = (cfi: string) => Number(/^epubcfi\(\/\d+\/(\d+)/.exec(cfi)?.[1] ?? NaN) / 2;

/**
 * For the reader of `bookId`: the other version's notes on passages, each
 * with the page it is on, and the page of each of this book's own notes on
 * passages (for listing all of them in page order). Empty when the book has
 * no other version.
 */
export async function notesAcross(
  db: Db,
  storage: Storage,
  ownerId: string,
  bookId: string,
  own: Annotation[],
): Promise<{ crossed: (Annotation & { crossed: Crossed })[]; pages: Record<string, number> }> {
  const other = await otherVersion(db, ownerId, bookId);
  if (!other) return { crossed: [], pages: {} };
  const theirs = (await listAnnotations(db, ownerId, other.otherId)).filter((a) => a.targetType === "passage" && a.cfi);
  let chapters: Chapter[] | null = null;
  const editionPage = async (a: Annotation) => {
    if (!chapters) {
      const file = other.editionKey ? await storage.get(other.editionKey) : null;
      chapters = file ? editionChapters(file.data) : [];
    }
    return editionPageOf(chapters, a.cfi!, a.quote);
  };
  const pageOf = async (a: Annotation, on: "scan" | "text") => (on === "scan" ? scanPageOf(a.cfi!) : await editionPage(a));
  const there = other.here === "scan" ? "text" : "scan";
  const crossed: (Annotation & { crossed: Crossed })[] = [];
  for (const a of theirs) {
    const page = await pageOf(a, there);
    if (page && Number.isFinite(page)) crossed.push({ ...a, crossed: { from: there, page } });
  }
  const pages: Record<string, number> = {};
  for (const a of own) {
    if (a.targetType !== "passage" || !a.cfi) continue;
    const page = await pageOf(a, other.here);
    if (page && Number.isFinite(page)) pages[a.id] = page;
  }
  return { crossed: crossed.sort((x, y) => x.crossed.page - y.crossed.page), pages };
}
