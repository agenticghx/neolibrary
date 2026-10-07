import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { buildPackage } from "@/lib/readalong/fixture";
import { startImport } from "@/lib/readalong/importer";
import { getSpeechModel } from "@/lib/speech";
import { FakeSpeech } from "@/lib/speech/fake";
import { MemoryStorage } from "@/lib/storage";
import { speakPassage } from "./audio";
import { importBook } from "./import";
import { AUDIOBOOK_NAME, listenInfo } from "./listen";
import { getSections } from "./sections-store";

/**
 * What the Listen bar gets when it opens (M7, M13 (d)). Under Vitest the
 * voice service is always the fake; passing getSpeechModel an environment
 * without ELEVENLABS_API_KEY gives what the live site gives with no key.
 */
let database: Database;
let storage: MemoryStorage;
let ownerId: string;
let bookId: string;
let bookBytes: Uint8Array;
let paragraphs: { id: string; text: string; cfi: string; chapterIndex: number; position: number }[];
const noKey = () => getSpeechModel({});
const fake = new FakeSpeech();
const withFake = () => fake;

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  bookBytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: bookBytes })).bookId;
  paragraphs = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph");
});
afterEach(() => database.raw.close());

async function importAudiobook() {
  const read = paragraphs.slice(5, 8);
  const { zip } = buildPackage({ bookBytes, chapters: [{ title: "Chapter", paragraphs: read.map((p) => p.text), inBook: read.map((p) => p.chapterIndex) }] });
  return startImport(database.db, storage, ownerId, bookId, zip());
}

describe("what the Listen bar gets", () => {
  it("offers the book's own audiobook even with no ElevenLabs key: it costs nothing", async () => {
    expect(() => noKey()).toThrow("ELEVENLABS_API_KEY");
    // Without an audiobook and without a key: nothing to choose, as before.
    const before = await listenInfo(database.db, ownerId, bookId, { cfi: paragraphs[5].cfi }, noKey);
    expect(before).toMatchObject({ voices: [], estimate: null, track: null, audiobook: null });
    const imp = await importAudiobook();
    const info = await listenInfo(database.db, ownerId, bookId, { cfi: paragraphs[5].cfi }, noKey);
    expect(info.voices).toEqual([{ id: `upload:${imp.id}`, name: AUDIOBOOK_NAME }]);
    expect(info.estimate).toBeNull();
    expect(info.track).toBeNull();
    expect(info.audiobook!.paragraphs.map((p) => p.sectionId)).toEqual(paragraphs.slice(5, 8).map((p) => p.id));
  });

  it("puts the audiobook first, before the made-on-demand voices, and starts it at the reading position", async () => {
    const imp = await importAudiobook();
    const info = await listenInfo(database.db, ownerId, bookId, { cfi: paragraphs[6].cfi }, withFake);
    expect(info.voices.map((v) => v.id)).toEqual([`upload:${imp.id}`, "fake-ada", "fake-ben"]);
    expect(info.estimate).toBeGreaterThan(0);
    expect(info.passage.id).toBe(paragraphs[6].id);
    expect(info.audiobook!.paragraphs.map((p) => p.sectionId)).toEqual(paragraphs.slice(6, 8).map((p) => p.id));
    // At the reading position: nothing to say about where it begins.
    expect(info.audiobook!.begins).toBeNull();
    expect(info.passage.position).toBe(paragraphs[6].position);
    // Before the audiobook's first paragraph, but near (the chapter before is a few paragraphs back): it starts at that one.
    const near = await listenInfo(database.db, ownerId, bookId, { cfi: paragraphs[2].cfi }, withFake);
    expect(near.audiobook!.paragraphs[0].sectionId).toBe(paragraphs[5].id);
    expect(near.audiobook!.begins).toEqual({ label: "Story of the Door", nearby: true });
    // After its last: it is offered, but has nothing from here on.
    expect((await listenInfo(database.db, ownerId, bookId, { cfi: paragraphs[9].cfi }, withFake)).audiobook!.paragraphs).toEqual([]);
    // Asking with the audiobook's voice looks up the first made voice's stored track, not the audiobook.
    const asked = await listenInfo(database.db, ownerId, bookId, { cfi: paragraphs[6].cfi, voice: `upload:${imp.id}` }, withFake);
    expect(asked.track).toBeNull();
    // Reading on in a made voice (by section) does not look the audiobook up again.
    expect((await listenInfo(database.db, ownerId, bookId, { section: paragraphs[6].id, voice: "fake-ada" }, withFake)).audiobook).toBeNull();
  });

  it("without an audiobook, offers the made-on-demand voices only", async () => {
    const info = await listenInfo(database.db, ownerId, bookId, { cfi: paragraphs[6].cfi }, withFake);
    expect(info.voices.map((v) => v.id)).toEqual(["fake-ada", "fake-ben"]);
    expect(info.audiobook).toBeNull();
  });
});

