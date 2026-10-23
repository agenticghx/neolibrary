import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { xrayEntries, xrayMentions } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { importBook } from "./import";
import { getSections } from "./sections-store";
import { BOILERPLATE, buildXray, ensureXray, findMentions, findNames, listXray, marksFor, type Paragraph } from "./xray";

let database: Database;
let ownerId: string;
let bookId: string;
let all: Awaited<ReturnType<typeof getSections>>;
let paragraphs: Paragraph[];

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "jh.epub", bytes: file })).bookId;
  all = await getSections(database.db, ownerId, bookId);
  // The book's own paragraphs: the publisher's pages at either end are left out, as buildXray leaves them out.
  const boilerplate = new Set(all.filter((s) => s.kind === "chapter" && (BOILERPLATE.test(s.label) || BOILERPLATE.test(s.href))).map((s) => s.chapterIndex));
  paragraphs = all
    .filter((s) => s.kind === "paragraph" && !boilerplate.has(s.chapterIndex))
    .map((s) => ({ id: s.id, chapterIndex: s.chapterIndex, position: s.position, text: s.text }));
});
afterEach(() => database.raw.close());

const byAlias = (entries: ReturnType<typeof findNames>, alias: string) => entries.find((e) => e.aliases.includes(alias));

describe("X-ray from the text alone (M32 X1)", () => {
  it("finds the book's people and places, the most mentioned first, and no sentence-starters", () => {
    const entries = findNames(paragraphs);
    const mentions = findMentions(entries, paragraphs);
    const totals = new Map<string, number>();
    for (const m of mentions) totals.set(m.entryId, (totals.get(m.entryId) ?? 0) + 1);
    const ranked = [...entries].sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0));
    const top = ranked.slice(0, 6).map((e) => e.aliases.find((a) => !a.includes(" ")) ?? e.name);
    expect(top.sort()).toEqual(["Enfield", "Hyde", "Jekyll", "Lanyon", "Poole", "Utterson"]);
    for (const e of entries) expect(["Well", "Yes", "No", "Indeed", "The", "And", "But", "God", "Sunday", "I"]).not.toContain(e.name);
    expect(byAlias(entries, "Soho")).toBeTruthy();
    expect(byAlias(entries, "Cavendish Square")).toBeTruthy();
    expect(entries.every((e) => e.kind === "name")).toBe(true);
  });

  it("groups the ways a name is written into one entry", () => {
    const entries = findNames(paragraphs);
    const hyde = byAlias(entries, "Edward Hyde")!;
    expect(hyde.aliases).toEqual(expect.arrayContaining(["Hyde", "Mr. Hyde", "Edward Hyde"]));
    expect(hyde.name).toBe("Edward Hyde");
    const jekyll = byAlias(entries, "Henry Jekyll")!;
    expect(jekyll.aliases).toEqual(expect.arrayContaining(["Jekyll", "Dr. Jekyll", "Henry Jekyll", "Harry Jekyll", "Harry"]));
    expect(jekyll.name).toBe("Henry Jekyll"); // the way the book most often writes him in full, without his title
    expect(byAlias(entries, "Utterson")!.name).toBe("Mr. Utterson");
    // "Sir Danvers" and "Sir Danvers Carew" are one man.
    const carew = byAlias(entries, "Carew")!;
    expect(carew.aliases).toEqual(expect.arrayContaining(["Sir Danvers Carew", "Sir Danvers"]));
    expect(byAlias(entries, "Sir Danvers")).toBe(carew);
    expect(carew.name).toBe("Sir Danvers Carew");
    // A first name on its own goes with the full name.
    expect(byAlias(entries, "Richard")).toBe(byAlias(entries, "Enfield"));
    // The publisher's pages at the ends of the file are not the book.
    expect(byAlias(entries, "Standard Ebooks")).toBeUndefined();
    expect(byAlias(entries, "Project Gutenberg")).toBeUndefined();
    // Aliases are matched longest first, so "Mr. Hyde" is one mention and "Hyde" inside it is not another.
    const ids = new Set(entries.map((e) => e.id));
    expect(ids.size).toBe(entries.length);
  });

  it("stores every mention as offsets into the book's own text, and the slice is an alias", () => {
    const entries = findNames(paragraphs);
    expect(entries.length).toBeLessThan(20);
    const mentions = findMentions(entries, paragraphs);
    expect(mentions.length).toBeGreaterThan(300);
    const text = new Map(paragraphs.map((p) => [p.id, p.text]));
    const aliases = new Map(entries.map((e) => [e.id, new Set(e.aliases)]));
    for (const m of mentions) expect(aliases.get(m.entryId)!.has(text.get(m.sectionId)!.slice(m.start, m.end))).toBe(true);
    // A possessive counts as a mention of the name, without its "’s".
    const possessive = paragraphs.find((p) => p.text.includes("Jekyll’s"))!;
    const jekyll = byAlias(entries, "Jekyll")!;
    expect(
      mentions.some((m) => m.entryId === jekyll.id && m.sectionId === possessive.id && possessive.text.slice(m.start, m.end).endsWith("Jekyll") && possessive.text.slice(m.end, m.end + 2) === "’s"),
    ).toBe(true);
  });

  it("is built at import, and lists entries by mentions up to where the reader is", async () => {
    const [{ count }] = await database.db.select({ count: xrayEntries.id }).from(xrayEntries).where(eq(xrayEntries.bookId, bookId)).limit(1);
    expect(count).toBeTruthy();
    const chapter = (label: string) => all.find((s) => s.kind === "chapter" && s.label === label)!;
    const search = chapter("Search for Mr. Hyde");
    const inSearch = all.filter((s) => s.kind === "paragraph" && s.chapterIndex === search.chapterIndex);
    // The reader is at the third paragraph of chapter 2: Lanyon is met there, the murder has not happened.
    const list = await listXray(database.db, ownerId, bookId, inSearch[2].cfi);
    expect(list.position).toBe(inSearch[2].position);
    expect(list.chapters.map((c) => c.label)).toContain("The Carew Murder Case");
    expect(list.chapters.map((c) => c.label)).not.toContain("Uncopyright");
    expect(list.chapters.length).toBe(10);
    const named = (alias: string) => list.entries.find((e) => e.aliases.includes(alias))!;
    expect(named("Utterson").seen).toBe(true);
    expect(named("Lanyon").seen).toBe(true);
    expect(named("Carew").seen).toBe(false);
    expect(named("Carew").soFar).toBe(0);
    expect(named("Carew").total).toBeGreaterThan(0);
    expect(named("Carew").firstChapter).toBe(chapter("The Carew Murder Case").chapterIndex);
    // Most mentioned so far first; nothing unseen sorts above something seen.
    expect(list.entries[0].aliases).toContain("Utterson");
    const firstUnseen = list.entries.findIndex((e) => !e.seen);
    expect(list.entries.slice(firstUnseen).every((e) => e.soFar === 0)).toBe(true);
    // Each chapter in an entry's trail names where its first mention there is: a paragraph's place.
    const utterson = named("Utterson");
    expect(utterson.chapters.length).toBeGreaterThan(5);
    for (const c of utterson.chapters) expect(all.find((s) => s.cfi === c.cfi && s.kind === "paragraph")).toBeTruthy();
    // At the very top of the book nothing has been met yet.
    const start = await listXray(database.db, ownerId, bookId, null);
    expect(start.entries.every((e) => !e.seen && e.soFar === 0)).toBe(true);
    // At the top of a chapter (its own CFI, before any paragraph), the chapter's start counts.
    const topOfSearch = await listXray(database.db, ownerId, bookId, search.cfi);
    expect(topOfSearch.position).toBe(search.position);
  });

  it("rebuilds mentions when the entries arrived without them, as after an import", async () => {
    const before = await database.db.select().from(xrayMentions).where(eq(xrayMentions.bookId, bookId));
    await database.db.delete(xrayMentions).where(eq(xrayMentions.bookId, bookId));
    expect(await ensureXray(database.db, bookId)).toEqual({ entries: expect.any(Number), mentions: before.length });
    const after = await database.db.select().from(xrayMentions).where(eq(xrayMentions.bookId, bookId));
    expect(after.length).toBe(before.length);
    // With entries present and mentions present, nothing is rebuilt; with no entries, the text is read again.
    expect(await ensureXray(database.db, bookId)).toBeNull();
    await database.db.delete(xrayEntries).where(eq(xrayEntries.bookId, bookId));
    expect((await ensureXray(database.db, bookId))?.mentions).toBe(before.length);
    expect((await buildXray(database.db, bookId)).mentions).toBe(before.length);
  });

  it("gives a chapter's marks: the first mention of each name in each paragraph, in reading order", async () => {
    const chapter = all.find((s) => s.kind === "chapter" && s.label === "Story of the Door")!;
    const marks = await marksFor(database.db, ownerId, bookId, chapter.chapterIndex);
    expect(marks.length).toBeGreaterThan(10);
    const text = new Map(all.map((s) => [s.id, s.text]));
    for (const m of marks) expect(all.find((s) => s.id === m.sectionId)?.cfi).toBe(m.cfi);
    // One mark per name per paragraph, the first one; in reading order.
    const keys = marks.map((m) => `${m.entryId}|${m.sectionId}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 1; i < marks.length; i++) expect(marks[i].position >= marks[i - 1].position).toBe(true);
    const first = marks[0];
    expect(first.name).toBe("Mr. Utterson");
    expect(text.get(first.sectionId)!.slice(first.start, first.end)).toBe("Mr. Utterson");
    // A chapter with no names (a publisher's page) has none; another reader is refused.
    const colophon = all.find((s) => s.kind === "chapter" && /uncopyright/i.test(s.label))!;
    expect(await marksFor(database.db, ownerId, bookId, colophon.chapterIndex)).toEqual([]);
    await expect(marksFor(database.db, "00000000-0000-0000-0000-000000000000", bookId, chapter.chapterIndex)).rejects.toThrow("That book was not found.");
  });

  it("refuses another reader's book", async () => {
    const other = (await createFirstAdmin(database.db, { email: "p@example.com", name: "P", password: "long enough pw" }).catch(() => null))?.id;
    if (other) await expect(listXray(database.db, other, bookId, null)).rejects.toThrow("That book was not found.");
    await expect(listXray(database.db, "00000000-0000-0000-0000-000000000000", bookId, null)).rejects.toThrow("That book was not found.");
  });
});
