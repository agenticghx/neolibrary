import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { resetSpendHoldsForTests } from "@/lib/ai/generate";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { generations, xrayEntries, xrayFacts, xrayMentions } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { setStyle } from "./ai-style";
import { importBook } from "./import";
import { getSections } from "./sections-store";
import { ensureXray, listXray } from "./xray";
import { bookChapters, chapterPassages, checkAnswer, findQuote, nextChapterToRead, readChapter, resetXrayJobsForTests, saveChapterReadElsewhere, startXray, stopXray, tidyXray, xraySummary, type Passage } from "./xray-read";

let database: Database;
let ownerId: string;
let bookId: string;
let all: Awaited<ReturnType<typeof getSections>>;

beforeEach(async () => {
  database = await testDatabase();
  resetSpendHoldsForTests();
  resetXrayJobsForTests();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "jh.epub", bytes: file })).bookId;
  all = await getSections(database.db, ownerId, bookId);
  await setStyle(database.db, ownerId, bookId, { scope: "all", style: "plain" });
});
afterEach(() => database.raw.close());

const chapterNamed = (label: string) => all.find((s) => s.kind === "chapter" && s.label === label)!;

describe("the quote check (M32 X3)", () => {
  it("finds a quote exactly, or with only quotes, dashes, spaces and capitals set aside", () => {
    const text = "“Did you ever remark that door?” he asked; and when his companion had replied—yes, he had—the story began.";
    expect(findQuote(text, "he asked; and when")).toEqual({ start: text.indexOf("he asked; and when"), end: text.indexOf("he asked; and when") + "he asked; and when".length });
    // Straight quotes for curly ones, a plain dash, extra spaces and a capital: the same words.
    const found = findQuote(text, '"Did you ever   remark that door?" He asked')!;
    expect(text.slice(found.start, found.end)).toBe("“Did you ever remark that door?” he asked");
    const dash = findQuote(text, "replied - yes, he had - the story")!;
    expect(text.slice(dash.start, dash.end)).toBe("replied—yes, he had—the story");
    expect(findQuote(text, "the moon was made of green cheese")).toBeNull();
    expect(findQuote(text, "   ")).toBeNull();
  });

  it("keeps facts whose quotes are in the passage they name, drops the rest and counts them, and joins known entries", () => {
    const passages: Passage[] = [
      { n: 1, id: "p1", position: 5, chapterIndex: 2, cfi: "epubcfi(/6/6!/4/2)", text: "Mr. Utterson the lawyer was a man of a rugged countenance." },
      { n: 2, id: "p2", position: 6, chapterIndex: 2, cfi: "epubcfi(/6/6!/4/4)", text: "It was a man of the name of Hyde." },
    ];
    const known = [{ id: "x-utt", name: "Mr. Utterson", kind: "name" as const, aliases: ["Mr. Utterson", "Utterson"] }];
    const answer = JSON.stringify({
      entries: [
        {
          name: "Gabriel John Utterson",
          kind: "person",
          aliases: ["Utterson", "the lawyer"],
          same_as: "Mr. Utterson",
          facts: [
            { passage: 1, fact: "A lawyer with a rugged face.", quote: "a man of a rugged countenance" },
            { passage: 2, fact: "Not in this passage.", quote: "a man of a rugged countenance" },
            { passage: 9, fact: "No such passage.", quote: "Hyde" },
          ],
        },
        { name: "Edward Hyde", kind: "person", aliases: ["Hyde"], same_as: null, facts: [{ passage: 2, fact: "The man's name.", quote: "the name of Hyde" }] },
        { name: "Hyde", kind: "person", aliases: ["Mr. Hyde"], same_as: null, facts: [{ passage: 2, fact: "Said twice.", quote: "It was a man" }] },
        { name: "Green Cheese", kind: "term", aliases: [], same_as: null, facts: [{ passage: 1, fact: "Planted.", quote: "The moon was made of green cheese." }] },
        { name: "", kind: "place", aliases: [], same_as: null, facts: [] },
      ],
    });
    const { entries, dropped } = checkAnswer(answer, passages, known);
    expect(dropped).toBe(3);
    const utterson = entries.find((e) => e.id === "x-utt")!;
    expect(utterson.isNew).toBe(false);
    expect(utterson.kind).toBe("person");
    expect(utterson.aliases).toEqual(expect.arrayContaining(["Mr. Utterson", "Utterson", "Gabriel John Utterson"]));
    expect(utterson.aliases).not.toContain("the lawyer"); // a description, not a way of writing the name (X7)
    const at = passages[0].text.indexOf("a man of a rugged countenance");
    expect(utterson.facts).toEqual([{ sectionId: "p1", position: 5, chapterIndex: 2, start: at, end: at + "a man of a rugged countenance".length, fact: "A lawyer with a rugged face.", quote: "a man of a rugged countenance" }]);
    // Two answers for one new name in the same chapter are one entry, with both sets of names and facts.
    const hyde = entries.find((e) => e.name === "Edward Hyde")!;
    expect(hyde.isNew).toBe(true);
    expect(hyde.aliases).toEqual(expect.arrayContaining(["Edward Hyde", "Hyde", "Mr. Hyde"]));
    expect(hyde.facts.map((f) => f.quote)).toEqual(["the name of Hyde", "It was a man"]);
    const cheese = entries.find((e) => e.name === "Green Cheese")!;
    expect(cheese.facts).toEqual([]);
    expect(entries.length).toBe(3);
    // Nonsense is no answer.
    expect(checkAnswer("not json", passages, known)).toEqual({ entries: [], dropped: 0 });
    expect(checkAnswer(JSON.stringify({ entries: "no" }), passages, known)).toEqual({ entries: [], dropped: 0 });
  });
});

