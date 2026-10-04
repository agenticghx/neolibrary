import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { createFirstAdmin } from "@/lib/auth/service";
import { createApiToken, revokeApiToken, userForApiToken } from "@/lib/auth/tokens";
import { agentAddNote, agentBooks, agentNotes, agentSearch } from "@/lib/agent/library";
import { createAnnotation, listAnnotations } from "@/lib/library/annotations";
import { speakPassage } from "@/lib/library/audio";
import { costReport } from "@/lib/library/costs";
import { crossLinks } from "@/lib/library/crosslinks";
import { exportLibrary, importLibrary, wipeLibrary } from "@/lib/library/export";
import { importBook } from "@/lib/library/import";
import { seedPath } from "@/lib/library/paths";
import { questionBank } from "@/lib/library/questions";
import { chapterStatsByBook, recordReading, statsByBook, statsByPathSlot, statsByWeek } from "@/lib/library/reading-stats";
import { rewriteParagraph } from "@/lib/library/rewrite";
import { searchLibrary, searchNotes } from "@/lib/library/search";
import { getSections } from "@/lib/library/sections-store";
import { createVoiceNote } from "@/lib/library/voice-notes";
import { FakeSpeech, wav } from "@/lib/speech/fake";
import { FakeTranscriber } from "@/lib/speech/transcribe";
import { MemoryStorage } from "@/lib/storage";
import { openDatabase, type Database } from "./client";
import { loadMigrations, migrateDown, migrateUp } from "./migrate";

/**
 * The same checks on a real Postgres, through the database library production
 * uses (postgres.js). Every other test uses PGlite (Postgres inside Node),
 * which hid a production-only bug once (migrations refused with
 * UNSAFE_TRANSACTION, every page a 500). CI runs this with a Postgres service
 * (`npm run test:postgres`, which insists on TEST_DATABASE_URL); locally it
 * runs when TEST_DATABASE_URL points at a Postgres you can create databases on.
 * Each run makes its own throwaway database and drops it afterwards.
 */
const base = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_POSTGRES === "1" && !base) throw new Error("TEST_DATABASE_URL must point at a Postgres server for this run.");

