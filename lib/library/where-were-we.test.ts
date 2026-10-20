import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { AiNotConfigured } from "@/lib/ai/model";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { explainBack } from "./explain-back";
import { importBook } from "./import";
import { recordReading } from "./reading-stats";
import { getSections } from "./sections-store";
import { whereWereWe } from "./where-were-we";

let database: Database;
let ownerId: string;
let bookId: string;
let chapter: { id: string; label: string };

const at = (iso: string) => new Date(iso);
const TODAY = at("2026-10-20T09:00:00Z");
const summary = "Utterson hears of a door, a cruel man called Hyde, and a cheque signed by someone else.";

/** A sitting with the book that began at `when`. */
const sitting = (when: Date, activeSeconds = 600) =>
  recordReading(database.db, ownerId, { sessionId: crypto.randomUUID(), bookId, startedAt: when.toISOString(), activeSeconds, words: 2000, pages: 5 }, when);

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const bytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "j.epub", bytes })).bookId;
  const all = await getSections(database.db, ownerId, bookId);
  // The place saved: a paragraph some way into the book, and its chapter.
  const paragraph = all.filter((s) => s.kind === "paragraph")[40];
  const c = all.find((s) => s.kind === "chapter" && s.chapterIndex === paragraph.chapterIndex)!;
  chapter = { id: c.id, label: c.label };
  await database.db.update(books).set({ position: paragraph.cfi }).where(eq(books.id, bookId));
});
afterEach(() => database.raw.close());

describe("Where were we? (M28 S3)", () => {
  it("asks about the chapter at the saved place when the last sitting began on an earlier day", async () => {
    expect(await whereWereWe(database.db, ownerId, bookId, TODAY)).toBeNull(); // never read: nothing to remember
    await sitting(at("2026-10-19T21:00:00Z"));
    expect(await whereWereWe(database.db, ownerId, bookId, TODAY)).toEqual({ chapterId: chapter.id, label: chapter.label, lastReadAt: "2026-10-19T21:00:00.000Z" });
    // Opened today for half a minute (every opening records a sitting): still asked.
    await sitting(at("2026-10-20T07:00:00Z"), 30);
    expect(await whereWereWe(database.db, ownerId, bookId, TODAY)).toMatchObject({ chapterId: chapter.id });
    // Read today for a minute or more: not asked again today.
    await sitting(at("2026-10-20T08:00:00Z"), 60);
    expect(await whereWereWe(database.db, ownerId, bookId, TODAY)).toBeNull();
    // Tomorrow, it is.
    expect(await whereWereWe(database.db, ownerId, bookId, at("2026-10-21T07:00:00Z"))).toMatchObject({ chapterId: chapter.id });
  });

  it("does not ask with no saved place, nor another reader, nor about a chapter already explained back", async () => {
    await sitting(at("2026-10-18T10:00:00Z"));
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const otherId = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
    expect(await whereWereWe(database.db, otherId, bookId, TODAY)).toBeNull();

    await explainBack(database.db, new FakeModel(), ownerId, { bookId, chapterId: chapter.id, summary });
    expect(await whereWereWe(database.db, ownerId, bookId, TODAY)).toBeNull();

    await database.db.update(books).set({ position: null }).where(eq(books.id, bookId));
    expect(await whereWereWe(database.db, ownerId, bookId, TODAY)).toBeNull();
  });

  it("a summary saved when Claude could not answer counts as explained back, so it is not asked for twice", async () => {
    await sitting(at("2026-10-18T10:00:00Z"));
    const out = await explainBack(
      database.db,
      () => {
        throw new AiNotConfigured("No AI key.");
      },
      ownerId,
      { bookId, chapterId: chapter.id, summary },
    );
    expect(out.note).not.toBeNull();
    expect(out.attempt).toBeNull();
    expect(await whereWereWe(database.db, ownerId, bookId, TODAY)).toBeNull();
  });
});