describe("alias hygiene on an answer (M32 X7)", () => {
  it("drops an alias that is another entry's name, joins a known entry only by same_as, its name or a shared alias of the same kind", () => {
    const known = [
      { id: "x-japan", name: "Japan", kind: "place" as const, aliases: ["Japan"] },
      { id: "x-jg", name: "Johannes Gutenberg", kind: "person" as const, aliases: ["Johannes Gutenberg", "Gutenberg"] },
      { id: "x-noyce", name: "Robert Noyce", kind: "person" as const, aliases: ["Robert Noyce", "Noyce"] },
    ];
    const answer = JSON.stringify({
      entries: [
        { name: "Tokyo", kind: "place", aliases: ["Tokyo", "Japan", "Japan’s", "Japanese"], same_as: null, facts: [] },
        { name: "Gutenberg moment", kind: "term", aliases: ["Gutenberg moment", "Gutenberg"], same_as: null, facts: [] },
        { name: "Bob Noyce", kind: "person", aliases: ["Bob Noyce", "Noyce"], same_as: null, facts: [] },
        { name: "Chang", kind: "person", aliases: ["Chang", "Morris Chang"], same_as: "Morris Chang", facts: [] },
      ],
    });
    const { entries } = checkAnswer(answer, [], known);
    const tokyo = entries.find((e) => e.name === "Tokyo")!;
    expect(tokyo.isNew).toBe(true);
    expect(tokyo.aliases).toEqual(["Tokyo"]); // Japan is Japan's; "Japanese" is an adjective
    const moment = entries.find((e) => e.name === "Gutenberg moment")!;
    expect(moment.isNew).toBe(true); // a term does not join a person over a shared alias
    expect(moment.id).not.toBe("x-jg");
    const noyce = entries.find((e) => e.id === "x-noyce")!;
    expect(noyce.isNew).toBe(false); // a person joins a person over "Noyce"
    expect(noyce.aliases).toEqual(["Robert Noyce", "Noyce", "Bob Noyce"]);
    const chang = entries.find((e) => e.name === "Chang")!;
    expect(chang.isNew).toBe(true); // same_as names an entry that is not known: new, and "Morris Chang" stays an alias (a fuller name)
    expect(chang.aliases).toEqual(["Chang", "Morris Chang"]);
  });
});