describe.skipIf(!base)("on a real Postgres (production's database library)", () => {
  let admin: postgres.Sql;
  let name: string;
  let database: Database;

  beforeAll(async () => {
    admin = postgres(base!, { max: 1, onnotice: () => {} });
    name = `neolibrary_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base!);
    url.pathname = `/${name}`;
    database = await openDatabase({ DATABASE_URL: url.toString() });
    expect(database.kind).toBe("postgres");
  });

  afterAll(async () => {
    await database?.raw.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  const tables = async () =>
    (
      await database.raw.query<{ t: string }>(
        "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> '_migrations' ORDER BY 1",
      )
    ).map((r) => r.t);

  it("runs every migration up, all the way down, and up again", async () => {
    const all = await loadMigrations();
    expect(await migrateUp(database.raw)).toEqual(all.map((m) => m.id));
    expect(await tables()).toEqual(expect.arrayContaining(["users", "books", "annotations", "generations", "audio_tracks", "question_marks"]));
    expect(await migrateUp(database.raw)).toEqual([]);
    await migrateDown(database.raw, all.length);
    expect(await tables()).toEqual([]);
    expect(await migrateUp(database.raw)).toEqual(all.map((m) => m.id));
  }, 60_000);

  it("runs the library end to end: books, every kind of note, AI answers, audio, search, links, costs and the export round trip", async () => {
    const db = database.db;
    const storage = new MemoryStorage();
    const ownerId = (await createFirstAdmin(db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
    const load = (f: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/books/${f}`, import.meta.url)));
    const jekyll = (await importBook(db, storage, ownerId, { name: "jh.epub", bytes: load("stevenson-jekyll-and-hyde.epub") })).bookId;
    const frankenstein = (await importBook(db, storage, ownerId, { name: "f.epub", bytes: load("shelley-frankenstein.epub") })).bookId;
    const sections = await getSections(db, ownerId, jekyll);
    const para = sections.filter((s) => s.kind === "paragraph")[8];
    const chapter = sections.find((s) => s.kind === "chapter")!;
    const at = { cfi: para.cfi.replace(/\)$/, "/1:0)"), quote: { exact: para.text.slice(0, 30) } };

    // Full-text search (the generated tsvector column and ts_headline).
    const hits = await searchLibrary(db, ownerId, '"singular ferocity"');
    expect(hits.map((h) => h.chapter)).toEqual(["The Carew Murder Case"]);

    // Every kind of annotation, through postgres.js (jsonb, arrays, booleans).
    await createAnnotation(db, ownerId, { kind: "highlight", bookId: jekyll, ...at, color: "amber", body: "Utterson the lawyer, his safe and the will." });
    await createAnnotation(db, ownerId, { kind: "sticker", bookId: jekyll, ...at, sticker: "question" });
    await createAnnotation(db, ownerId, { kind: "drawing", bookId: jekyll, ...at, drawing: { strokes: [[1, 2, 30, 40]] } });
    await createVoiceNote(db, storage, new FakeTranscriber(), ownerId, { bookId: jekyll, ...at, audio: wav(1), mime: "audio/wav", durationMs: 1000 });
    await createAnnotation(db, ownerId, {
      kind: "image",
      bookId: jekyll,
      ...at,
      picture: {
        source: "wikimedia",
        title: "Gas lamp",
        thumbUrl: "https://upload.wikimedia.org/a/b/480px-Lamp.jpg",
        imageUrl: "https://upload.wikimedia.org/a/b/Lamp.jpg",
        pageUrl: "https://commons.wikimedia.org/wiki/File:Lamp.jpg",
        credit: "Ada",
        licence: "CC0",
        licenceUrl: null,
      },
    });
    expect((await listAnnotations(db, ownerId, jekyll)).map((a) => a.kind).sort()).toEqual(["drawing", "highlight", "image", "sticker", "voice"]);
    expect((await searchNotes(db, ownerId, "transcript")).length).toBe(1);

    // Stored AI answers and audio, with spending counted per provider.
    await rewriteParagraph(db, new FakeModel(), ownerId, { bookId: jekyll, sectionId: para.id, level: "plain" });
    expect((await rewriteParagraph(db, new FakeModel(), ownerId, { bookId: jekyll, sectionId: para.id, level: "plain" })).reused).toBe(true);
    await questionBank(db, new FakeModel(), ownerId, { bookId: jekyll, chapterId: chapter.id });
    await speakPassage(db, storage, new FakeSpeech(), ownerId, { bookId: jekyll, sectionId: para.id, voice: "fake-ada" });
    const report = await costReport(db, ownerId, new Date(), {});
    expect(report.services.map((s) => [s.provider, s.calls])).toEqual([
      ["anthropic", 2],
      ["elevenlabs", 2],
      ["openai", 0],
    ]);

    // Cross-book links (array overlap and unnest).
    const links = await crossLinks(db, ownerId, frankenstein, "Utterson the lawyer opened his safe and read the will.");
    expect(links.map((l) => l.bookId)).toEqual([jekyll]);

    // Reading stats (M10): the upsert with greatest(), sums, and the Path joins.
    const sitting = "bbbbbbbb-0000-4000-8000-000000000001";
    const now = new Date("2026-10-14T12:00:00Z");
    await recordReading(db, ownerId, { sessionId: sitting, bookId: jekyll, startedAt: "2026-10-12T09:00:00Z", activeSeconds: 60, words: 200, pages: 1 }, now);
    const piece = { key: "c1.xhtml", label: "Chapter 1", position: 0.1, activeSeconds: 120, words: 480 };
    await recordReading(db, ownerId, { sessionId: sitting, bookId: jekyll, startedAt: "2026-10-12T09:00:00Z", activeSeconds: 120, words: 480, pages: 2, chapters: [piece] }, now);
    // A late, smaller report keeps the stored chapter split (the jsonb case expression).
    await recordReading(db, ownerId, { sessionId: sitting, bookId: jekyll, startedAt: "2026-10-12T09:00:00Z", activeSeconds: 60, words: 200, pages: 1, chapters: [] }, now);
    expect((await chapterStatsByBook(db, ownerId))[0].chapters).toEqual([{ ...piece, wpm: 240 }]);
    expect(await statsByBook(db, ownerId)).toEqual([expect.objectContaining({ bookId: jekyll, activeSeconds: 120, words: 480, sessions: 1, wpm: 240 })]);
    await seedPath(db, ownerId, {
      slug: "pg",
      title: "Postgres path",
      description: "",
      sourceUrl: "",
      pillars: [{ slug: "a", title: "Doubles", group: "main", books: [{ kind: "E", title: "The Strange Case of Dr. Jekyll and Mr. Hyde", author: "Stevenson" }] }],
    });
    expect(await statsByPathSlot(db, ownerId)).toEqual({
      pillars: [expect.objectContaining({ title: "Doubles", path: "Postgres path", activeSeconds: 120, books: 1, wpm: 240 })],
      kinds: [{ kind: "E", activeSeconds: 120, words: 480, books: 1, wpm: 240 }],
    });
    expect(await statsByWeek(db, ownerId, now)).toEqual([{ weekStart: "2026-10-12", activeSeconds: 120, words: 480, sessions: 1, wpm: 240 }]);

    // API tokens (M11): hash lookup, "last used" throttle, revoke.
    const made = await createApiToken(db, ownerId, "agent");
    expect(await userForApiToken(db, made.token)).toMatchObject({ user: { id: ownerId }, tokenName: "agent" });
    expect(await userForApiToken(db, made.token)).toMatchObject({ user: { id: ownerId }, tokenName: "agent" });
    await revokeApiToken(db, ownerId, made.id);
    expect(await userForApiToken(db, made.token)).toBeNull();
    // The agent API's library calls, with provenance on the note.
    expect((await agentBooks(db, ownerId)).map((b) => b.id)).toContain(jekyll);
    const [hit] = await agentSearch(db, ownerId, '"Next they turned to the business table"', 1);
    const agentNote = await agentAddNote(db, ownerId, "agent", { bookId: jekyll, text: "Agent note.", sectionId: hit.sectionId });
    expect(agentNote).toMatchObject({ sectionId: hit.sectionId, addedByAgent: "agent" });
    expect((await agentNotes(db, ownerId, jekyll)).find((n) => n.id === agentNote.id)?.addedByAgent).toBe("agent");

    // Export, wipe, import: everything comes back the same.
    const before = await exportLibrary(db, ownerId);
    await wipeLibrary(db, ownerId);
    expect((await exportLibrary(db, ownerId)).books).toEqual([]);
    await importLibrary(db, ownerId, JSON.parse(JSON.stringify(before)));
    expect({ ...(await exportLibrary(db, ownerId)), exportedAt: "" }).toEqual({ ...before, exportedAt: "" });
  }, 120_000);
});
