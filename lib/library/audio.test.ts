import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpendingCapReached, spending } from "@/lib/ai/generate";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { FAKE_SECONDS_PER_CHAR, FakeSpeech } from "@/lib/speech/fake";
import { speechCost } from "@/lib/speech/model";
import { MemoryStorage } from "@/lib/storage";
import { estimateSpeech, listTracks, passageFor, speakPassage } from "./audio";
import { fileOwner, importBook } from "./import";
import { getSections } from "./sections-store";

let database: Database;
let storage: MemoryStorage;
let ownerId: string;
let bookId: string;
let all: Awaited<ReturnType<typeof getSections>>;

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: file })).bookId;
  all = await getSections(database.db, ownerId, bookId);
});
afterEach(() => database.raw.close());

const paragraphs = () => all.filter((s) => s.kind === "paragraph");

describe("reading aloud (M7)", () => {
  it("makes a paragraph's audio once, stores it with word timings and cost, and re-serves it", async () => {
    const voice = new FakeSpeech();
    const p = paragraphs()[0];
    const first = await speakPassage(database.db, storage, voice, ownerId, { bookId, sectionId: p.id, voice: "fake-ada" });
    expect(first.reused).toBe(false);
    expect(voice.calls).toHaveLength(1);
    expect(voice.calls[0]).toMatchObject({ text: p.text, voiceId: "fake-ada", previousText: "", nextText: paragraphs()[1].text.slice(0, 300) });
    const t = first.track;
    expect(t).toMatchObject({ sectionId: p.id, voice: "fake-ada", source: "tts", provider: "elevenlabs", model: "fake-voice", mime: "audio/wav" });
    expect(t.characters).toBe(p.text.length);
    expect(t.costUsd).toBeCloseTo(speechCost(p.text.length));
    expect(t.durationMs).toBe(Math.round(p.text.length * FAKE_SECONDS_PER_CHAR * 1000));
    // The audio file is in storage, under the owner (so only they can fetch it).
    expect(t.audioKey).toMatch(new RegExp(`^audio/${ownerId}/${bookId}/[0-9a-f-]{36}\\.wav$`));
    expect(fileOwner(t.audioKey)).toBe(ownerId);
    const file = await storage.get(t.audioKey);
    expect(new TextDecoder().decode(file!.data.slice(0, 4))).toBe("RIFF");
    // One timing per word, in order, pointing at that word in the text.
    const words = p.text.match(/\S+/g)!;
    expect(t.words).toHaveLength(words.length);
    t.words.forEach(([start, end, from, to], i) => {
      expect(p.text.slice(from, to)).toBe(words[i]);
      expect(start).toBe(Math.round(from * FAKE_SECONDS_PER_CHAR * 1000));
      expect(end).toBe(Math.round(to * FAKE_SECONDS_PER_CHAR * 1000));
    });

    const again = await speakPassage(database.db, storage, voice, ownerId, { bookId, sectionId: p.id, voice: "fake-ada" });
    expect(again).toEqual({ track: t, reused: true });
    expect(voice.calls).toHaveLength(1);
    // Another voice is another track.
    await speakPassage(database.db, storage, voice, ownerId, { bookId, sectionId: p.id, voice: "fake-ben" });
    expect(voice.calls).toHaveLength(2);
    expect((await listTracks(database.db, ownerId, bookId)).map((x) => x.voice)).toEqual(["fake-ada", "fake-ben"]);
  });

  it("finds the paragraph to read from a place in the book, reading on from headings, with the next paragraph", async () => {
    const ps = paragraphs();
    expect(await passageFor(database.db, ownerId, bookId, { cfi: ps[3].cfi.replace(/\)$/, "/1:4)") })).toMatchObject({ id: ps[3].id, nextId: ps[4].id });
    const chapter = all.find((s) => s.kind === "chapter" && s.label === "The Carew Murder Case")!;
    const firstOfChapter = ps.find((s) => s.chapterIndex === chapter.chapterIndex)!;
    expect((await passageFor(database.db, ownerId, bookId, { cfi: chapter.cfi })).id).toBe(firstOfChapter.id);
    await expect(passageFor(database.db, ownerId, bookId, { sectionId: "nope" })).rejects.toThrow("nothing to read");
  });

  it("stops at the voice caps before calling, counts voice spending per book and month, and refuses unknown voices", async () => {
    const voice = new FakeSpeech();
    const [a, b] = paragraphs();
    await speakPassage(database.db, storage, voice, ownerId, { bookId, sectionId: a.id, voice: "fake-ada" });
    const spent = await spending(database.db, "elevenlabs", bookId);
    expect(spent.book).toBeCloseTo(speechCost(a.text.length));
    expect(spent.month).toBeCloseTo(spent.book);
    expect((await spending(database.db, "anthropic", bookId)).book).toBe(0);
    const caps = { perBookUsd: spent.book + estimateSpeech(b) / 2, perMonthUsd: 100 };
    await expect(speakPassage(database.db, storage, voice, ownerId, { bookId, sectionId: b.id, voice: "fake-ada" }, { caps })).rejects.toThrow(
      SpendingCapReached,
    );
    await expect(
      speakPassage(database.db, storage, voice, ownerId, { bookId, sectionId: b.id, voice: "fake-ada" }, { caps: { perBookUsd: 100, perMonthUsd: 0 } }),
    ).rejects.toThrow("VOICE_CAP_PER_MONTH_USD");
    await expect(speakPassage(database.db, storage, voice, ownerId, { bookId, sectionId: b.id, voice: "someone" })).rejects.toThrow("voices on offer");
    expect(voice.calls).toHaveLength(1);
  });

  it("keeps books private, and two identical requests at once make one call", async () => {
    const voice = new FakeSpeech();
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const other = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
    const p = paragraphs()[0];
    await expect(speakPassage(database.db, storage, voice, other, { bookId, sectionId: p.id, voice: "fake-ada" })).rejects.toThrow("Book not found");
    const input = { bookId, sectionId: p.id, voice: "fake-ada" };
    const [x, y] = await Promise.all([
      speakPassage(database.db, storage, voice, ownerId, input),
      speakPassage(database.db, storage, voice, ownerId, input),
    ]);
    expect(voice.calls).toHaveLength(1);
    expect(x.track.id).toBe(y.track.id);
  });
});