describe("reading a chapter with Claude (M32 X3)", () => {
  it("reads one chapter once, stores facts with offsets that match their quotes, counts the planted fact, and re-serves the answer", async () => {
    const model = new FakeModel();
    const [door] = await bookChapters(database.db, bookId);
    expect(door.label).toBe("Story of the Door");
    const out = await readChapter({ db: database.db, model }, ownerId, bookId, door);
    expect(model.calls.length).toBe(1);
    expect(model.calls[0].schema).toBeTruthy();
    expect(model.calls[0].prompt).toContain('<passage n="1">');
    expect(model.calls[0].prompt).toContain("Mr. Utterson (not yet classified): Mr. Utterson, Utterson");
    expect(out.reused).toBe(false);
    expect(out.dropped).toBe(1); // the fake's planted fact: its quote is not in the book
    expect(out.facts).toBeGreaterThan(1);
    const facts = await database.db.select().from(xrayFacts).where(eq(xrayFacts.bookId, bookId));
    const text = new Map(all.map((s) => [s.id, s.text]));
    for (const f of facts) {
      expect(text.get(f.sectionId)!.slice(f.startAt, f.endAt)).toBe(f.quote);
      expect(f.generationId).toBe(out.generation!.id);
      expect(f.chapterIndex).toBe(door.chapterIndex);
    }
    expect(facts.some((f) => f.quote === "The moon was made of green cheese.")).toBe(false);
    // Known entries from the text are joined, not doubled: Utterson keeps his id and is now a person.
    const entries = await database.db.select().from(xrayEntries).where(eq(xrayEntries.bookId, bookId));
    const utterson = entries.find((e) => e.aliases.includes("Utterson"))!;
    expect(utterson.kind).toBe("person");
    expect(utterson.generationId).toBe(out.generation!.id);
    expect(entries.filter((e) => e.aliases.includes("Utterson")).length).toBe(1);
    // The planted entry has no facts but is an entry; its mentions are none (it is not in the text).
    expect(entries.find((e) => e.name === "Green Cheese")).toBeTruthy();
    expect(await database.db.select().from(xrayMentions).where(and(eq(xrayMentions.bookId, bookId), eq(xrayMentions.entryId, entries.find((e) => e.name === "Green Cheese")!.id)))).toEqual([]);
    // Again: the stored answer, no second call, the same facts (replaced, not doubled).
    const again = await readChapter({ db: database.db, model }, ownerId, bookId, door);
    expect(again.reused).toBe(true);
    expect(model.calls.length).toBe(1);
    expect((await database.db.select().from(xrayFacts).where(eq(xrayFacts.bookId, bookId))).length).toBe(facts.length);
  });

  it("passages are numbered from 1 and cut at the length the cost allows", async () => {
    const ch = chapterNamed("Search for Mr. Hyde");
    const passages = await chapterPassages(database.db, bookId, ch.chapterIndex);
    expect(passages.map((p) => p.n)).toEqual(passages.map((_, i) => i + 1));
    expect(passages[0].text).toContain("Mr. Utterson came home");
  });

  it("the whole-book read: a summary with the estimate and the caps, a run that needs confirming, progress, Stop, and the list's facts up to where the reader is", async () => {
    const model = new FakeModel();
    const before = await xraySummary(database.db, model, ownerId, bookId);
    expect(before.chapters).toBe(10);
    expect(before.done).toBe(0);
    expect(before.estimateUsd).toBeGreaterThan(0);
    expect(before.overLimit).toBe(false);
    expect(before.running).toBe(false);
    await expect(startXray({ db: database.db, model }, ownerId, bookId, "yes")).rejects.toThrow("first confirm");
    const { started, finished } = await startXray({ db: database.db, model }, ownerId, bookId, true);
    expect(started).toBe(true);
    // Starting again while it runs starts nothing new.
    expect((await startXray({ db: database.db, model }, ownerId, bookId, true)).started).toBe(false);
    await finished;
    const after = await xraySummary(database.db, model, ownerId, bookId);
    expect(after.done).toBe(10);
    expect(after.running).toBe(false);
    expect(after.stoppedBecause?.kind).toBe("finished");
    expect(after.stoppedBecause?.message).toContain("10 facts were left out"); // one planted fact per chapter
    expect(after.dropped).toBe(10);
    expect(after.facts).toBeGreaterThan(10);
    expect(model.calls.length).toBe(10);
    const stored = await database.db.select().from(generations).where(and(eq(generations.ownerId, ownerId), eq(generations.kind, "xray")));
    expect(stored.length).toBe(10);
    // The list carries each entry's facts, and says which the reader has reached.
    const search = chapterNamed("Search for Mr. Hyde");
    const inSearch = all.filter((s) => s.kind === "paragraph" && s.chapterIndex === search.chapterIndex);
    const list = await listXray(database.db, ownerId, bookId, inSearch[0].cfi);
    const utterson = list.entries.find((e) => e.aliases.includes("Utterson"))!;
    expect(utterson.kind).toBe("person");
    expect(utterson.facts.length).toBeGreaterThan(1);
    expect(utterson.facts.some((f) => f.seen)).toBe(true);
    expect(utterson.facts.some((f) => !f.seen)).toBe(true);
    for (const f of utterson.facts) expect(f.seen).toBe(f.position <= list.position);
    expect(utterson.facts.every((f) => f.cfi && f.quote && f.fact)).toBe(true);
  });

  it("stops when asked, and stops at the spending cap", async () => {
    // A model that asks to stop as it answers the first chapter: the run finishes that chapter and no more.
    const model = new FakeModel(() => {
      expect(stopXray(ownerId, bookId)).toBe(true);
      return JSON.stringify({ entries: [] });
    });
    const { finished } = await startXray({ db: database.db, model }, ownerId, bookId, true);
    await finished;
    const s = await xraySummary(database.db, model, ownerId, bookId);
    expect(s.stoppedBecause?.kind).toBe("stopped");
    expect(s.done).toBe(1);
    expect(model.calls.length).toBe(1);
    // With no room under the cap, the run stops at the limit and says so; what was read stays.
    resetXrayJobsForTests();
    const tight = await startXray({ db: database.db, model, caps: { perBookUsd: 0.00001, perMonthUsd: 20 } }, ownerId, bookId, true);
    await tight.finished;
    const t = await xraySummary(database.db, model, ownerId, bookId);
    expect(t.stoppedBecause?.kind).toBe("limit");
    expect(t.stoppedBecause?.message).toContain("spending cap");
    expect(stopXray(ownerId, bookId)).toBe(false);
  });
});

