import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { FakePapers } from "@/lib/papers/fake";
import { PaperLookupUnreachable } from "@/lib/papers/model";
import { MemoryStorage } from "@/lib/storage";
import { findMissingCovers } from "./cover-lookup";
import { libraryItems } from "./home";
import { importBook } from "./import";
import { clearPaper, PaperError, setPaper } from "./papers";
import { listShelf } from "./shelf";
import { readableEpub } from "./test-epub";

// M41 R3: a title marked as a research paper by its DOI or PubMed ID. Invented book text; the Greco details are real.
let database: Database;
let storage: MemoryStorage;
let ownerId: string;
let bookId: string;

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const epub = readableEpub("Greco1995 Search For Synergy", ["<h1>Results</h1><p>The effect falls as the dose rises.</p>"], "");
  bookId = (await importBook(database.db, storage, ownerId, { name: "greco1995_search_for_synergy.epub", bytes: epub })).bookId;
});
afterEach(() => database.raw.close());

describe("marking a title as a paper (M41 R3)", () => {
  it("fills in the real title, the author line and the details from its PubMed ID", async () => {
    const info = await setPaper(database.db, new FakePapers(), ownerId, bookId, "PMID 7568331");
    expect(info).toEqual({
      kind: "paper",
      title: "The search for synergy: a critical review from a response surface perspective",
      byline: "Greco, Bravo and Parsons · 1995 · Pharmacol Rev",
      doi: "10.1016/s0031-6997(25)06847-4",
      pmid: "7568331",
    });
    const [b] = await database.db.select().from(books).where(eq(books.id, bookId));
    expect(b).toMatchObject({ kind: "paper", author: "Greco, Bravo and Parsons", journal: "Pharmacol Rev", year: 1995 });
    expect(b.authors).toHaveLength(3);
  });

  it("lists it under Papers and in Books, with its card line; a book has none", async () => {
    const other = (await importBook(database.db, storage, ownerId, { name: "lamps.epub", bytes: readableEpub("Eight Lamps", ["<p>Lamp one.</p>"], "Iris Wick") })).bookId;
    await setPaper(database.db, new FakePapers(), ownerId, bookId, "10.1016/S0031-6997(25)06847-4");
    expect((await listShelf(database.db, ownerId, { show: "papers" })).map((b) => b.id)).toEqual([bookId]);
    expect((await listShelf(database.db, ownerId, { show: "all" })).map((b) => b.id).sort()).toEqual([bookId, other].sort());
    const items = await libraryItems(database.db, ownerId, await listShelf(database.db, ownerId));
    expect(items.find((i) => i.id === bookId)?.paper).toBe("Greco, Bravo and Parsons · 1995 · Pharmacol Rev");
    expect(items.find((i) => i.id === other)?.paper).toBeNull();
  });

  it("is a book again after 'This is not a paper', keeping its title", async () => {
    await setPaper(database.db, new FakePapers(), ownerId, bookId, "7568331");
    expect(await clearPaper(database.db, ownerId, bookId)).toMatchObject({ kind: "book", title: "The search for synergy: a critical review from a response surface perspective" });
    const [b] = await database.db.select().from(books).where(eq(books.id, bookId));
    expect(b).toMatchObject({ kind: "book", authors: [], journal: null, year: null, doi: null, pmid: null });
    expect(await listShelf(database.db, ownerId, { show: "papers" })).toEqual([]);
  });

  it("refuses an id that is neither, one no catalogue has, another reader's book, and says when a catalogue is down", async () => {
    await expect(setPaper(database.db, new FakePapers(), ownerId, bookId, "synergy")).rejects.toThrow(new PaperError("That is not a DOI (10.…) or a PubMed ID (digits)."));
    await expect(setPaper(database.db, new FakePapers(), ownerId, bookId, "10.5555/none")).rejects.toThrow("Crossref has no paper with that DOI.");
    await expect(setPaper(database.db, new FakePapers(), ownerId, bookId, "999")).rejects.toThrow("PubMed has no paper with that ID.");
    const stranger = "00000000-0000-4000-8000-000000000000";
    await expect(setPaper(database.db, new FakePapers(), stranger, bookId, "7568331")).rejects.toMatchObject({ status: 404 });
    const down = { find: async () => Promise.reject(new PaperLookupUnreachable("PubMed")) };
    await expect(setPaper(database.db, down, ownerId, bookId, "7568331")).rejects.toMatchObject({ status: 503, message: "PubMed could not be reached. Try again in a minute." });
    const [b] = await database.db.select({ kind: books.kind }).from(books).where(eq(books.id, bookId));
    expect(b.kind).toBe("book");
  });

  it("is not looked up in the book-cover catalogues", async () => {
    await setPaper(database.db, new FakePapers(), ownerId, bookId, "7568331");
    const asked: string[] = [];
    const source = {
      find: async (q: { title: string }) => {
        asked.push(q.title);
        return [];
      },
    };
    await findMissingCovers(database.db, storage, { name: "stand-in", ...source } as never, { force: true });
    expect(asked).not.toContain("The search for synergy: a critical review from a response surface perspective");
  });
});