describe("an audiobook that begins further on (M13 (d))", () => {
  it("names the chapter where it begins, and does not count it as near", async () => {
    // A package of chapter 2's opening paragraphs only, opened in chapter 1.
    const chapter2 = paragraphs.filter((p) => p.chapterIndex === paragraphs[33].chapterIndex).slice(0, 3);
    const { zip } = buildPackage({ bookBytes, chapters: [{ title: "Two", paragraphs: chapter2.map((p) => p.text), inBook: chapter2.map((p) => p.chapterIndex) }] });
    await startImport(database.db, storage, ownerId, bookId, zip());
    const far = await listenInfo(database.db, ownerId, bookId, { cfi: paragraphs[8].cfi }, withFake);
    expect(far.audiobook!.paragraphs[0].sectionId).toBe(chapter2[0].id);
    expect(far.audiobook!.begins).toEqual({ label: "Search for Mr. Hyde", nearby: false });
    // Opened in its own chapter, at its first paragraph: it begins here.
    expect((await listenInfo(database.db, ownerId, bookId, { cfi: chapter2[0].cfi }, withFake)).audiobook!.begins).toBeNull();
  });
});

// Review of #100: a book narrated whole on the Import page in a voice that is not the first on offer plays for free
// from the start: the bar opens in the voice the paragraph is saved in.
describe("which voice's saved audio the bar opens with", () => {
  it("the first voice on offer that this paragraph is saved in; a voice asked for gets its own only", async () => {
    const at = { cfi: paragraphs[5].cfi };
    const speak = (voice: string) => speakPassage(database.db, storage, fake, ownerId, { bookId, sectionId: paragraphs[5].id, voice });
    expect((await listenInfo(database.db, ownerId, bookId, at, withFake)).track).toBeNull();
    await speak("fake-ben");
    expect((await listenInfo(database.db, ownerId, bookId, at, withFake)).track).toMatchObject({ voice: "fake-ben", sectionId: paragraphs[5].id });
    // Asked for a voice (the bar's own choice), it gets that voice's saved audio only.
    expect((await listenInfo(database.db, ownerId, bookId, { ...at, voice: "fake-ada" }, withFake)).track).toBeNull();
    expect((await listenInfo(database.db, ownerId, bookId, { section: paragraphs[5].id, voice: "fake-ben" }, withFake)).track).toMatchObject({ voice: "fake-ben" });
    // Saved in both: the first on offer, as before.
    await speak("fake-ada");
    expect((await listenInfo(database.db, ownerId, bookId, at, withFake)).track).toMatchObject({ voice: "fake-ada" });
    // Another paragraph, saved in neither: none.
    expect((await listenInfo(database.db, ownerId, bookId, { cfi: paragraphs[6].cfi }, withFake)).track).toBeNull();
  });
});

describe("Listen in a PDF book (M13 (e))", () => {
  it("offers only the book's own audiobook: made voices cannot be placed on a PDF page yet", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    doc.addPage([612, 792]).drawText("One short paragraph on the only page of this test.", { x: 72, y: 700, size: 12, font });
    const bytes = new Uint8Array(await doc.save());
    const id = (await importBook(database.db, storage, ownerId, { name: "one.pdf", bytes })).bookId;
    const before = await listenInfo(database.db, ownerId, id, { cfi: "epubcfi(/6/2)" }, withFake);
    expect(before).toMatchObject({ fileType: "pdf", voices: [], estimate: null, track: null, audiobook: null });
    const [p] = (await getSections(database.db, ownerId, id)).filter((x) => x.kind === "paragraph");
    const { zip } = buildPackage({ bookBytes: bytes, chapters: [{ title: "One", paragraphs: [p.text], inBook: [0] }] });
    const imp = await startImport(database.db, storage, ownerId, id, zip());
    const after = await listenInfo(database.db, ownerId, id, { cfi: "epubcfi(/6/2)" }, withFake);
    expect(after.voices).toEqual([{ id: `upload:${imp.id}`, name: AUDIOBOOK_NAME }]);
    expect(after.audiobook!.paragraphs[0].inPage).toHaveLength(p.text.split(" ").length);
    // An EPUB still offers the made voices.
    expect((await listenInfo(database.db, ownerId, bookId, { cfi: paragraphs[6].cfi }, withFake)).fileType).toBe("epub");
  });
});

// M14 step 6b: away from the page, the mini-player shows the sentence being read, its chapter and the book.
describe("what the mini-player gets", () => {
  const chapterOf = async (chapterIndex: number) =>
    (await getSections(database.db, ownerId, bookId)).find((s) => s.kind === "chapter" && s.chapterIndex === chapterIndex)!.label.trim();

  it("a paragraph's text, the paragraphs before and after it, its chapter and the book", async () => {
    const info = await listenInfo(database.db, ownerId, bookId, { cfi: paragraphs[5].cfi }, withFake);
    expect(info.passage).toMatchObject({ id: paragraphs[5].id, text: paragraphs[5].text, prevId: paragraphs[4].id, nextId: paragraphs[6].id });
    expect(info.passage.chapter).toBe(await chapterOf(paragraphs[5].chapterIndex));
    expect(info.passage.chapter).not.toBe("");
    expect(info.book.title).toMatch(/Jekyll/);
    // The first paragraph has none before it.
    expect((await listenInfo(database.db, ownerId, bookId, { section: paragraphs[0].id }, withFake)).passage.prevId).toBeNull();
  });

  it("each audiobook paragraph's text, and the name of each chapter in the part", async () => {
    await importAudiobook();
    const ab = (await listenInfo(database.db, ownerId, bookId, { cfi: paragraphs[5].cfi }, withFake)).audiobook!;
    expect(ab.paragraphs.map((p) => p.text)).toEqual(paragraphs.slice(5, 8).map((p) => p.text));
    for (const i of new Set(ab.paragraphs.map((p) => p.chapterIndex))) expect(ab.chapters[i]).toBe(await chapterOf(i));
  });
});

