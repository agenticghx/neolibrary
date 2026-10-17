import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { resetSpendHoldsForTests, SpendingCapReached } from "@/lib/ai/generate";
import { AiNotConfigured } from "@/lib/ai/model";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { listAnnotations } from "./annotations";
import type { Passage } from "./ask";
import { checkItems, cleanSummary, ExplainBackError, explainBack, listAttempts, MAX_ITEMS, MIN_WORDS, normalize, partPassages } from "./explain-back";
import { importBook } from "./import";
import { chapterFor } from "./prerequisites";
import { reviewQueue } from "./review";

const passages: Passage[] = [
  { n: 1, sectionId: "p1", cfi: "epubcfi(/6/4!/4/2)", chapter: "", text: "Mr. Utterson the lawyer was a man of a rugged countenance, that was never lighted by a smile." },
  { n: 2, sectionId: "p2", cfi: "epubcfi(/6/4!/4/4)", chapter: "", text: "He was austere with himself; drank gin when he was alone, to mortify a taste for vintages." },
];

describe("the summary (M26 R1)", () => {
  it("is tidied and needs a sentence's worth of words", () => {
    expect(cleanSummary("  The lawyer is   stern\r\nbut tolerant of others' failings, it says.  ")).toBe("The lawyer is stern\nbut tolerant of others' failings, it says.");
    expect(() => cleanSummary("Too short.")).toThrow(ExplainBackError);
    expect(() => cleanSummary("— — — — — — — — — —")).toThrow(`at least ${MIN_WORDS} words`);
    expect(() => cleanSummary(42)).toThrow(ExplainBackError);
    expect(cleanSummary("word ".repeat(1000))).toHaveLength(2000);
  });
});

describe("Claude's items, checked against the book (M26 R1)", () => {
  const out = (items: unknown[]) => JSON.stringify({ items });

  it("keeps a quote found word for word, ignoring curly quotes, spacing and case", () => {
    const [item] = checkItems(out([{ kind: "missed", passage: 1, quote: "“a man of a rugged   Countenance”", why: "You leave out his face." }]), passages);
    expect(item).toMatchObject({ kind: "missed", n: 1, cfi: passages[0].cfi, quote: "a man of a rugged   Countenance", why: "You leave out his face." });
    expect(normalize("It’s “so” — fine")).toBe(`it's "so" - fine`);
  });

  it("finds a quote in another passage when the number is wrong, and points there", () => {
    const [item] = checkItems(out([{ kind: "misread", passage: 1, quote: "drank gin when he was alone", why: "He drinks gin." }]), passages);
    expect(item).toMatchObject({ kind: "misread", n: 2, cfi: passages[1].cfi, quote: "drank gin when he was alone" });
  });

  it("never shows an invented quote as the book's words: the passage's start instead", () => {
    const [item] = checkItems(out([{ kind: "missed", passage: 2, quote: "He loved the theatre above all things.", why: "Made up." }]), passages);
    expect(item.quote).toBeNull();
    expect(item.n).toBe(2);
    expect(item.excerpt).toBe(passages[1].text);
  });

  it("drops a passage number that does not exist, an item with no reason, more than five, and output that is not JSON", () => {
    expect(checkItems(out([{ kind: "missed", passage: 9, quote: "nothing like it", why: "No such passage." }]), passages)).toEqual([]);
    expect(checkItems(out([{ kind: "missed", passage: 1, quote: "rugged countenance", why: "  " }]), passages)).toEqual([]);
    const many = Array.from({ length: 8 }, () => ({ kind: "odd", passage: 1, quote: "rugged countenance", why: "Again." }));
    const kept = checkItems(out(many), passages);
    expect(kept).toHaveLength(MAX_ITEMS);
    expect(kept[0].kind).toBe("missed"); // an unknown kind reads as "missed"
    expect(checkItems("not json", passages)).toEqual([]);
  });
});

