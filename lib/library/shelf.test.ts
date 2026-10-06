import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { audioTracks, books, readalongImports } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import {
  collectionsForBook,
  createCollection,
  deleteCollection,
  listCollections,
  listShelf,
  parseShow,
  parseSort,
  setInCollection,
} from "./shelf";

let database: Database;
let ownerId: string;
const ids: Record<string, string> = {};

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const rows: [string, string, number, string | null][] = [
    ["Frankenstein", "Mary Shelley", 0.5, "books/x/a.epub"],
    ["the Time Machine", "H. G. Wells", 0.1, "books/x/b.epub"],
    ["Dracula", "Bram Stoker", 1, "books/x/c.epub"],
    ["Wanted only", "Nobody", 0, null],
  ];
  for (const [i, [title, author, progress, fileKey]] of rows.entries()) {
    const [b] = await database.db
      .insert(books)
      .values({ ownerId, title, author, progress, fileKey, fileType: fileKey ? "epub" : null, updatedAt: new Date(2026, 0, i + 1) })
      .returning();
    ids[title] = b.id;
  }
});
afterEach(() => database.raw.close());

const titles = async (opts: Parameters<typeof listShelf>[2]) =>
  (await listShelf(database.db, ownerId, opts)).map((b) => b.title);

describe("shelf", () => {
  it("lists only books with a file, in each sort order", async () => {
    expect(await titles({ sort: "recent" })).toEqual(["Dracula", "the Time Machine", "Frankenstein"]);
    expect(await titles({ sort: "title" })).toEqual(["Dracula", "Frankenstein", "the Time Machine"]);
    expect(await titles({ sort: "author" })).toEqual(["Dracula", "the Time Machine", "Frankenstein"]);
    expect(await titles({ sort: "progress" })).toEqual(["Dracula", "Frankenstein", "the Time Machine"]);
    expect(parseSort("nonsense")).toBe("recent");
  });

  it("searches title and author, case-insensitively, treating % and _ literally", async () => {
    expect(await titles({ q: "time" })).toEqual(["the Time Machine"]);
    expect(await titles({ q: "SHELLEY" })).toEqual(["Frankenstein"]);
    expect(await titles({ q: "%" })).toEqual([]);
  });
});

describe("filters (M14 D5)", () => {
  it("show exactly their titles; All is unchanged", async () => {
    const add = async (title: string, values: Partial<typeof books.$inferInsert>) =>
      (await database.db.insert(books).values({ ownerId, title, author: "", fileKey: `books/x/${title}`, fileType: "epub", ...values }).returning())[0].id;
    // Beside the fixtures above (Frankenstein 0.5, the Time Machine 0.1, Dracula 1, a title with no file):
    await add("Never opened", { progress: 0 });
    await add("Opened, still at 0%", { progress: 0, lastOpenedAt: new Date() });
    await add("Almost done", { progress: 0.999, lastOpenedAt: new Date() });
    await add("A PDF", { fileType: "pdf", progress: 0 });
    const withAudiobook = await add("With an audiobook", { progress: 0.2, lastOpenedAt: new Date() });
    const narratedOnly = await add("Narrated only", { progress: 0.3, lastOpenedAt: new Date() });
    await database.db.insert(readalongImports).values({ ownerId, bookId: withAudiobook, status: "ready", manifest: {}, report: { chapters: [], paragraphs: 0 }, audio: [] });
    const uploading = await add("Audiobook still uploading", { progress: 0.4, lastOpenedAt: new Date() });
    await database.db.insert(readalongImports).values({ ownerId, bookId: uploading, status: "uploading", manifest: {}, report: { chapters: [], paragraphs: 0 }, audio: [] });
    await database.db.insert(audioTracks).values({ ownerId, bookId: narratedOnly, sectionId: "s1", source: "tts", voice: "v", cacheKey: "k", inputHash: "h", audioKey: "a", mime: "audio/mpeg", durationMs: 1, words: [] });

    const shown = async (show: string) => (await titles({ show: parseShow(show), sort: "title" })).sort();
    expect(await shown("want")).toEqual(["A PDF", "Never opened"]);
    expect(await shown("finished")).toEqual(["Dracula"]);
    expect(await shown("books")).toEqual(
      ["Almost done", "Audiobook still uploading", "Dracula", "Frankenstein", "Narrated only", "Never opened", "Opened, still at 0%", "With an audiobook", "the Time Machine"].sort(),
    );
    expect(await shown("pdfs")).toEqual(["A PDF"]);
    expect(await shown("audiobooks")).toEqual(["With an audiobook"]);
    // All: every book with a file, as before the filters existed.
    expect((await shown("all")).length).toBe(3 + 7);
    expect(await shown("nonsense")).toEqual(await shown("all"));
    expect(parseShow("want")).toBe("want");
  });
});

describe("collections", () => {
  it("group books, count them, filter the shelf and can be deleted", async () => {
    const gothic = await createCollection(database.db, ownerId, "  Gothic   novels ");
    expect(gothic.name).toBe("Gothic novels");
    await setInCollection(database.db, ownerId, gothic.id, ids["Frankenstein"], true);
    await setInCollection(database.db, ownerId, gothic.id, ids["Dracula"], true);
    await setInCollection(database.db, ownerId, gothic.id, ids["Dracula"], true); // twice is fine
    expect(await listCollections(database.db, ownerId)).toEqual([{ id: gothic.id, name: "Gothic novels", count: 2 }]);
    expect(await titles({ collectionId: gothic.id, sort: "title" })).toEqual(["Dracula", "Frankenstein"]);
    expect((await collectionsForBook(database.db, ownerId, ids["Dracula"]))[0].inside).toBe(true);

    await setInCollection(database.db, ownerId, gothic.id, ids["Dracula"], false);
    expect(await titles({ collectionId: gothic.id })).toEqual(["Frankenstein"]);

    await expect(createCollection(database.db, ownerId, "gothic novels".replace("g", "G").replace("n", "n"))).rejects.toThrow(
      "already have",
    );
    await expect(createCollection(database.db, ownerId, "   ")).rejects.toThrow("name");

    await deleteCollection(database.db, ownerId, gothic.id);
    expect(await listCollections(database.db, ownerId)).toEqual([]);
    expect(await database.db.select().from(books).where(eq(books.id, ids["Frankenstein"]))).toHaveLength(1);
  });

  it("belong to one person only", async () => {
    const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
    const { token } = await createInvite(database.db, admin);
    const other = await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
    const mine = await createCollection(database.db, ownerId, "Mine");
    await expect(setInCollection(database.db, other.id, mine.id, ids["Dracula"], true)).rejects.toThrow("Not found");
    await deleteCollection(database.db, other.id, mine.id);
    expect(await listCollections(database.db, ownerId)).toHaveLength(1);
    expect(await listShelf(database.db, other.id, { collectionId: mine.id })).toEqual([]);
  });
});
