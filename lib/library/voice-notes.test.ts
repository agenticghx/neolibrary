import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spending } from "@/lib/ai/generate";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { wav } from "@/lib/speech/fake";
import { SpeechError } from "@/lib/speech/model";
import { FakeTranscriber, sttCost, type Transcriber } from "@/lib/speech/transcribe";
import { MemoryStorage } from "@/lib/storage";
import { deleteAnnotation, history, listAnnotations } from "./annotations";
import { toMarkdown, toW3C } from "./annotation-formats";
import { fileOwner, importBook } from "./import";
import { searchNotes } from "./search";
import { pageCfi } from "./pdf-sections";
import { getSections } from "./sections-store";
import { createVoiceNote } from "./voice-notes";

let database: Database;
let storage: MemoryStorage;
let ownerId: string;
let bookId: string;
let para: { id: string; cfi: string; text: string };

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: file })).bookId;
  para = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph")[5];
});
afterEach(() => database.raw.close());

const recording = wav(2);
const input = () => ({
  bookId,
  cfi: para.cfi.replace(/\)$/, "/1:0)"),
  quote: { exact: para.text.slice(0, 30) },
  audio: recording,
  mime: "audio/webm;codecs=opus",
  durationMs: 2000,
});

describe("voice notes (M8)", () => {
  it("stores the recording, transcribes it once with provenance and cost, and saves a searchable voice note", async () => {
    const t = new FakeTranscriber();
    const out = await createVoiceNote(database.db, storage, t, ownerId, input());
    expect(out).toMatchObject({ transcribed: true, problem: null });
    expect(t.calls).toBe(1);
    const a = out.annotation;
    expect(a).toMatchObject({ kind: "voice", targetType: "passage", sectionId: para.id, quote: { exact: para.text.slice(0, 30) } });
    expect(a.voice).toEqual({
      audioKey: `audio/${ownerId}/${bookId}/notes/${a.id}.webm`,
      mime: "audio/webm",
      durationMs: 2000,
      transcript: `Test transcript of a voice note (${recording.length} bytes of audio).`,
    });
    expect(fileOwner(a.voice!.audioKey)).toBe(ownerId);
    expect((await storage.get(a.voice!.audioKey))!.data).toEqual(recording);
    // The transcript is machine-made: stored with provenance, and counted against the voice caps.
    const [g] = await database.raw.query<{ kind: string; model: string; cost_usd: number; output: string }>(
      "SELECT kind, model, cost_usd, output FROM generations",
    );
    expect(g).toMatchObject({ kind: "transcript", model: "fake-scribe", output: a.voice!.transcript });
    expect(g.cost_usd).toBeCloseTo(sttCost(2000));
    expect((await spending(database.db, "elevenlabs", bookId)).book).toBeCloseTo(sttCost(2000));

    // In the Notes list, in note search, and in the exports as text.
    expect((await listAnnotations(database.db, ownerId, bookId)).map((x) => x.kind)).toEqual(["voice"]);
    expect((await searchNotes(database.db, ownerId, "transcript")).map((h) => h.annotationId)).toEqual([a.id]);
    const md = toMarkdown({ id: bookId, title: "J", author: "" }, [a], () => "Ch");
    expect(md).toContain(`Voice note: ${a.voice!.transcript}`);
    expect(toW3C({ id: bookId, title: "J", author: "" }, [a]).first.items[0].body![0].value).toContain(a.voice!.transcript);

    // Append-only like every annotation: removing it hides it, the versions stay.
    await deleteAnnotation(database.db, ownerId, a.id);
    expect(await listAnnotations(database.db, ownerId, bookId)).toEqual([]);
    expect((await history(database.db, ownerId, a.id)).map((v) => v.deleted)).toEqual([false, true]);
  });

  it("from Think aloud (M14 step 6c): at a paragraph's own place, quoting a sentence, with no selection", async () => {
    // The mini-player sends the paragraph's own CFI (no character offset) and the sentence alone.
    const out = await createVoiceNote(database.db, storage, new FakeTranscriber(), ownerId, { ...input(), cfi: para.cfi, quote: { exact: "A sentence of it." } });
    expect(out.annotation).toMatchObject({ cfi: para.cfi, sectionId: para.id, quote: { exact: "A sentence of it.", prefix: "", suffix: "" } });
  });

  it("in a PDF, a page's place (what Think aloud sends there) belongs to the page's last paragraph", async () => {
    const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/descartes-meditation-one.pdf", import.meta.url)));
    const pdfId = (await importBook(database.db, storage, ownerId, { name: "m.pdf", bytes: file })).bookId;
    const onPage = (await getSections(database.db, ownerId, pdfId)).filter((s) => s.kind === "paragraph" && s.cfi === pageCfi(0));
    expect(onPage.length).toBeGreaterThan(1);
    const out = await createVoiceNote(database.db, storage, new FakeTranscriber(), ownerId, { ...input(), bookId: pdfId, cfi: pageCfi(0), quote: { exact: onPage[0].text.slice(0, 30) } });
    expect(out.annotation).toMatchObject({ cfi: pageCfi(0), sectionId: onPage.at(-1)!.id });
  });

  it("keeps the recording even when transcription fails or the cap is reached", async () => {
    const broken: Transcriber = {
      provider: "elevenlabs",
      model: "broken",
      transcribe: async () => {
        throw new SpeechError("ElevenLabs could not transcribe this (500).");
      },
    };
    const a = await createVoiceNote(database.db, storage, broken, ownerId, input());
    expect(a).toMatchObject({ transcribed: false, problem: "Saved without a transcript: ElevenLabs could not transcribe this (500)." });
    expect(a.annotation.voice?.transcript).toBe("");
    const capped = await createVoiceNote(database.db, storage, new FakeTranscriber(), ownerId, input(), { caps: { perBookUsd: 0, perMonthUsd: 0 } });
    expect(capped.problem).toMatch(/^Saved without a transcript: This month's voice spending cap/);
    const none = await createVoiceNote(database.db, storage, null, ownerId, input());
    expect(none.problem).toBe("Saved without a transcript: transcripts are not set up yet.");
    expect(await listAnnotations(database.db, ownerId, bookId)).toHaveLength(3);
  });

  it("refuses what it cannot keep, before paying for anything", async () => {
    const t = new FakeTranscriber();
    await expect(createVoiceNote(database.db, storage, t, ownerId, { ...input(), mime: "video/mp4" })).rejects.toThrow("audio format");
    await expect(createVoiceNote(database.db, storage, t, ownerId, { ...input(), audio: new Uint8Array() })).rejects.toThrow("empty");
    await expect(createVoiceNote(database.db, storage, t, ownerId, { ...input(), audio: new Uint8Array(11 * 1024 * 1024) })).rejects.toThrow("10 MB");
    await expect(createVoiceNote(database.db, storage, t, ownerId, { ...input(), bookId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(
      "Book not found",
    );
    await expect(createVoiceNote(database.db, storage, t, ownerId, { ...input(), cfi: "nope" })).rejects.toThrow("not a place");
    expect(t.calls).toBe(0);
  });
});
