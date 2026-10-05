import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books, readalongImports } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { createAnnotation, deleteAnnotation, updateAnnotation } from "./annotations";
import { bookIdsWithNotes, continueBooks, latestNotes, notYetAvailable } from "./home";
import { importBook } from "./import";
import { getSections } from "./sections-store";

let database: Database;
let ownerId: string;
let otherId: string;
beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
  const { token } = await createInvite(database.db, admin);
  otherId = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 12, minute));
const add = async (owner: string, title: string, values: Partial<typeof books.$inferInsert> = {}) =>
  (
    await database.db
      .insert(books)
      .values({ ownerId: owner, title, author: "", fileKey: `books/${title}.epub`, fileType: "epub", ...values })
      .returning()
  )[0].id;

describe("continueBooks", () => {
  it("lists books opened before and not finished, newest opened first", async () => {
    const older = await add(ownerId, "Older", { lastOpenedAt: at(1), progress: 0.3 });
    const newer = await add(ownerId, "Newer", { lastOpenedAt: at(5), progress: 0.1 });
    await add(ownerId, "Finished", { lastOpenedAt: at(9), progress: 1 });
    await add(ownerId, "Never opened", { progress: 0 });
    await add(ownerId, "Deleted", { lastOpenedAt: at(8), deletedAt: at(8) });
    await add(ownerId, "Title only", { lastOpenedAt: at(7), fileKey: null, fileType: null });
    await add(otherId, "Someone else's", { lastOpenedAt: at(9) });
    expect((await continueBooks(database.db, ownerId)).map((b) => b.id)).toEqual([newer, older]);
    expect((await continueBooks(database.db, ownerId, 1)).map((b) => b.id)).toEqual([newer]);
  });
});

describe("latestNotes", () => {
  let bookId: string;
  let paras: { cfi: string; text: string }[];
  beforeEach(async () => {
    const bytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
    bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "j.epub", bytes })).bookId;
    paras = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph");
  });
  const rangeIn = (p: { cfi: string }, from: number, to: number) => p.cfi.replace(/\)$/, `,/1:${from},/1:${to})`);

  it("picks the newest note, voice note or highlight by when it last changed", async () => {
    const early = await createAnnotation(database.db, ownerId, { kind: "note", bookId, body: "First thought" }, at(1));
    const highlight = await createAnnotation(
      database.db,
      ownerId,
      { kind: "highlight", bookId, cfi: rangeIn(paras[3], 0, 5), quote: { exact: paras[3].text.slice(0, 5) } },
      at(2),
    );
    expect((await latestNotes(database.db, ownerId, [bookId])).get(bookId)!.id).toBe(highlight.id);

    // A later version of the older note makes it the newest.
    await updateAnnotation(database.db, ownerId, early.id, { body: "First thought, revised" }, at(3));
    const newest = (await latestNotes(database.db, ownerId, [bookId])).get(bookId)!;
    expect([newest.id, newest.body]).toEqual([early.id, "First thought, revised"]);

    // Bookmarks are not shown; a deleted note is skipped.
    await createAnnotation(database.db, ownerId, { kind: "bookmark", bookId, cfi: paras[5].cfi }, at(4));
    expect((await latestNotes(database.db, ownerId, [bookId])).get(bookId)!.id).toBe(early.id);
    await deleteAnnotation(database.db, ownerId, early.id, at(5));
    expect((await latestNotes(database.db, ownerId, [bookId])).get(bookId)!.id).toBe(highlight.id);
  });

  it("marks books with live marks for the folded corner, not bookmarks or deleted notes", async () => {
    const noted = await add(ownerId, "Noted");
    const cleared = await add(ownerId, "Cleared");
    const theirs = await add(otherId, "Theirs");
    await createAnnotation(database.db, ownerId, { kind: "bookmark", bookId, cfi: paras[5].cfi });
    await createAnnotation(database.db, ownerId, { kind: "note", bookId: noted, body: "A note" });
    const gone = await createAnnotation(database.db, ownerId, { kind: "note", bookId: cleared, body: "Soon gone" });
    await deleteAnnotation(database.db, ownerId, gone.id);
    await createAnnotation(database.db, otherId, { kind: "note", bookId: theirs, body: "Theirs" });
    expect([...(await bookIdsWithNotes(database.db, ownerId))]).toEqual([noted]);
  });

  it("leaves out books with no notes, and other readers' notes", async () => {
    const empty = await add(ownerId, "Empty");
    const mine = await latestNotes(database.db, ownerId, [bookId, empty]);
    expect([...mine.keys()]).toEqual([]);
    await createAnnotation(database.db, ownerId, { kind: "note", bookId, body: "Mine" }, at(1));
    expect((await latestNotes(database.db, otherId, [bookId])).size).toBe(0);
  });
});

describe("notYetAvailable", () => {
  it("lists titles with no file and no finished audiobook, by title", async () => {
    await add(ownerId, "Has a file");
    const zebra = await add(ownerId, "zebra waits", { fileKey: null, fileType: null });
    const apple = await add(ownerId, "Apple waits", { fileKey: null, fileType: null });
    await add(ownerId, "Deleted waiting", { fileKey: null, fileType: null, deletedAt: at(1) });
    const uploading = await add(ownerId, "Audio still uploading", { fileKey: null, fileType: null });
    const listenOnly = await add(ownerId, "Listen only", { fileKey: null, fileType: null });
    await add(otherId, "Someone else's", { fileKey: null, fileType: null });
    const audiobook = (bookId: string, status: "uploading" | "ready") =>
      database.db.insert(readalongImports).values({ ownerId, bookId, status, manifest: {}, report: { chapters: [], paragraphs: 0 }, audio: [] });
    await audiobook(uploading, "uploading");
    await audiobook(listenOnly, "ready");
    expect((await notYetAvailable(database.db, ownerId)).map((b) => b.id)).toEqual([apple, uploading, zebra]);
  });
});