describe("reading on the owner's own subscription (M32 X5)", () => {
  it("hands out the next unread chapter's exact request, stores an answer read elsewhere at no cost, and counts it as read", async () => {
    const model = new FakeModel();
    const first = await nextChapterToRead(database.db, ownerId, bookId);
    expect(first).toMatchObject({ done: 0, total: 10 });
    expect(first.chapter?.label).toBe("Story of the Door");
    expect(first.chapter?.prompt).toContain('<passage n="1">');
    expect(first.chapter?.system).toContain("Return the entries this chapter names");
    // The laptop reads it (here: the fake, given the same request) and sends the answer back.
    const c = first.chapter!;
    const answer = await model.generate({ system: c.system, prompt: c.prompt, maxTokens: 8000, effort: "medium", schema: c.schema });
    const saved = await saveChapterReadElsewhere(database.db, ownerId, bookId, {
      chapterId: c.id,
      output: answer.text,
      model: "claude-haiku-5-5",
      promptHash: c.promptHash,
      inputHash: c.inputHash,
      inputTokens: answer.inputTokens,
      outputTokens: answer.outputTokens,
    });
    expect(saved).toMatchObject({ done: 1, total: 10, dropped: 1 });
    expect(saved.facts).toBeGreaterThan(1);
    const [row] = await database.db.select().from(generations).where(eq(generations.id, saved.generationId));
    expect(row).toMatchObject({ kind: "xray", provider: "claude-subscription", model: "claude-haiku-5-5", costUsd: 0, sectionId: c.id, promptHash: c.promptHash, inputHash: c.inputHash });
    expect(row.inputTokens).toBe(answer.inputTokens);
    const facts = await database.db.select().from(xrayFacts).where(eq(xrayFacts.generationId, saved.generationId));
    expect(facts.length).toBe(saved.facts);
    // The server's own path finds the answer stored and pays nothing; the summary counts the chapter as read.
    const again = await readChapter({ db: database.db, model }, ownerId, bookId, c);
    expect(again.reused).toBe(true);
    expect(model.calls.length).toBe(1);
    expect((await xraySummary(database.db, model, ownerId, bookId)).done).toBe(1);
    // The next request is the second chapter, told the entries the first one made.
    const second = await nextChapterToRead(database.db, ownerId, bookId);
    expect(second.chapter?.label).toBe("Search for Mr. Hyde");
    expect(second.chapter?.prompt).toContain("Mr. Utterson (person)");
  });

  it("refuses an answer for another book's chapter, read with other instructions, or from other text", async () => {
    const { chapter } = await nextChapterToRead(database.db, ownerId, bookId);
    const c = chapter!;
    const good = { chapterId: c.id, output: JSON.stringify({ entries: [] }), model: "claude-haiku-5-5", promptHash: c.promptHash, inputHash: c.inputHash, inputTokens: 1, outputTokens: 1 };
    await expect(saveChapterReadElsewhere(database.db, ownerId, bookId, { ...good, chapterId: "c-0000000000" })).rejects.toThrow("not one of this book's chapters");
    await expect(saveChapterReadElsewhere(database.db, ownerId, bookId, { ...good, promptHash: "x" })).rejects.toThrow("other instructions");
    await expect(saveChapterReadElsewhere(database.db, ownerId, bookId, { ...good, inputHash: "x" })).rejects.toThrow("other text");
    await expect(saveChapterReadElsewhere(database.db, ownerId, bookId, { ...good, model: "gpt-9" })).rejects.toThrow("Claude model");
    await expect(saveChapterReadElsewhere(database.db, ownerId, bookId, { ...good, output: "" })).rejects.toThrow("missing");
    await expect(saveChapterReadElsewhere(database.db, "00000000-0000-0000-0000-000000000000", bookId, good)).rejects.toThrow("not found");
    await expect(nextChapterToRead(database.db, "00000000-0000-0000-0000-000000000000", bookId)).rejects.toThrow("not found");
    // An empty answer is still a reading: the chapter counts as read, with no facts.
    expect((await saveChapterReadElsewhere(database.db, ownerId, bookId, good)).done).toBe(1);
  });
});

