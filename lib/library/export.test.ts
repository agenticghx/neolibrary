import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hiddenMachinery } from "@/data/paths/hidden-machinery";
import { FakeModel } from "@/lib/ai/fake";
import { spending } from "@/lib/ai/generate";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { readFileSync } from "node:fs";
import { createAnnotation, deleteAnnotation, listAnnotations, updateAnnotation } from "./annotations";
import { costReport } from "./costs";
import { exportLibrary, importLibrary, wipeLibrary, type LibraryExport } from "./export";
import { importBook } from "./import";
import { seedPath } from "./paths";
import { savePosition } from "./reading";
import { eq } from "drizzle-orm";
import { annotations, books, generations, users } from "@/lib/db/schema";
import { setStyle } from "./ai-style";
import { setPreferences } from "./preferences";
import { FakeSpeech, wav } from "@/lib/speech/fake";
import { FakeTranscriber } from "@/lib/speech/transcribe";
import { createVoiceNote } from "./voice-notes";
import { recordReading } from "./reading-stats";
import { speakPassage } from "./audio";
import { markQuestion, questionBank } from "./questions";
import { rewriteParagraph } from "./rewrite";
import { getSections } from "./sections-store";
import { createCollection, listShelf, setInCollection } from "./shelf";
import { buildPackage } from "@/lib/readalong/fixture";
import { startImport } from "@/lib/readalong/importer";

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
    // M13: an uploaded read-along audiobook for two paragraphs.
    const later = (await getSections(database.db, ownerId, bookId)).filter((x) => x.kind === "paragraph").slice(10, 12);
    const audiobook = await startImport(
      database.db,
      storage,
      ownerId,
      bookId,
      buildPackage({ bookBytes: file, chapters: [{ title: "Ch", paragraphs: later.map((x) => x.text), inBook: later.map((x) => x.chapterIndex) }] }).zip(),
    );
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
    await setPreferences(database.db, ownerId, { rewrittenView: "rewritten" });

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
    expect(before.audioTracks).toEqual([
      expect.objectContaining({ id: track.track.id, voice: "fake-ben", audioKey: track.track.audioKey, importId: null }),
      expect.objectContaining({ source: "upload", importId: audiobook.id, audioStartMs: expect.any(Number) }),
      expect.objectContaining({ source: "upload", importId: audiobook.id, audioStartMs: expect.any(Number) }),
    ]);
    expect(before.audioTracks![0].words).toEqual(track.track.words);
    expect(before.readalongImports).toEqual([expect.objectContaining({ id: audiobook.id, bookId, status: "ready", pending: null })]);
    expect(before.readingSessions).toEqual([
      expect.objectContaining({
        bookId,
        activeSeconds: 300,
        words: 1250,
        pages: 4,
        chapters: [{ key: "c1.xhtml", label: "Chapter 1", position: 0.1, activeSeconds: 300, words: 1250 }],
      }),
    ]);
    expect(before.settings).toEqual({ aiStyle: "ste-standard", rewrittenView: "rewritten" });
    expect(before.books.find((b) => b.id === bookId)?.aiStyle).toBe("ste-strict");
    expect(before.generations).toEqual([
      expect.objectContaining({ kind: "rewrite", sectionId: paragraph.id, options: { level: "plain" }, model: "fake" }),
      expect.objectContaining({ kind: "questions", sectionId: carew.id, options: { style: "ste-light" } }),
      expect.objectContaining({ kind: "transcript", provider: "elevenlabs", output: voice.annotation.voice!.transcript }),
    ]);
    expect(before.collections).toEqual([expect.objectContaining({ name: "Time travel", bookIds: [bookId] })]);

    await wipeLibrary(database.db, ownerId);
    await database.db.update(users).set({ aiStyle: "plain", rewrittenView: "side" }).where(eq(users.id, ownerId));
    const empty = await exportLibrary(database.db, ownerId);
    expect([empty.books, empty.paths, empty.collections, empty.annotations, empty.generations, empty.questionMarks, empty.audioTracks, empty.readalongImports, empty.readingSessions]).toEqual([[], [], [], [], [], [], [], [], []]);

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

