import { readFileSync } from "node:fs";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { audioTracks } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { importBook } from "@/lib/library/import";
import { getSections } from "@/lib/library/sections-store";
import { MemoryStorage } from "@/lib/storage";
import { buildPackage } from "./fixture";
import { deleteImport, finishImport, listImports, putAudioPart, ReadalongError, startImport } from "./importer";

/**
 * M13 (c2): importing a read-along package into a book, with the audio in
 * the zip or sent in parts. Uses the real Jekyll and Hyde EPUB, so the
 * paragraphs are the app's own.
 */
let database: Database;
let storage: MemoryStorage;
let ownerId: string;
let bookId: string;
let bookBytes: Uint8Array;
let paragraphs: { id: string; text: string; chapterIndex: number }[];

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  bookBytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: bookBytes })).bookId;
  paragraphs = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph");
});
afterEach(() => database.raw.close());

/** A package reading paragraphs [from, from+n) of the book, with a spoken heading first. */
function pkgFor(from: number, n: number, bytes = bookBytes) {
  const read = paragraphs.slice(from, from + n);
  return buildPackage({ bookBytes: bytes, chapters: [{ title: "Chapter", paragraphs: ["Chapter One.", ...read.map((p) => p.text)], inBook: [null, ...read.map((p) => p.chapterIndex)] }] });
}
const withoutAudio = (files: Record<string, Uint8Array>) => zipSync(Object.fromEntries(Object.entries(files).filter(([n]) => !n.startsWith("audio/"))));
const tracks = () => database.db.select().from(audioTracks);

describe("importing a read-along package (M13)", () => {
  it("imports a package with its audio in the zip: one track per paragraph, each a stretch of the one audio file", async () => {
    const { zip } = pkgFor(5, 3);
    const s = await startImport(database.db, storage, ownerId, bookId, zip());
    expect(s.status).toBe("ready");
    expect(s.report).toEqual({ chapters: [expect.objectContaining({ matchedWords: expect.any(Number) })], paragraphs: 3 });
    const t = (await tracks()).sort((a, b) => a.audioStartMs! - b.audioStartMs!);
    expect(t.map((x) => x.sectionId)).toEqual(paragraphs.slice(5, 8).map((p) => p.id));
    expect(new Set(t.map((x) => x.audioKey)).size).toBe(1);
    expect(t[0]).toMatchObject({ source: "upload", provider: "upload", voice: `upload:${s.id}`, importId: s.id, mime: "audio/wav", costUsd: 0 });
    // The stretches follow each other through the file, and each word's
    // offsets point at that word in the paragraph's own text.
    expect(t[0].audioEndMs!).toBeLessThan(t[1].audioStartMs!);
    for (const x of t) {
      const text = paragraphs.find((p) => p.id === x.sectionId)!.text;
      expect(x.words.length).toBe(text.split(/\s+/).length);
      expect(x.words[0][0]).toBe(x.audioStartMs);
      const [, , f, to] = x.words[1];
      expect(text.slice(f, to)).toBe(text.split(/\s+/)[1]);
    }
    expect(await storage.stat(t[0].audioKey)).toMatchObject({ contentType: "audio/wav" });
  });

  it("takes long audio in parts: nothing plays until every part is in and the file matches the package", async () => {
    const { files } = pkgFor(5, 2);
    const s = await startImport(database.db, storage, ownerId, bookId, withoutAudio(files));
    expect(s.status).toBe("uploading");
    expect(s.waitingFor).toEqual(["audio/01.wav"]);
    expect(await tracks()).toEqual([]);
    const audio = files["audio/01.wav"];
    const cut = [0, 1000, 5000, audio.byteLength];
    const parts = [];
    for (let i = 0; i < 3; i++) parts.push(await putAudioPart(database.db, storage, ownerId, bookId, s.id, "audio/01.wav", i + 1, audio.slice(cut[i], cut[i + 1])));
    const done = await finishImport(database.db, storage, ownerId, bookId, s.id, { "audio/01.wav": parts });
    expect(done.status).toBe("ready");
    expect(await tracks()).toHaveLength(2);
    expect((await listImports(database.db, ownerId, bookId)).map((i) => i.status)).toEqual(["ready"]);
  });

  it("refuses audio that is not the file the package was made with, and lets it be sent again", async () => {
    const { files } = pkgFor(5, 2);
    const s = await startImport(database.db, storage, ownerId, bookId, withoutAudio(files));
    const wrong = files["audio/01.wav"].slice();
    wrong[200] ^= 1;
    const p = await putAudioPart(database.db, storage, ownerId, bookId, s.id, "audio/01.wav", 1, wrong);
    await expect(finishImport(database.db, storage, ownerId, bookId, s.id, { "audio/01.wav": [p] })).rejects.toThrow("is not the audio this package was made with");
    expect(await tracks()).toEqual([]);
    const again = await putAudioPart(database.db, storage, ownerId, bookId, s.id, "audio/01.wav", 1, files["audio/01.wav"]);
    expect((await finishImport(database.db, storage, ownerId, bookId, s.id, { "audio/01.wav": [again] })).status).toBe("ready");
  });

  it("refuses a package made from another file of the book, a broken package, and someone else's book", async () => {
    await expect(startImport(database.db, storage, ownerId, bookId, pkgFor(5, 2, new Uint8Array([1, 2, 3])).zip())).rejects.toThrow("made from a different file");
    await expect(startImport(database.db, storage, ownerId, bookId, zipSync({ "notes.txt": new Uint8Array([104, 105]) }))).rejects.toThrow("This is not a read-along package: No manifest.json");
    await expect(startImport(database.db, storage, crypto.randomUUID(), bookId, pkgFor(5, 2).zip())).rejects.toThrow(ReadalongError);
  });

  it("a new import replaces the book's earlier one, and deleting an import removes its tracks and audio", async () => {
    const first = await startImport(database.db, storage, ownerId, bookId, pkgFor(5, 2).zip());
    const firstKey = (await tracks())[0].audioKey;
    const second = await startImport(database.db, storage, ownerId, bookId, pkgFor(8, 1).zip());
    expect((await tracks()).map((t) => t.importId)).toEqual([second.id]);
    expect(await storage.stat(firstKey)).toBeNull();
    expect((await listImports(database.db, ownerId, bookId)).map((i) => i.id)).toEqual([second.id]);
    expect(first.id).not.toBe(second.id);
    const key = (await tracks())[0].audioKey;
    await deleteImport(database.db, storage, ownerId, bookId, second.id);
    expect(await tracks()).toEqual([]);
    expect(await storage.stat(key)).toBeNull();
  });
});