describe("a book read before the alias rules (M32 X7)", () => {
  it("tidyXray puts every entry's aliases through the rules and rebuilds the mentions; another reader is refused", async () => {
    await ensureXray(database.db, bookId);
    await database.db.insert(xrayEntries).values([
      { bookId, id: "x-japan", name: "Japan", kind: "place", aliases: ["Japan"] },
      { bookId, id: "x-tokyo", name: "Tokyo", kind: "place", aliases: ["Tokyo", "Japan", "Japan’s", "Japanese", "the city"] },
    ]);
    const before = (await database.db.select().from(xrayMentions).where(eq(xrayMentions.bookId, bookId))).length;
    const result = await tidyXray(database.db, ownerId, bookId);
    expect(result.changed).toBe(1);
    expect(result.mentions).toBeGreaterThan(0);
    const [tokyo] = await database.db.select().from(xrayEntries).where(and(eq(xrayEntries.bookId, bookId), eq(xrayEntries.id, "x-tokyo")));
    expect(tokyo.aliases).toEqual(["Tokyo"]);
    expect((await database.db.select().from(xrayMentions).where(eq(xrayMentions.bookId, bookId))).length).toBe(result.mentions);
    expect(before).toBeGreaterThan(0);
    // Nothing to change the second time: no rebuild.
    expect(await tidyXray(database.db, ownerId, bookId)).toEqual({ entries: result.entries, changed: 0, mentions: 0 });
    await expect(tidyXray(database.db, "00000000-0000-0000-0000-000000000000", bookId)).rejects.toThrow("That book was not found.");
  });
});