describe("a library file may only point inside the importing reader's library", () => {
  let otherId: string;
  const bookId = crypto.randomUUID();
  const now = new Date().toISOString();
  beforeEach(async () => {
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    otherId = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
  });

  const book = (fileKey = `books/${ownerId}/${bookId}.epub`) => ({
    id: bookId,
    title: "Meditations",
    author: "Marcus Aurelius",
    note: "",
    unverified: false,
    file: { key: fileKey, name: "m.epub", type: "epub" as const, size: 1 },
    coverKey: null as string | null,
    language: null,
    publisher: null,
    description: null,
    toc: [],
    pageCount: null,
    progress: 0,
    lastOpenedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const libraryFile = (extra: Partial<LibraryExport> = {}): LibraryExport => ({
    format: "neolibrary-library",
    version: 1,
    exportedAt: now,
    books: [book()],
    paths: [],
    collections: [],
    ...extra,
  });
  const generation = (costUsd: number, over: Partial<NonNullable<LibraryExport["generations"]>[number]> = {}) => ({
    id: crypto.randomUUID(),
    bookId,
    sectionId: null,
    kind: "rewrite",
    options: {},
    cacheKey: "k",
    provider: "anthropic",
    model: "m",
    promptName: "p",
    promptHash: "h",
    inputHash: "i",
    inputTokens: 1,
    outputTokens: 1,
    costUsd,
    output: "o",
    createdAt: now,
    ...over,
  });
  const track = (costUsd: number, over: Partial<NonNullable<LibraryExport["audioTracks"]>[number]> = {}) => ({
    id: crypto.randomUUID(),
    bookId,
    sectionId: "p-1",
    source: "tts" as const,
    provider: "elevenlabs",
    model: "m",
    voice: "v",
    cacheKey: "k",
    inputHash: "i",
    characters: 1,
    costUsd,
    audioKey: `audio/${ownerId}/${bookId}/t.mp3`,
    mime: "audio/mpeg",
    durationMs: 1,
    words: [],
    createdAt: now,
    ...over,
  });
  const note = (over: Partial<NonNullable<LibraryExport["annotations"]>[number]> = {}) => {
    const id = crypto.randomUUID();
    return {
      id,
      annotationId: id,
      version: 1,
      kind: "note" as const,
      targetType: "book" as const,
      bookId,
      targetId: null,
      sectionId: null,
      cfi: null,
      quote: { exact: "", prefix: "", suffix: "" },
      color: null,
      body: "A note",
      deleted: false,
      createdAt: now,
      ...over,
    };
  };
  const audiobook = (over: Partial<NonNullable<LibraryExport["readalongImports"]>[number]> = {}) => ({
    id: crypto.randomUUID(),
    bookId,
    status: "ready" as const,
    title: null,
    voice: null,
    madeWith: null,
    manifest: {},
    report: { chapters: [], paragraphs: 0 },
    audio: [{ file: "a.mp3", key: `audio/${ownerId}/${bookId}/readalong-1.mp3`, sha256: "x", seconds: 1, mime: "audio/mpeg", uploadId: null as string | null }],
    pending: null,
    createdAt: now,
    finishedAt: now,
    ...over,
  });
  /** Nothing of the file was written: the reader's library is still empty. */
  const nothingImported = async () => {
    const e = await exportLibrary(database.db, ownerId);
    expect([e.books, e.paths, e.collections, e.annotations, e.generations, e.questionMarks, e.audioTracks, e.readalongImports, e.readingSessions]).toEqual([[], [], [], [], [], [], [], [], []]);
  };

  it("keeps imported costs as recorded, but they do not count toward the spending caps", async () => {
    // Another reader's real spending this month, which the caps must keep counting.
    await database.db.insert(generations).values({ ...generation(0.25, { bookId: null }), ownerId: otherId, createdAt: new Date() });
    const before = [await spending(database.db, "anthropic", null), await spending(database.db, "elevenlabs", null)];
    expect(before.map((s) => s.month)).toEqual([0.25, 0]);

    await importLibrary(database.db, ownerId, libraryFile({ generations: [generation(1e9)], audioTracks: [track(1e9)] }));
    expect([await spending(database.db, "anthropic", null), await spending(database.db, "elevenlabs", null)]).toEqual(before);
    expect(await spending(database.db, "anthropic", bookId)).toEqual({ month: 0.25, book: 0 });
    expect(await spending(database.db, "elevenlabs", bookId)).toEqual({ month: 0, book: 0 });
    const report = await costReport(database.db, ownerId, new Date(), {});
    expect(report.services.map((s) => [s.provider, s.spentUsd, s.calls])).toEqual([
      ["anthropic", 0.25, 1],
      ["elevenlabs", 0, 0],
      ["openai", 0, 0],
    ]);
    expect([report.books, report.others]).toEqual([[], { anthropic: 0.25 }]);
    // The export still says what they cost (provenance).
    const after = await exportLibrary(database.db, ownerId);
    expect([after.generations!.map((g) => g.costUsd), after.audioTracks!.map((t) => t.costUsd)]).toEqual([[1e9], [1e9]]);
  });

  it("brings back stored files that are in the reader's own folders", async () => {
    const own = `audio/${ownerId}/${bookId}`;
    const picture = { source: "generated", key: `images/${ownerId}/${bookId}/${crypto.randomUUID()}.png`, subject: "s", model: "m" };
    const ab = audiobook({ audio: [{ ...audiobook().audio[0], key: `${own}/readalong-1.mp3` }] });
    await importLibrary(
      database.db,
      ownerId,
      libraryFile({
        books: [{ ...book(), coverKey: `covers/${ownerId}/${bookId}.jpg` }],
        annotations: [note({ kind: "voice", body: "", audio: { key: `${own}/notes/n.wav`, mime: "audio/wav", durationMs: 1 } }), note({ kind: "image", body: "", picture, createdAt: new Date(Date.parse(now) + 1000).toISOString() })],
        readalongImports: [ab],
        audioTracks: [track(0, { source: "upload", importId: ab.id, audioKey: `${own}/readalong-1.mp3` })],
      }),
    );
    const e = await exportLibrary(database.db, ownerId);
    expect([e.books[0].coverKey, e.annotations!.map((a) => a.audio?.key ?? a.picture), e.audioTracks!.map((t) => t.importId)]).toEqual([
      `covers/${ownerId}/${bookId}.jpg`,
      [`${own}/notes/n.wav`, picture],
      [ab.id],
    ]);
  });

  it("refuses a cost that is negative or not finite, and writes nothing", async () => {
    const huge = JSON.parse('{"c": 1e999}').c as number; // JSON reads 1e999 as Infinity
    for (const extra of [{ generations: [generation(-5)] }, { audioTracks: [track(-5)] }, { generations: [generation(huge)] }, { audioTracks: [track(huge)] }]) {
      await expect(importLibrary(database.db, ownerId, libraryFile(extra))).rejects.toThrow("cost is not an amount of money");
      await nothingImported();
    }
  });

  it("refuses a book file stored outside the reader's own folder, and writes nothing", async () => {
    for (const key of [`books/${otherId}/x.epub`, `books/${crypto.randomUUID()}/x.epub`, `books/${ownerId}/../${otherId}/x.epub`, `covers/${ownerId}/x.epub`]) {
      await expect(importLibrary(database.db, ownerId, libraryFile({ books: [book(key)] }))).rejects.toThrow('The file of "Meditations" is not stored in your library.');
      await nothingImported();
    }
  });

  it("refuses covers, recordings, pictures and audio stored outside the reader's own folders", async () => {
    const elsewhere = `audio/${otherId}/${bookId}/t.mp3`;
    const cases: [Partial<LibraryExport>, string][] = [
      [{ books: [{ ...book(), coverKey: `covers/${otherId}/${bookId}.jpg` }] }, 'The cover of "Meditations"'],
      [{ audioTracks: [track(0, { audioKey: elsewhere })] }, "A read-aloud track's audio file is not stored in your library."],
      [{ readalongImports: [audiobook({ audio: [{ ...audiobook().audio[0], key: elsewhere }] })] }, "An audiobook's audio file is not stored in your library."],
      [{ annotations: [note({ kind: "voice", body: "", audio: { key: elsewhere, mime: "audio/wav", durationMs: 1 } })] }, "A voice note's recording is not stored in your library."],
      [
        { annotations: [note({ kind: "image", body: "", picture: { source: "generated", key: `images/${otherId}/${bookId}/${crypto.randomUUID()}.png`, subject: "s", model: "m" } })] },
        "A pinned picture is not one your library can show.",
      ],
    ];
    for (const [extra, message] of cases) {
      await expect(importLibrary(database.db, ownerId, libraryFile(extra))).rejects.toThrow(message);
      await nothingImported();
    }
  });

  it("refuses rows that link to a book, question bank, audiobook or Path the file does not bring", async () => {
    const [theirs] = await database.db.insert(books).values({ ownerId: otherId, title: "Theirs" }).returning();
    const [theirBank] = await database.db
      .insert(generations)
      .values({ ...generation(0, { bookId: theirs.id, kind: "questions" }), ownerId: otherId, createdAt: new Date() })
      .returning();
    const slot = { id: crypto.randomUUID(), kind: "N" as const, bookId: theirs.id, note: "" };
    const path = { id: crypto.randomUUID(), slug: "s", title: "Stoics", description: "", sourceUrl: null, createdAt: now, pillars: [{ id: crypto.randomUUID(), slug: "a", title: "A", question: "", group: "main", slots: [slot] }] };
    const cases: [Partial<LibraryExport>, string][] = [
      [{ paths: [path] }, 'The Path "Stoics" lists a book that is not in this file.'],
      [{ collections: [{ id: crypto.randomUUID(), name: "Mine", createdAt: now, bookIds: [bookId, theirs.id] }] }, 'The collection "Mine" holds a book that is not in this file.'],
      [{ annotations: [note({ bookId: theirs.id })] }, "A note is on a book that is not in this file."],
      [{ annotations: [note({ bookId: null, targetType: "pillar", targetId: crypto.randomUUID() })] }, "A note is on something that is not in this file."],
      [{ generations: [generation(0, { bookId: theirs.id })] }, "An AI text is about a book that is not in this file."],
      [
        { questionMarks: [{ id: crypto.randomUUID(), bookId, chapterId: "c", generationId: theirBank.id, questionIndex: 0, correct: true, createdAt: now }] },
        "A question mark is on a book or question bank that is not in this file.",
      ],
      [{ readalongImports: [audiobook({ bookId: theirs.id })] }, "An audiobook is for a book that is not in this file."],
      [{ audioTracks: [track(0, { bookId: theirs.id })] }, "A read-aloud track is for a book that is not in this file."],
      [{ audioTracks: [track(0, { importId: crypto.randomUUID() })] }, "A read-aloud track belongs to an audiobook that is not in this file."],
      [
        { readingSessions: [{ id: crypto.randomUUID(), bookId: theirs.id, startedAt: now, endedAt: now, activeSeconds: 1, words: 1, pages: 1 }] },
        "A reading session is for a book that is not in this file.",
      ],
    ];
    for (const [extra, message] of cases) {
      await expect(importLibrary(database.db, ownerId, libraryFile(extra))).rejects.toThrow(message);
      await nothingImported();
    }
  });

  it("refuses rows that already exist for another reader, and a half-uploaded audiobook", async () => {
    const [theirs] = await database.db.insert(books).values({ ownerId: otherId, title: "Theirs" }).returning();
    const theirNote = crypto.randomUUID();
    await database.db.insert(annotations).values({ id: theirNote, annotationId: theirNote, version: 1, ownerId: otherId, kind: "note", targetType: "book", bookId: theirs.id, body: "Theirs" });

    // A note id another reader uses (the database does not keep these unique).
    await expect(importLibrary(database.db, ownerId, libraryFile({ annotations: [note({ id: crypto.randomUUID(), annotationId: theirNote, version: 2 })] }))).rejects.toThrow(
      "Some notes in this file already exist in the library.",
    );
    await nothingImported();
    // A book id already taken: the database refuses it and the import is rolled back (the route answers 400).
    await expect(importLibrary(database.db, ownerId, libraryFile({ books: [book(), { ...book(`books/${ownerId}/x.epub`), id: theirs.id }] }))).rejects.toThrow();
    await nothingImported();
    expect((await database.db.select({ ownerId: books.ownerId }).from(books).where(eq(books.id, theirs.id)))[0].ownerId).toBe(otherId);
    // An audiobook still uploading cannot be finished from a file.
    await expect(
      importLibrary(database.db, ownerId, libraryFile({ readalongImports: [audiobook({ status: "uploading", audio: [{ ...audiobook().audio[0], uploadId: "u-1" }] })] })),
    ).rejects.toThrow("An audiobook was still uploading when this file was made.");
    await nothingImported();
  });

  it("the database refuses a negative or infinite cost (migration 0021)", async () => {
    await database.db.insert(books).values({ id: bookId, ownerId, title: "Meditations" });
    const addGeneration = (cost: string) =>
      database.raw.query(
        "INSERT INTO generations (owner_id, kind, cache_key, provider, model, prompt_name, prompt_hash, input_hash, cost_usd, output) VALUES ($1, 'rewrite', 'k', 'anthropic', 'm', 'p', 'h', 'i', $2::float8, 'o')",
        [ownerId, cost],
      );
    const addTrack = (cost: string) =>
      database.raw.query(
        "INSERT INTO audio_tracks (owner_id, book_id, section_id, source, voice, cache_key, input_hash, cost_usd, audio_key, mime, duration_ms, words) VALUES ($1, $2, 'p-1', 'tts', 'v', 'k', 'i', $3::float8, 'audio/x', 'audio/mpeg', 1, '[]')",
        [ownerId, bookId, cost],
      );
    for (const cost of ["-1", "Infinity", "NaN"]) {
      await expect(addGeneration(cost)).rejects.toThrow("generations_cost_usd_check");
      await expect(addTrack(cost)).rejects.toThrow("audio_tracks_cost_usd_check");
    }
    await addGeneration("0.5");
    await addTrack("0");
    expect(await database.raw.query<{ n: number }>("SELECT ((SELECT count(*) FROM generations WHERE NOT imported) + (SELECT count(*) FROM audio_tracks WHERE NOT imported))::int AS n")).toEqual([{ n: 2 }]);
  });
});
