import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { genealogyEvents, genealogyLinks, generations } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { parseEpub } from "./ebook";
import { genealogyPromptHash, genealogyStatus, readGenealogy, saveGenealogy, type GenealogySend, type SentLink } from "./genealogy-store";
import { importBook } from "./import";
import { extractSections } from "./sections";

let database: Database;
let ownerId: string;
let bookId: string;
const bytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
// The paragraphs as the skill splits the file on the laptop (scripts/genealogy-on-subscription.ts), not as the server stored them.
const laptop = extractSections(bytes, parseEpub(bytes).toc as { label: string; href: string }[]).filter((s) => s.kind === "paragraph" && s.text.length > 200);
const para = (word: string) => laptop.find((p) => p.text.includes(word))!;
const words = (p: { text: string }, n = 8) => p.text.split(" ").slice(0, n).join(" ");

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  ({ bookId } = await importBook(database.db, new MemoryStorage(), ownerId, { name: "jekyll.epub", bytes }));
});
afterEach(() => database.raw.close());

async function send(links: SentLink[], lives: GenealogySend["lives"] = {}, extra: Partial<GenealogySend> = {}) {
  return saveGenealogy(database.db, ownerId, bookId, { model: "claude-sonnet-5-5", promptHash: await genealogyPromptHash(), links, lives, ...extra });
}
const utterson = (): SentLink => {
  const p = para("Utterson");
  return { from: "Gabriel John Utterson", from_kind: "person", to: "Richard Enfield", to_kind: "person", relation: "family", role: "kinsman", paragraph: p.id, quote: words(p), check: "holds" };
};

describe("a book's genealogy stored on the site (M43 S2)", () => {
  it("finds every quote by the paragraph ids the skill made on the laptop: the two splittings agree", async () => {
    const sample = laptop.filter((_, i) => i % 7 === 0).slice(0, 12);
    const links: SentLink[] = sample.map((p) => ({ ...utterson(), paragraph: p.id, quote: words(p, 6) }));
    const saved = await send(links);
    expect(saved.dropped).toEqual({});
    expect(saved.links).toBe(sample.length);
    const stored = await database.db.select().from(genealogyLinks).where(eq(genealogyLinks.bookId, bookId));
    expect(stored.map((l) => l.sectionId)).toEqual(sample.map((p) => p.id));
    expect(stored.every((l) => l.endAt > l.startAt && l.quote.length > 0)).toBe(true);
  });

  it("leaves out what it cannot find in its own copy of the book, and keeps a link without a year whose words are not found", async () => {
    const p = para("Utterson");
    const links: SentLink[] = [
      utterson(),
      { ...utterson(), quote: "words that are nowhere in this book at all" },
      { ...utterson(), paragraph: "no-such-paragraph" },
      { ...utterson(), relation: "descended_from" },
      { ...utterson(), date: { year: 1885, paragraph: p.id, quote: "In the year 1885" } },
      { ...utterson(), removed: true, check: null, why: "Not said." },
    ];
    const saved = await send(links);
    expect(saved.dropped).toEqual({ "quote not in its paragraph": 1, "paragraph not in this book": 1, "names, kinds or relation not known": 1, "year's words not in their paragraph": 1 });
    expect([saved.links, saved.removed]).toEqual([2, 1]);
    const stored = await database.db.select().from(genealogyLinks).where(eq(genealogyLinks.bookId, bookId));
    expect(stored.map((l) => [l.ord, l.removed, l.dateYear])).toEqual([
      [0, false, null],
      [4, false, null],
      [5, true, null],
    ]);
  });

  it("stores life events by the links they rest on, takes away a year with no dated link, and keeps general-knowledge years apart", async () => {
    const p = para("Utterson");
    const dated = { ...utterson(), date: { year: 1886, paragraph: p.id, quote: words(p, 4) } };
    const saved = await send([utterson(), dated, { ...utterson(), removed: true }], {
      "Gabriel John Utterson": [
        { what: "family", with: "Richard Enfield", links: [0, 1], start_year: 1886, date_links: [1], basis: "stated", gk: { start_year: 1850, confidence: "high", note: null } },
        { what: "friend", with: "Henry Jekyll", links: [0], start_year: 1870, basis: "stated", order: { paragraph: p.id, quote: words(p, 5) } },
        { what: "friend", with: "Hastie Lanyon", links: [2], basis: "ordered" },
        { what: "friend", with: "Poole", links: [0], basis: "ordered", order: { paragraph: p.id, quote: "not in the paragraph" } },
      ],
    });
    expect(saved.dropped).toEqual({ "life event with none of its links": 1, "life event's year with no dated link": 1, "order quote not in its paragraph": 1 });
    const ev = await database.db.select().from(genealogyEvents).where(eq(genealogyEvents.bookId, bookId));
    expect(ev.map((e) => [e.ord, e.withName, e.startYear, e.basis, e.gkStartYear, e.gkConfidence, e.orderQuote !== null])).toEqual([
      [0, "Richard Enfield", 1886, "stated", 1850, "high", false],
      [1, "Henry Jekyll", null, "unknown", null, null, true],
      [2, "Poole", null, "unknown", null, null, false],
    ]);
  });

  it("stores nothing for the same send again, and replaces the book's rows for a new one", async () => {
    const first = await send([utterson()], { "Gabriel John Utterson": [{ what: "family", with: "Richard Enfield", links: [0], basis: "unknown" }] });
    const again = await send([utterson()], { "Gabriel John Utterson": [{ what: "family", with: "Richard Enfield", links: [0], basis: "unknown" }] });
    expect(again).toMatchObject({ unchanged: true, generationId: first.generationId, links: 1, events: 1 });
    const kinds = () => database.db.select({ id: generations.id }).from(generations).where(and(eq(generations.bookId, bookId), eq(generations.kind, "genealogy")));
    expect(await kinds()).toHaveLength(1);
    const next = await send([utterson(), { ...utterson(), relation: "friend" }]);
    expect(next.generationId).not.toBe(first.generationId);
    expect(await kinds()).toHaveLength(2);
    const now = await readGenealogy(database.db, ownerId, bookId);
    expect([now!.links.length, now!.events.length, now!.status.generationId]).toEqual([2, 0, next.generationId]);
    expect(await genealogyStatus(database.db, ownerId, bookId)).toMatchObject({ links: 2, events: 0, people: 0 });
  });

  it("refuses answers read with other instructions, and another reader's book", async () => {
    await expect(send([utterson()], {}, { promptHash: "0".repeat(64) })).rejects.toThrow("other instructions");
    const other = (await createFirstAdmin(database.db, { email: "x@example.com", name: "X", password: "long enough pw" }).catch(() => null))?.id;
    await expect(saveGenealogy(database.db, other ?? "00000000-0000-0000-0000-000000000000", bookId, { model: "claude-sonnet-5-5", promptHash: await genealogyPromptHash(), links: [], lives: {} })).rejects.toThrow("not found");
  });
});
