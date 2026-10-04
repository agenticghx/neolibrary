import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin, createInvite, acceptInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { getBook } from "./paths";
import { isCfi, savePosition } from "./reading";

let database: Database;
let ownerId: string;
let bookId: string;
beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  bookId = (await database.db.insert(books).values({ ownerId, title: "T", fileKey: "books/x/t.epub", fileType: "epub" }).returning())[0].id;
});
afterEach(() => database.raw.close());

describe("reading position", () => {
  it("accepts well-formed CFIs only", () => {
    expect(isCfi("epubcfi(/6/4!/4/2/1:0)")).toBe(true);
    expect(isCfi("epubcfi(/6/14[chap05ref]!/4[body01]/10/2/1:3[2^[1^]])")).toBe(true);
    expect(isCfi('epubcfi(/6/4"><script>)')).toBe(false);
    expect(isCfi("epubcfi(/6/4[chapter-1]!/4/2,/1:0,/1:12)")).toBe(true);
    expect(isCfi("javascript:alert(1)")).toBe(false);
    expect(isCfi("x".repeat(600))).toBe(false);
  });

  it("saves position and progress for the owner only", async () => {
    const t = new Date("2026-10-04T10:00:00Z");
    expect(await savePosition(database.db, ownerId, bookId, { cfi: "epubcfi(/6/8!/4/2/1:0)", fraction: 0.3333 }, t)).toBe(true);
    const { book } = (await getBook(database.db, ownerId, bookId))!;
    expect(book).toMatchObject({ position: "epubcfi(/6/8!/4/2/1:0)", progress: 0.333, lastOpenedAt: t });

    const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
    const { token } = await createInvite(database.db, admin);
    const other = await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
    expect(await savePosition(database.db, other.id, bookId, { cfi: "epubcfi(/6/2!/4)", fraction: 0.1 })).toBe(false);
    expect(await savePosition(database.db, ownerId, bookId, { cfi: "epubcfi(/6/2!/4)", fraction: 2 })).toBe(false);
    expect(await savePosition(database.db, ownerId, "not-a-uuid", { cfi: "epubcfi(/6/2!/4)", fraction: 0.1 })).toBe(false);
  });
});
