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
let paragraphs: { id: string; text: string; cfi: string; chapterIndex: number }[];
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
    // Before the audiobook's first paragraph: it starts at that one.
    expect((await listenInfo(database.db, ownerId, bookId, { cfi: paragraphs[2].cfi }, withFake)).audiobook!.paragraphs[0].sectionId).toBe(paragraphs[5].id);
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