describe("explaining a part back, in the database (M26 R1)", () => {
  let database: Database;
  let ownerId: string;
  let jekyll: string;
  const fixture = (name: string) => ({ name, bytes: new Uint8Array(readFileSync(new URL(`../../fixtures/books/${name}`, import.meta.url))) });
  const summary = "The lawyer Utterson is stern with himself but tolerant of others, and his walk with Enfield turns up a strange door.";

  beforeEach(async () => {
    database = await testDatabase();
    ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
    jekyll = (await importBook(database.db, new MemoryStorage(), ownerId, fixture("stevenson-jekyll-and-hyde.epub"))).bookId;
  });
  afterEach(async () => {
    resetSpendHoldsForTests();
    await database.raw.close();
  });

  const firstChapterWithText = async () => {
    for (let i = 0; i < 20; i++) {
      try {
        const chapter = await chapterFor(database.db, ownerId, jekyll, { cfi: `epubcfi(/6/${(i + 1) * 2}!/4/2)` });
        if ((await partPassages(database.db, jekyll, chapter)).length > 3) return chapter;
      } catch {
        // No such chapter, or one with no text: try the next.
      }
    }
    throw new Error("no chapter with text");
  };

  it("saves the summary as the reader's note first, then answers with quotes from the part, linked to their places", async () => {
    const chapter = await firstChapterWithText();
    const parts = await partPassages(database.db, jekyll, chapter);
    const model = new FakeModel();
    const out = await explainBack(database.db, model, ownerId, { bookId: jekyll, chapterId: chapter.id, summary });
    expect(out.error).toBeNull();
    expect(out.reused).toBe(false);
    expect(out.note).toMatchObject({ kind: "note", body: summary, cfi: parts[0].cfi });
    expect(out.note!.quote.exact).toBe(parts[0].text.slice(0, out.note!.quote.exact.length));
    expect(out.attempt!.summary).toBe(summary);
    expect(out.attempt!.items.map((i) => [i.kind, i.n, i.cfi])).toEqual([
      ["missed", 1, parts[0].cfi],
      ["misread", 2, parts[1].cfi],
    ]);
    expect(out.attempt!.items.every((i) => i.quote && normalize(parts[i.n - 1].text).includes(normalize(i.quote)))).toBe(true);
    expect(out.attempt!.provenance).toMatchObject({ provider: "anthropic", model: "fake", promptName: expect.stringMatching(/^explain-back/) });
    // The prompt carries the summary and the numbered passages.
    expect(model.calls[0].prompt).toContain(summary);
    expect(model.calls[0].prompt).toContain('<passage n="1">');
    // The note is a Daily review card, like any note that quotes a passage.
    const due = await reviewQueue(database.db, ownerId);
    expect(due.cards.some((c) => c.note === summary)).toBe(true);
  });

  it("re-serves the same summary of the same part without a second call or a second note; a new summary asks again", async () => {
    const chapter = await firstChapterWithText();
    const model = new FakeModel();
    await explainBack(database.db, model, ownerId, { bookId: jekyll, chapterId: chapter.id, summary });
    const again = await explainBack(database.db, model, ownerId, { bookId: jekyll, chapterId: chapter.id, summary });
    expect(again.reused).toBe(true);
    expect(again.note).toBeNull();
    expect(model.calls).toHaveLength(1);
    expect((await listAnnotations(database.db, ownerId, jekyll)).filter((a) => a.kind === "note")).toHaveLength(1);

    const other = `${summary} Hyde tramples a child.`;
    await explainBack(database.db, model, ownerId, { bookId: jekyll, chapterId: chapter.id, summary: other });
    expect(model.calls).toHaveLength(2);
    expect((await listAttempts(database.db, ownerId, jekyll, chapter)).map((a) => a.summary)).toEqual([other, summary]);
  });

  it("keeps the summary when a spending cap stops the call, and when no AI is set up", async () => {
    const chapter = await firstChapterWithText();
    const capped = await explainBack(database.db, new FakeModel(), ownerId, { bookId: jekyll, chapterId: chapter.id, summary }, { caps: { perBookUsd: 0, perMonthUsd: 0 } });
    expect(capped.error).toBeInstanceOf(SpendingCapReached);
    expect(capped.attempt).toBeNull();
    expect(capped.note?.body).toBe(summary);

    const other = `${summary} And then some more.`;
    const none = await explainBack(database.db, () => {
      throw new AiNotConfigured("No AI key.");
    }, ownerId, { bookId: jekyll, chapterId: chapter.id, summary: other });
    expect(none.error).toBeInstanceOf(AiNotConfigured);
    expect(none.note?.body).toBe(other);
    expect(await listAttempts(database.db, ownerId, jekyll, chapter)).toEqual([]); // no answer was made
  });

  it("refuses an empty or short summary and an unknown part, and saves nothing", async () => {
    const chapter = await firstChapterWithText();
    await expect(explainBack(database.db, new FakeModel(), ownerId, { bookId: jekyll, chapterId: chapter.id, summary: "" })).rejects.toThrow(ExplainBackError);
    await expect(explainBack(database.db, new FakeModel(), ownerId, { bookId: jekyll, chapterId: undefined, summary })).rejects.toThrow(ExplainBackError);
    await expect(explainBack(database.db, new FakeModel(), ownerId, { bookId: jekyll, chapterId: "no-such-chapter", summary })).rejects.toThrow();
    expect(await listAnnotations(database.db, ownerId, jekyll)).toEqual([]);
  });
});
