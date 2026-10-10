import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { importBook } from "./import";
import { steCheck } from "@/lib/ai/ste";
import { getStyles, setStyle } from "./ai-style";
import { chapterFor, listNeedToKnow, needToKnow, SCHEMA, viewPrerequisites } from "./prerequisites";
import { getSections } from "./sections-store";

let database: Database;
let ownerId: string;
let bookId: string;
let all: Awaited<ReturnType<typeof getSections>>;

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "jh.epub", bytes: file })).bookId;
  all = await getSections(database.db, ownerId, bookId);
});
afterEach(() => database.raw.close());

const chapter = (label: string) => all.find((s) => s.kind === "chapter" && s.label === label)!;

describe('"What do I need to know?" (M6)', () => {
  it("finds the chapter from a place in it, or from its very top", async () => {
    const carew = chapter("The Carew Murder Case");
    const para = all.find((s) => s.kind === "paragraph" && s.chapterIndex === carew.chapterIndex)!;
    expect(await chapterFor(database.db, ownerId, bookId, { cfi: para.cfi.replace(/\)$/, "/1:5)") })).toEqual({
      id: carew.id,
      label: "The Carew Murder Case",
      chapterIndex: carew.chapterIndex,
    });
    expect((await chapterFor(database.db, ownerId, bookId, { cfi: carew.cfi })).id).toBe(carew.id);
  });

  it("asks once per chapter for structured concepts, stores them with provenance, and re-serves them", async () => {
    // About the plain wording: new readers start in STE light since M17.
    await setStyle(database.db, ownerId, bookId, { scope: "all", style: "plain" });
    const model = new FakeModel();
    const carew = chapter("The Carew Murder Case");
    const first = await needToKnow(database.db, model, ownerId, { bookId, chapterId: carew.id });
    expect(first.reused).toBe(false);
    expect(model.calls).toHaveLength(1);
    const sent = model.calls[0];
    expect(sent.schema).toEqual(SCHEMA);
    expect(sent.effort).toBe("medium");
    expect(sent.prompt).toContain("Chapter: The Carew Murder Case");
    // The whole chapter is sent: its first and last paragraphs.
    const paras = all.filter((s) => s.kind === "paragraph" && s.chapterIndex === carew.chapterIndex);
    expect(sent.prompt).toContain(paras[0].text);
    expect(sent.prompt).toContain(paras.at(-1)!.text);
    expect(sent.system).toContain("Write in plain, precise English.");
    expect(sent.system).not.toContain("{{");

    expect(first.generation).toMatchObject({ kind: "prerequisites", sectionId: carew.id, provenance: { promptName: "prerequisites", model: "fake" } });
    expect(first.generation.concepts.length).toBeGreaterThan(0);
    for (const c of first.generation.concepts) {
      expect(c.explanation).toContain(c.name);
      expect(c.readMore).toBe(`https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(c.name)}`);
    }

    const again = await needToKnow(database.db, model, ownerId, { bookId, chapterId: carew.id });
    expect(again.reused).toBe(true);
    expect(model.calls).toHaveLength(1);
    await needToKnow(database.db, model, ownerId, { bookId, chapterId: carew.id, fresh: true });
    expect((await listNeedToKnow(database.db, ownerId, bookId, carew.id)).length).toBe(2);
  });

  it("shows nothing rather than garbage if the stored answer is not the expected JSON, and caps the list", () => {
    const g = (output: string) => viewPrerequisites({ output } as never).concepts;
    expect(g("not json")).toEqual([]);
    expect(g('{"concepts":[{"name":"","explanation":"x","read_more":"x"},{"name":"Ether","explanation":"Old physics.","read_more":""}]}')).toEqual([
      { name: "Ether", explanation: "Old physics.", readMore: "https://en.wikipedia.org/w/index.php?search=Ether" },
    ]);
    const many = JSON.stringify({ concepts: Array.from({ length: 12 }, (_, i) => ({ name: `C${i}`, explanation: "e", read_more: "q" })) });
    expect(g(many)).toHaveLength(8);
  });

  it("refuses other readers' books and unknown chapters", async () => {
    const model = new FakeModel();
    await expect(needToKnow(database.db, model, ownerId, { bookId, chapterId: "c-nope" })).rejects.toThrow("not found");
    await expect(needToKnow(database.db, model, "00000000-0000-0000-0000-000000000000", { bookId, chapterId: chapter("The Carew Murder Case").id })).rejects.toThrow(
      "not found",
    );
    expect(model.calls).toHaveLength(0);
  });
});

describe("STE as a reading preference for AI explanations (M6)", () => {
  it("is STE light by default (since M17; plain English before), set once for all books, and changeable per book", async () => {
    expect(await getStyles(database.db, ownerId, bookId)).toEqual({ user: "ste-light", book: null, effective: "ste-light" });
    const model = new FakeModel();
    const carew = chapter("The Carew Murder Case");

    await setStyle(database.db, ownerId, bookId, { scope: "all", style: "ste-strict" });
    const ste = await needToKnow(database.db, model, ownerId, { bookId, chapterId: carew.id });
    expect(model.calls[0].system).toContain("at this strictness level: Strict (full STE)");
    expect(model.calls[0].system).toContain("Choose the strictness level first"); // the STE skill
    expect(model.calls[0].system).not.toContain("Write in plain, precise English.");
    expect(ste.generation).toMatchObject({ style: "ste-strict", options: { style: "ste-strict" } });
    expect(ste.generation.provenance.promptName).toBe("prerequisites + ste-style + ste/SKILL + ste/substitutions");
    const text = ste.generation.concepts.map((c) => c.explanation).join("\n\n");
    expect(ste.generation.ste).toEqual({ score: steCheck(text).compliance, errors: steCheck(text).errors, warnings: steCheck(text).warnings });

    // This book only: plain English. A separate answer.
    expect(await setStyle(database.db, ownerId, bookId, { scope: "book", style: "plain" })).toEqual({ user: "ste-strict", book: "plain", effective: "plain" });
    const plain = await needToKnow(database.db, model, ownerId, { bookId, chapterId: carew.id });
    expect(plain.reused).toBe(false);
    expect(plain.generation.ste).toBeNull();
    expect(model.calls[1].system).toContain("Write in plain, precise English.");

    // Back to following the reader's setting: the stored STE answer is re-served.
    await setStyle(database.db, ownerId, bookId, { scope: "book", style: null });
    const back = await needToKnow(database.db, model, ownerId, { bookId, chapterId: carew.id });
    expect(back.reused).toBe(true);
    expect(back.generation.id).toBe(ste.generation.id);
    expect(model.calls).toHaveLength(2);
  });

  it("setting it for all books clears this book's own choice; bad input is refused", async () => {
    await setStyle(database.db, ownerId, bookId, { scope: "book", style: "ste-light" });
    expect(await setStyle(database.db, ownerId, bookId, { scope: "all", style: "ste-standard" })).toEqual({
      user: "ste-standard",
      book: null,
      effective: "ste-standard",
    });
    await expect(setStyle(database.db, ownerId, bookId, { scope: "all", style: null })).rejects.toThrow("Choose one of");
    await expect(setStyle(database.db, ownerId, bookId, { scope: "all", style: "baby" })).rejects.toThrow("Choose one of");
    await expect(setStyle(database.db, ownerId, bookId, { scope: "everyone", style: "plain" })).rejects.toThrow("Scope");
    await expect(getStyles(database.db, "00000000-0000-0000-0000-000000000000", bookId)).rejects.toThrow("Book not found");
  });
});
