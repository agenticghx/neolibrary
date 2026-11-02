import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import { migrateDown, migrateUp } from "@/lib/db/migrate";
import { testDatabase } from "@/lib/db/test-db";
import { isPublicDomainEdition, OpenShelfError, setShelfSwitch } from "./open-shelf";

describe("isPublicDomainEdition", () => {
  const file = { fileKey: "books/a.epub", fileType: "epub" };
  it("trusts only public-domain publishers, as the book file names them", () => {
    expect(isPublicDomainEdition({ ...file, publisher: "Standard Ebooks" })).toBe(true);
    expect(isPublicDomainEdition({ ...file, publisher: " project gutenberg " })).toBe(true);
    expect(isPublicDomainEdition({ ...file, publisher: "Oxford University Press" })).toBe(false);
    expect(isPublicDomainEdition({ ...file, publisher: "Standard Ebooks Press" })).toBe(false);
    expect(isPublicDomainEdition({ ...file, publisher: null })).toBe(false);
  });
  it("needs a book file", () => {
    expect(isPublicDomainEdition({ fileKey: null, fileType: null, publisher: "Standard Ebooks" })).toBe(false);
  });
});

describe("setShelfSwitch", () => {
  let database: Database;
  let ownerId: string;
  beforeEach(async () => {
    database = await testDatabase();
    ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  });
  afterEach(() => database.raw.close());

  const book = async (owner: string, title: string, publisher: string | null) =>
    (
      await database.db
        .insert(books)
        .values({ ownerId: owner, title, author: "", fileKey: `books/${title}.epub`, fileType: "epub", publisher })
        .returning()
    )[0];
  const read = async (id: string) => (await database.db.select().from(books).where(eq(books.id, id)))[0];

  it("puts a new book on the shelf but not free to read", async () => {
    const b = await book(ownerId, "Any", "Penguin");
    expect([b.onShelf, b.freeToRead]).toEqual([true, false]);
  });

  it("makes a public-domain edition free to read, and refuses any other", async () => {
    const free = await book(ownerId, "Frankenstein", "Standard Ebooks");
    const paid = await book(ownerId, "Meditations", "Oxford University Press");
    await setShelfSwitch(database.db, ownerId, free.id, "freeToRead", true);
    expect((await read(free.id)).freeToRead).toBe(true);
    await expect(setShelfSwitch(database.db, ownerId, paid.id, "freeToRead", true)).rejects.toThrow(OpenShelfError);
    expect((await read(paid.id)).freeToRead).toBe(false);
  });

  it("keeps the two switches consistent: off the shelf is never free to read", async () => {
    const b = await book(ownerId, "Frankenstein", "Standard Ebooks");
    await setShelfSwitch(database.db, ownerId, b.id, "onShelf", false);
    await setShelfSwitch(database.db, ownerId, b.id, "freeToRead", true);
    expect(await read(b.id)).toMatchObject({ onShelf: true, freeToRead: true });
    await setShelfSwitch(database.db, ownerId, b.id, "onShelf", false);
    expect(await read(b.id)).toMatchObject({ onShelf: false, freeToRead: false });
  });

  it("never changes another reader's book", async () => {
    const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
    const { token } = await createInvite(database.db, admin);
    const other = await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
    const theirs = await book(other.id, "Frankenstein", "Standard Ebooks");
    await expect(setShelfSwitch(database.db, ownerId, theirs.id, "freeToRead", true)).rejects.toThrow("No such book.");
    expect((await read(theirs.id)).freeToRead).toBe(false);
  });
});

describe("migration 0036", () => {
  it("turns on only the owner's three Standard Ebooks editions, and reverses cleanly", async () => {
    const database = await testDatabase();
    try {
      const ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
      await migrateDown(database.raw, 1);
      const add = (title: string, publisher: string) =>
        database.raw.query(
          `INSERT INTO books (owner_id, title, file_key, file_type, publisher) VALUES ($1, $2, 'books/x.epub', 'epub', $3)`,
          [ownerId, title, publisher],
        );
      await add("Frankenstein", "Standard Ebooks");
      await add("The Time Machine", "Standard Ebooks");
      await add("The Strange Case of Dr. Jekyll and Mr. Hyde", "Standard Ebooks");
      await add("Frankenstein", "Penguin Classics");
      await add("Meditations on First Philosophy", "Oxford University Press");
      await migrateUp(database.raw);
      const rows = await database.db
        .select({ title: books.title, publisher: books.publisher, onShelf: books.onShelf, free: books.freeToRead })
        .from(books)
        .orderBy(books.title, books.publisher);
      expect(rows.filter((r) => r.free).map((r) => r.title)).toEqual([
        "Frankenstein",
        "The Strange Case of Dr. Jekyll and Mr. Hyde",
        "The Time Machine",
      ]);
      expect(rows.every((r) => r.onShelf)).toBe(true);
      await migrateDown(database.raw, 1);
      const cols = await database.raw.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'books' AND column_name IN ('on_shelf', 'free_to_read')`,
      );
      expect(cols).toEqual([]);
    } finally {
      await database.raw.close();
    }
  });
});
