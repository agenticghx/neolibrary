import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import { authorLine, byline, parsePaperId, PaperLookupUnreachable, type PaperLookup } from "@/lib/papers";
import { syncSharedPaper } from "./shared-papers";
import { isOwnBook } from "@/lib/library/own-book";

/**
 * M41 R3: a title in the library marked as a research paper, by its DOI or PubMed ID. Its details (title, authors,
 * journal, year, both ids) come from Crossref or PubMed, so a paper added from a file named
 * "greco1995_search_for_synergy" gets its real title. Undone with clearPaper: the title is a book again (its title
 * and author line stay as they were written).
 *
 * Who papers are for (Open unknowns row 33): as built, a paper is its reader's own, exactly like a book; nothing is
 * shared with other readers.
 */
export class PaperError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type PaperInfo = {
  kind: "book" | "paper";
  title: string;
  /** "Greco, Bravo and Parsons · 1995 · Pharmacol Rev"; "" for a book. */
  byline: string;
  doi: string | null;
  pmid: string | null;
};

async function ownBook(db: Db, ownerId: string, bookId: string) {
  const [book] = await db
    .select({ id: books.id, sharedFrom: books.sharedFrom })
    .from(books)
    .where(and(isOwnBook(bookId, ownerId), isNull(books.editionOf)));
  if (!book) throw new PaperError("Book not found", 404);
  // M41 R3c: a paper shared with this reader keeps the owner's details.
  if (book.sharedFrom) throw new PaperError("This paper is shared with you; only its owner can change its details.");
  return book;
}

/** Looks the paper up by `input` (a DOI or PubMed ID as pasted) and makes the title that paper. */
export async function setPaper(db: Db, lookup: PaperLookup, ownerId: string, bookId: string, input: unknown): Promise<PaperInfo> {
  await ownBook(db, ownerId, bookId);
  const id = typeof input === "string" ? parsePaperId(input) : null;
  if (!id) throw new PaperError("That is not a DOI (10.…) or a PubMed ID (digits).");
  let found;
  try {
    found = await lookup.find(id);
  } catch (e) {
    if (e instanceof PaperLookupUnreachable) throw new PaperError(e.message, 503);
    throw e;
  }
  if (!found) throw new PaperError("doi" in id ? "Crossref has no paper with that DOI." : "PubMed has no paper with that ID.", 404);
  await db
    .update(books)
    .set({
      kind: "paper",
      title: found.title,
      author: authorLine(found.authors),
      authors: found.authors,
      journal: found.journal,
      year: found.year,
      doi: found.doi,
      pmid: found.pmid,
      updatedAt: new Date(),
    })
    .where(eq(books.id, bookId));
  // M41 R3c: the owner's paper goes to every invited reader (a reader's own paper is shared with no one).
  await syncSharedPaper(db, bookId);
  return { kind: "paper", title: found.title, byline: byline(found), doi: found.doi, pmid: found.pmid };
}

/** The title is a book again: its paper details are dropped. */
export async function clearPaper(db: Db, ownerId: string, bookId: string): Promise<PaperInfo> {
  await ownBook(db, ownerId, bookId);
  const [b] = await db
    .update(books)
    .set({ kind: "book", authors: [], journal: null, year: null, doi: null, pmid: null, updatedAt: new Date() })
    .where(eq(books.id, bookId))
    .returning({ title: books.title });
  // No longer a paper: the readers' copies are hidden.
  await syncSharedPaper(db, bookId);
  return { kind: "book", title: b.title, byline: "", doi: null, pmid: null };
}
