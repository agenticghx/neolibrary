import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { appSettings, generations, xrayEntries, xrayFacts, xrayMentions } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { importBook } from "./import";
import { getSections } from "./sections-store";
import { backfillXrayNames, pruneXrayNames, XRAY_NAMES } from "./xray-prune";

let database: Database;
let ownerId: string;
let bookId: string;

/** The id the name finder gives an entry written these ways. */
const ownId = (aliases: string[]) => `x-${createHash("sha1").update(aliases.join("|")).digest("hex").slice(0, 12)}`;

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "jh.epub", bytes: file })).bookId;
});
afterEach(() => database.raw.close());

const ids = async () => (await database.db.select({ id: xrayEntries.id }).from(xrayEntries).where(eq(xrayEntries.bookId, bookId))).map((e) => e.id).sort();

// M41: a book's stored X-ray loses the names its finder no longer finds, without being rebuilt: what AI reading added,
// what has facts, and what was changed since stays exactly as it is.
describe("taking junk names out of a stored X-ray", () => {
  it("removes only a found entry nothing else uses, keeps the rest, and finds their mentions again", async () => {
    const before = await ids();
    expect(before.length).toBeGreaterThan(5); // made at import
    const all = await getSections(database.db, ownerId, bookId);
    const para = all.find((s) => s.kind === "paragraph" && s.text.includes("Utterson"))!;
    const gen = { id: crypto.randomUUID(), ownerId, bookId, sectionId: para.id, kind: "xray", options: {}, cacheKey: "k", provider: "anthropic", model: "m", promptName: "xray", promptHash: "h", inputHash: "i", inputTokens: 1, outputTokens: 1, costUsd: 0, output: "o", createdAt: new Date() };
    await database.db.insert(generations).values(gen);
    // As an older finder stored them: "Eq" and "III" (found, nothing else uses them), and "Eqs" with a fact on it.
    const junk = { bookId, kind: "name" as const };
    await database.db.insert(xrayEntries).values([
      { ...junk, id: ownId(["Eq"]), name: "Eq", aliases: ["Eq"] },
      { ...junk, id: ownId(["III"]), name: "III", aliases: ["III"] },
      { ...junk, id: ownId(["Eqs"]), name: "Eqs", aliases: ["Eqs"] },
      // Added by AI reading (it has its answer's id), and one changed since it was found (its id no longer matches).
      { ...junk, id: "x-from-reading", name: "Inc", aliases: ["Inc"], generationId: gen.id },
      { ...junk, id: ownId(["Jr"]), name: "Jr", aliases: ["Jr", "Junior"] },
    ]);
    await database.db.insert(xrayFacts).values({ bookId, entryId: ownId(["Eqs"]), generationId: gen.id, chapterIndex: para.chapterIndex, sectionId: para.id, position: para.position, startAt: 0, endAt: 5, fact: "A fact.", quote: para.text.slice(0, 5) });
    await database.db.delete(xrayMentions).where(eq(xrayMentions.bookId, bookId));

    expect(await pruneXrayNames(database.db, bookId)).toBe(2);
    expect(await ids()).toEqual([...before, ownId(["Eqs"]), "x-from-reading", ownId(["Jr"])].sort());
    const utterson = (await database.db.select().from(xrayEntries).where(eq(xrayEntries.bookId, bookId))).find((e) => e.aliases.includes("Utterson"))!;
    const found = await database.db.select().from(xrayMentions).where(and(eq(xrayMentions.bookId, bookId), eq(xrayMentions.entryId, utterson.id)));
    expect(found.length).toBeGreaterThan(10);
    expect(await database.db.select().from(xrayFacts).where(eq(xrayFacts.bookId, bookId))).toHaveLength(1);
    // Nothing left to take out: a second time changes nothing.
    expect(await pruneXrayNames(database.db, bookId)).toBe(0);
  });

  it("runs once at start-up over every book, and says so", async () => {
    await database.db.insert(xrayEntries).values({ bookId, id: ownId(["Eq"]), name: "Eq", kind: "name", aliases: ["Eq"] });
    expect(await backfillXrayNames(database.db)).toEqual({ books: 1, removed: 1 });
    expect(await database.db.select().from(appSettings).where(eq(appSettings.name, XRAY_NAMES))).toHaveLength(1);
    await database.db.insert(xrayEntries).values({ bookId, id: ownId(["Eq"]), name: "Eq", kind: "name", aliases: ["Eq"] });
    expect(await backfillXrayNames(database.db)).toBeNull();
    expect(await ids()).toContain(ownId(["Eq"]));
  });
});
