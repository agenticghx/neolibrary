import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import { books } from "@/lib/db/schema";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { FAKE_DRIVE, FakeDrive } from "@/lib/drive/fake";
import { MemoryStorage } from "@/lib/storage";
import { importFromDrive } from "./drive-import";
import { getBook } from "./paths";

let database: Database;
let ctx: Parameters<typeof importFromDrive>[0];
let ownerId: string;
beforeEach(async () => {
  database = await testDatabase();
  ctx = { db: database.db, storage: new MemoryStorage(), drive: new FakeDrive() };
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

const link = (kind: "file" | "folder", id: string) =>
  kind === "file" ? `https://drive.google.com/file/d/${id}/view?usp=sharing` : `https://drive.google.com/drive/folders/${id}?usp=sharing`;

describe("adding books from Google Drive (M30)", () => {
  it("adds every book in a shared folder, as uploads, and lists the other files as skipped", async () => {
    const out = await importFromDrive(ctx, ownerId, link("folder", FAKE_DRIVE.folder));
    expect(out.map((o) => [o.file, o.status])).toEqual([
      ["a-drive-book.epub", "added"],
      ["drive-notes.md", "added"],
      ["shopping-list.txt", "error"],
    ]);
    const added = out.filter((o) => o.status === "added") as { bookId: string }[];
    const first = (await getBook(database.db, ownerId, added[0].bookId, true))!;
    expect(first.book).toMatchObject({ title: "A Book From Drive", author: "Dee Rive", fileType: "epub", fileName: "a-drive-book.epub" });
    expect((await getBook(database.db, ownerId, added[1].bookId, true))!.book).toMatchObject({ title: "Drive Notes", fileType: "epub" });
    // The same folder again: already in the library.
    const again = await importFromDrive(ctx, ownerId, link("folder", FAKE_DRIVE.folder));
    expect(again.filter((o) => o.status !== "error").map((o) => o.status)).toEqual(["duplicate", "duplicate"]);
  });

  it("adds one shared file, attaching it to the title waiting for it", async () => {
    const [waiting] = await database.db.insert(books).values({ ownerId, title: "A Book From Drive", author: "Dee Rive" }).returning();
    const out = await importFromDrive(ctx, ownerId, link("file", FAKE_DRIVE.book));
    expect(out).toEqual([expect.objectContaining({ file: "a-drive-book.epub", status: "attached", bookId: waiting.id })]);
  });

  it("explains a link that is not Drive's, a file not shared, a file that is not a book, and a folder for one title", async () => {
    await expect(importFromDrive(ctx, ownerId, "https://example.org/book.pdf")).rejects.toThrow("Paste a Google Drive link");
    await expect(importFromDrive(ctx, ownerId, 42)).rejects.toThrow("Paste a Google Drive link");
    expect(await importFromDrive(ctx, ownerId, link("file", FAKE_DRIVE.private))).toEqual([
      { file: "Google Drive file", status: "error", message: expect.stringContaining("Anyone with the link") },
    ]);
    expect(await importFromDrive(ctx, ownerId, link("file", FAKE_DRIVE.notes))).toEqual([
      { file: "shopping-list.txt", status: "error", message: "Only EPUB, PDF and Markdown (.md) files can be added." },
    ]);
    await expect(importFromDrive(ctx, ownerId, link("folder", FAKE_DRIVE.private))).rejects.toThrow("Anyone with the link");
    const [title] = await database.db.insert(books).values({ ownerId, title: "Some Title", author: "" }).returning();
    await expect(importFromDrive(ctx, ownerId, link("folder", FAKE_DRIVE.folder), { attachTo: title.id })).rejects.toThrow("Choose one file for a title");
    expect(await database.db.select().from(books)).toHaveLength(1);
  });
});
