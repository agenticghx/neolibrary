import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hiddenMachinery } from "@/data/paths/hidden-machinery";
import { FakeModel } from "@/lib/ai/fake";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { readFileSync } from "node:fs";
import { createAnnotation, deleteAnnotation, listAnnotations, updateAnnotation } from "./annotations";
import { exportLibrary, importLibrary, wipeLibrary } from "./export";
import { importBook } from "./import";
import { seedPath } from "./paths";
import { savePosition } from "./reading";
import { eq } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import { setStyle } from "./ai-style";
import { FakeSpeech, wav } from "@/lib/speech/fake";
import { FakeTranscriber } from "@/lib/speech/transcribe";
import { createVoiceNote } from "./voice-notes";
import { recordReading } from "./reading-stats";
import { speakPassage } from "./audio";
import { markQuestion, questionBank } from "./questions";
import { rewriteParagraph } from "./rewrite";
import { getSections } from "./sections-store";
import { createCollection, listShelf, setInCollection } from "./shelf";

let database: Database;
let ownerId: string;
beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

const strip = (e: Awaited<ReturnType<typeof exportLibrary>>) => ({ ...e, exportedAt: "" });

describe("library export (ground rule 7)", () => {
  it("export → wipe → import gives back an identical library", async () => {
    const storage = new MemoryStorage();
    await seedPath(database.db, ownerId, hiddenMachinery);
    const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/wells-the-time-machine.epub", import.meta.url)));
    const { bookId } = await importBook(database.db, storage, ownerId, { name: "tm.epub", bytes: file });
    const c = await createCollection(database.db, ownerId, "Time travel");
    await setInCollection(database.db, ownerId, c.id, bookId, true);
    await savePosition(database.db, ownerId, bookId, { cfi: "epubcfi(/6/8!/4/2/1:0)", fraction: 0.25 });
    const note = await createAnnotation(database.db, ownerId, { kind: "note", bookId, body: "First" });
    await updateAnnotation(database.db, ownerId, note.id, { body: "Second" });
    const gone = await createAnnotation(database.db, ownerId, { kind: "note", bookId, body: "Hidden later" });
    await deleteAnnotation(database.db, ownerId, gone.id);
    const [paragraph] = (await getSections(database.db, ownerId, bookId)).filter((x) => x.kind === "paragraph");
    await rewriteParagraph(database.db, new FakeModel(), ownerId, { bookId, sectionId: paragraph.id, level: "plain" });
    const carew = (await getSections(database.db, ownerId, bookId)).find((x) => x.kind === "chapter")!;
    const bank = await questionBank(database.db, new FakeModel(), ownerId, { bookId, chapterId: carew.id });
    await markQuestion(database.db, ownerId, { generationId: bank.generation.id, index: 0, correct: false });
    await markQuestion(database.db, ownerId, { generationId: bank.generation.id, index: 0, correct: true });
    const track = await speakPassage(database.db, storage, new FakeSpeech(), ownerId, { bookId, sectionId: paragraph.id, voice: "fake-ben" });
    const voice = await createVoiceNote(database.db, storage, new FakeTranscriber(), ownerId, {
      bookId,
      cfi: paragraph.cfi.replace(/\)$/, "/1:0)"),
      quote: { exact: paragraph.text.slice(0, 20) },
      audio: wav(1),
      mime: "audio/wav",
      durationMs: 1000,
    });
    await recordReading(database.db, ownerId, {
      sessionId: "11111111-2222-4333-8444-555555555555",
      bookId,
      startedAt: "2026-10-01T10:00:00Z",
      activeSeconds: 300,
      words: 1250,
      pages: 4,
      chapters: [{ key: "c1.xhtml", label: "Chapter 1", position: 0.1, activeSeconds: 300, words: 1250 }],
    });
    await setStyle(database.db, ownerId, bookId, { scope: "all", style: "ste-standard" });
    await setStyle(database.db, ownerId, bookId, { scope: "book", style: "ste-strict" });

    const before = await exportLibrary(database.db, ownerId);
    expect(before.books.length).toBeGreaterThan(100);
    expect(before.paths[0].pillars.length).toBe(hiddenMachinery.pillars.length);
    expect(before.books.find((b) => b.id === bookId)).toMatchObject({ position: "epubcfi(/6/8!/4/2/1:0)", progress: 0.25 });
    expect(before.annotations!.map((a) => [a.body, a.version, a.deleted])).toEqual([
      ["First", 1, false],
      ["Second", 2, false],
      ["Hidden later", 1, false],
      ["Hidden later", 2, true],
      ["", 1, false],
    ]);
    expect(before.annotations!.at(-1)).toMatchObject({
      kind: "voice",
      audio: { key: voice.annotation.voice!.audioKey, mime: "audio/wav", durationMs: 1000 },
      transcript: voice.annotation.voice!.transcript,
    });
    expect(before.questionMarks!.map((m) => [m.questionIndex, m.correct])).toEqual([
      [0, false],
      [0, true],
    ]);
    expect(before.audioTracks).toEqual([expect.objectContaining({ id: track.track.id, voice: "fake-ben", audioKey: track.track.audioKey })]);
    expect(before.audioTracks![0].words).toEqual(track.track.words);
    expect(before.readingSessions).toEqual([
      expect.objectContaining({
        bookId,
        activeSeconds: 300,
        words: 1250,
        pages: 4,
        chapters: [{ key: "c1.xhtml", label: "Chapter 1", position: 0.1, activeSeconds: 300, words: 1250 }],
      }),
    ]);
    expect(before.settings).toEqual({ aiStyle: "ste-standard" });
    expect(before.books.find((b) => b.id === bookId)?.aiStyle).toBe("ste-strict");
    expect(before.generations).toEqual([
      expect.objectContaining({ kind: "rewrite", sectionId: paragraph.id, options: { level: "plain" }, model: "fake" }),
      expect.objectContaining({ kind: "questions", sectionId: carew.id, options: { style: "plain" } }),
      expect.objectContaining({ kind: "transcript", provider: "elevenlabs", output: voice.annotation.voice!.transcript }),
    ]);
    expect(before.collections).toEqual([expect.objectContaining({ name: "Time travel", bookIds: [bookId] })]);

    await wipeLibrary(database.db, ownerId);
    await database.db.update(users).set({ aiStyle: "plain" }).where(eq(users.id, ownerId));
    const empty = await exportLibrary(database.db, ownerId);
    expect([empty.books, empty.paths, empty.collections, empty.annotations, empty.generations, empty.questionMarks, empty.audioTracks, empty.readingSessions]).toEqual([[], [], [], [], [], [], [], []]);

    await importLibrary(database.db, ownerId, JSON.parse(JSON.stringify(before)));
    expect(strip(await exportLibrary(database.db, ownerId))).toEqual(strip(before));
    expect((await listShelf(database.db, ownerId, { collectionId: c.id })).map((b) => b.title)).toEqual(["The Time Machine"]);
    expect((await listAnnotations(database.db, ownerId, bookId)).map((a) => [a.kind, a.body])).toEqual([
      ["note", "Second"],
      ["voice", ""],
    ]);
  });

  it("refuses files that are not a library export", async () => {
    await expect(importLibrary(database.db, ownerId, { hello: 1 })).rejects.toThrow("not a Neolibrary library export");
    await expect(
      importLibrary(database.db, ownerId, { format: "neolibrary-library", version: 99, books: [], paths: [], collections: [] }),
    ).rejects.toThrow("newer version");
  });
});
