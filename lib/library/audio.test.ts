import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpendingCapReached, spending } from "@/lib/ai/generate";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { audioTracks } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { buildPackage } from "@/lib/readalong/fixture";
import { startImport } from "@/lib/readalong/importer";
import { FAKE_SECONDS_PER_CHAR, FakeSpeech } from "@/lib/speech/fake";
import { speechCost } from "@/lib/speech/model";
import { MemoryStorage } from "@/lib/storage";
import { estimateSpeech, listTracks, passageFor, readingPart, speakPassage, uploadedReading } from "./audio";
import { fileOwner, importBook } from "./import";
import { getSections } from "./sections-store";

let database: Database;
let storage: MemoryStorage;
let ownerId: string;
let bookId: string;
let all: Awaited<ReturnType<typeof getSections>>;
let bookBytes: Uint8Array;

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  bookBytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: bookBytes })).bookId;
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

describe("the book's own audiobook in the player (M13 (d))", () => {
  /** A finished import reading paragraphs 5-7 (file 1, after a spoken heading) and 8-9 (file 2). */
  async function imported(bytes = bookBytes) {
    const ps = paragraphs();
    const chapter = (from: number, to: number, title: string) => ({
      title,
      paragraphs: [title + ".", ...ps.slice(from, to).map((p) => p.text)],
      inBook: [null, ...ps.slice(from, to).map((p) => p.chapterIndex)],
    });
    const { zip } = buildPackage({ bookBytes: bytes, chapters: [chapter(5, 8, "Chapter One"), chapter(8, 10, "Chapter Two")] });
    return startImport(database.db, storage, ownerId, bookId, zip());
  }

  it("lists the timed paragraphs from the reading position on, in reading order, with their file and times", async () => {
    const imp = await imported();
    const ps = paragraphs();
    const r = (await uploadedReading(database.db, ownerId, bookId, 0))!;
    expect(r).toMatchObject({ importId: imp.id, voice: `upload:${imp.id}`, title: "Test book" });
    expect(r.files).toEqual([
      { url: `/api/books/${bookId}/readalong/${imp.id}/audio/0`, mime: "audio/wav" },
      { url: `/api/books/${bookId}/readalong/${imp.id}/audio/1`, mime: "audio/wav" },
    ]);
    expect(r.paragraphs.map((p) => p.sectionId)).toEqual(ps.slice(5, 10).map((p) => p.id));
    expect(r.paragraphs.map((p) => p.file)).toEqual([0, 0, 0, 1, 1]);
    // Places on a page are for PDF books only (M13 (e)): an EPUB's paragraphs carry none.
    expect(r.paragraphs.filter((p) => "inPage" in p)).toEqual([]);
    expect(r.paragraphs.map((p) => p.cfi)).toEqual(ps.slice(5, 10).map((p) => p.cfi));
    for (const p of r.paragraphs) {
      // Times are times in the file: a stretch of it, word by word.
      expect(p.startMs).toBe(p.words[0][0]);
      expect(p.endMs).toBe(p.words.at(-1)![1]);
      const text = ps.find((x) => x.id === p.sectionId)!.text;
      expect(text.slice(p.words[0][2], p.words[0][3])).toBe(text.split(" ")[0]);
    }
    // The spoken heading is not on the page, so each file's first paragraph starts after it.
    expect(r.paragraphs[0].startMs).toBeGreaterThan(0);
    expect(r.paragraphs[3].startMs).toBeGreaterThan(0);
    expect(r.paragraphs[3].startMs).toBeLessThan(r.paragraphs[2].startMs);
    // From paragraph 7 on; from the end of the book, nothing.
    expect((await uploadedReading(database.db, ownerId, bookId, ps[7].position))!.paragraphs.map((p) => p.sectionId)).toEqual(ps.slice(7, 10).map((p) => p.id));
    expect((await uploadedReading(database.db, ownerId, bookId, ps.at(-1)!.position))!.paragraphs).toEqual([]);
    // Each paragraph says where it is in reading order.
    expect(r.paragraphs.map((p) => p.position)).toEqual(ps.slice(5, 10).map((p) => p.position));
    expect(r.partsUrl).toBe(`/api/books/${bookId}/readalong/${imp.id}/reading`);
    expect(r.more).toBeNull();
    // The tracks themselves carry the stretch and the import (Track used to drop them).
    const tracks = (await listTracks(database.db, ownerId, bookId)).filter((t) => t.source === "upload");
    expect(tracks).toHaveLength(5);
    expect(tracks[0]).toMatchObject({ importId: imp.id, audioStartMs: expect.any(Number), audioEndMs: expect.any(Number) });
  });

  it("leaves out a track without words, and offers nothing to another reader, for an unfinished upload, or with no audiobook", async () => {
    expect(await uploadedReading(database.db, ownerId, bookId, 0)).toBeNull();
    const imp = await imported();
    const ps = paragraphs();
    await database.db.update(audioTracks).set({ words: [] }).where(and(eq(audioTracks.importId, imp.id), eq(audioTracks.sectionId, ps[6].id)));
    expect((await uploadedReading(database.db, ownerId, bookId, 0))!.paragraphs.map((p) => p.sectionId)).toEqual([5, 7, 8, 9].map((i) => ps[i].id));
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const other = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
    expect(await uploadedReading(database.db, other, bookId, 0)).toBeNull();
    // A newer upload that has not finished does not replace the finished one.
    const { files } = buildPackage({ bookBytes, chapters: [{ title: "x", paragraphs: [ps[20].text], inBook: [ps[20].chapterIndex] }] });
    const waiting = await startImport(database.db, storage, ownerId, bookId, zipSync(Object.fromEntries(Object.entries(files).filter(([n]) => !n.startsWith("audio/")))));
    expect(waiting.status).toBe("uploading");
    expect((await uploadedReading(database.db, ownerId, bookId, 0))!.importId).toBe(imp.id);
  });
});

describe("the audiobook's paragraphs, in parts (M13 (d))", () => {
  it("sends a part at a time, says where the next part starts, and gives the next parts to the owner of a finished import only", async () => {
    const ps = paragraphs();
    const { zip } = buildPackage({ bookBytes, chapters: [{ title: "Five", paragraphs: ps.slice(5, 10).map((p) => p.text), inBook: ps.slice(5, 10).map((p) => p.chapterIndex) }] });
    const imp = await startImport(database.db, storage, ownerId, bookId, zip());
    const first = (await uploadedReading(database.db, ownerId, bookId, 0, 2))!;
    expect(first.paragraphs.map((p) => p.sectionId)).toEqual(ps.slice(5, 7).map((p) => p.id));
    expect(first.more).toBe(ps[7].position);
    const second = (await readingPart(database.db, ownerId, bookId, imp.id, first.more!, 2))!;
    expect(second.paragraphs.map((p) => p.sectionId)).toEqual(ps.slice(7, 9).map((p) => p.id));
    const last = (await readingPart(database.db, ownerId, bookId, imp.id, second.more!, 2))!;
    expect(last).toMatchObject({ paragraphs: [{ sectionId: ps[9].id }], more: null });
    // Nothing for another reader, another import, or one still uploading.
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const other = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
    expect(await readingPart(database.db, other, bookId, imp.id, 0)).toBeNull();
    expect(await readingPart(database.db, ownerId, bookId, crypto.randomUUID(), 0)).toBeNull();
    const { files } = buildPackage({ bookBytes, chapters: [{ title: "x", paragraphs: [ps[20].text], inBook: [ps[20].chapterIndex] }] });
    const waiting = await startImport(database.db, storage, ownerId, bookId, zipSync(Object.fromEntries(Object.entries(files).filter(([n]) => !n.startsWith("audio/")))));
    expect(await readingPart(database.db, ownerId, bookId, waiting.id, 0)).toBeNull();
  });

  it("ends a part once it holds enough words (a PDF paragraph can be a whole page), with at least one paragraph", async () => {
    const ps = paragraphs();
    const { zip } = buildPackage({ bookBytes, chapters: [{ title: "Five", paragraphs: ps.slice(5, 10).map((p) => p.text), inBook: ps.slice(5, 10).map((p) => p.chapterIndex) }] });
    const imp = await startImport(database.db, storage, ownerId, bookId, zip());
    // By default the five paragraphs come in one part.
    expect((await uploadedReading(database.db, ownerId, bookId, 0))!.more).toBeNull();
    // A budget of one word: one paragraph a part.
    const one = (await uploadedReading(database.db, ownerId, bookId, 0, 200, 1))!;
    expect(one.paragraphs.map((p) => p.sectionId)).toEqual([ps[5].id]);
    expect(one.more).toBe(ps[6].position);
    // A budget one word over the first paragraph: the part ends with the paragraph that reaches it.
    const budget = one.paragraphs[0].words.length + 1;
    const two = (await uploadedReading(database.db, ownerId, bookId, 0, 200, budget))!;
    expect(two.paragraphs.map((p) => p.sectionId)).toEqual([ps[5].id, ps[6].id]);
    expect(two.more).toBe(ps[7].position);
    // Reading on part by part gives every paragraph once, in order.
    const seen = two.paragraphs.map((p) => p.sectionId);
    for (let at = two.more; at !== null; ) {
      const next = (await readingPart(database.db, ownerId, bookId, imp.id, at, 200, budget))!;
      expect(next.paragraphs.length).toBeGreaterThan(0);
      seen.push(...next.paragraphs.map((p) => p.sectionId));
      at = next.more;
    }
    expect(seen).toEqual(ps.slice(5, 10).map((p) => p.id));
  });
});

describe("where reading aloud starts in a PDF", () => {
  it("starts a whole page at its first paragraph (every paragraph has the page's address), and an empty page at the next text", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const page = (paragraphs: string[][]) => {
      const p = doc.addPage([612, 792]);
      let y = 700;
      for (const lines of paragraphs) {
        for (const line of lines) {
          p.drawText(line, { x: 72, y, size: 11, font });
          y -= 14;
        }
        y -= 18; // a wider gap: a new paragraph
      }
    };
    page([["The first paragraph of page one,", "in two lines."], ["The second paragraph of page one,", "also in two lines."]]);
    page([]); // a page with no text
    page([["The only paragraph of page three,", "in two lines."]]);
    const id = (await importBook(database.db, storage, ownerId, { name: "pages.pdf", bytes: await doc.save() })).bookId;
    const ps = (await getSections(database.db, ownerId, id)).filter((s) => s.kind === "paragraph");
    expect(ps.map((p) => [p.chapterIndex, p.text])).toEqual([
      [0, "The first paragraph of page one, in two lines."],
      [0, "The second paragraph of page one, also in two lines."],
      [2, "The only paragraph of page three, in two lines."],
    ]);
    // Page 1 starts at its first paragraph, not its last.
    expect((await passageFor(database.db, ownerId, id, { cfi: "epubcfi(/6/2)" })).id).toBe(ps[0].id);
    // The empty page 2 reads on from page 3.
    expect((await passageFor(database.db, ownerId, id, { cfi: "epubcfi(/6/4)" })).id).toBe(ps[2].id);
    expect((await passageFor(database.db, ownerId, id, { cfi: "epubcfi(/6/6)" })).id).toBe(ps[2].id);
    // Past the last page with text, there is nothing to read.
    await expect(passageFor(database.db, ownerId, id, { cfi: "epubcfi(/6/8)" })).rejects.toThrow("nothing to read");
  });
});

describe("an audiobook of a PDF book (M13 (e))", () => {
  /**
   * A PDF drawn here (no copyrighted text), laid out as Samuel's Kuhn is: on
   * each page a running head drawn first, at the top (its own paragraph,
   * never read aloud), then the body, then the page number, drawn last. A
   * paragraph has three lines, so that the page's usual line step (the
   * median, which the paragraph split uses) is the step within a paragraph.
   */
  async function pdfBook() {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    doc.setTitle("Pages Read Aloud");
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const pages = [
      {
        head: "Introduction",
        paragraphs: [
          ["A careful reader learns to trust the slow and normal-", "scientific habit of looking twice at a page, and", "then once more before turning it."],
          ["Then a second paragraph begins, and it ends", "with a plain sentence of its own, as the", "last words on this page."],
        ],
      },
      {
        head: "Pages Read Aloud",
        paragraphs: [
          ["The next page opens with a short line of", "plain words for the voice to read, and then", "a third line to make the page look usual."],
          ["And a last paragraph closes the test, in", "three short lines, each of them", "read aloud like the rest."],
        ],
      },
    ];
    pages.forEach(({ head, paragraphs }, n) => {
      const page = doc.addPage([612, 792]);
      page.drawText(head, { x: 72, y: 750, size: 9, font });
      let y = 700;
      for (const lines of paragraphs) {
        for (const line of lines) {
          page.drawText(line, { x: 72, y, size: 12, font });
          y -= 15;
        }
        y -= 20;
      }
      page.drawText(String(n + 1), { x: 300, y: 40, size: 9, font });
    });
    return new Uint8Array(await doc.save());
  }

  it("says where each word is on its page, in non-space characters, in every part, counting the running head", async () => {
    const bytes = await pdfBook();
    const id = (await importBook(database.db, storage, ownerId, { name: "pages.pdf", bytes })).bookId;
    const ps = (await getSections(database.db, ownerId, id)).filter((x) => x.kind === "paragraph");
    expect(ps.map((p) => [p.chapterIndex, p.text])).toEqual([
      [0, "Introduction"],
      [0, "A careful reader learns to trust the slow and normal- scientific habit of looking twice at a page, and then once more before turning it."],
      [0, "Then a second paragraph begins, and it ends with a plain sentence of its own, as the last words on this page."],
      [0, "1"],
      [1, "Pages Read Aloud"],
      [1, "The next page opens with a short line of plain words for the voice to read, and then a third line to make the page look usual."],
      [1, "And a last paragraph closes the test, in three short lines, each of them read aloud like the rest."],
      [1, "2"],
    ]);
    const body = [ps[1], ps[2], ps[5], ps[6]];
    // Read as the narrator would: the broken word whole, the running heads and page numbers not read; a pause after each paragraph.
    const said = [body[0].text.replace("normal- scientific", "normal-scientific"), ...body.slice(1).map((p) => p.text)];
    const { zip } = buildPackage({ bookBytes: bytes, chapters: [{ title: "One", paragraphs: said, inBook: [0, 0, 1, 1], pauses: [0.8, 0.8, 0.8] }] });
    const imp = await startImport(database.db, storage, ownerId, id, zip());
    expect(imp.status).toBe("ready");
    // In parts of three paragraphs: the second part starts in the middle of
    // page 2, so its places must count the page's running head and the
    // paragraph before it, which is in the first part.
    const first = (await uploadedReading(database.db, ownerId, id, 0, 3))!;
    const rest = (await readingPart(database.db, ownerId, id, imp.id, first.more!, 3))!;
    expect(first.paragraphs.map((p) => p.sectionId)).toEqual(body.slice(0, 3).map((p) => p.id));
    expect(rest).toMatchObject({ paragraphs: [{ sectionId: body[3].id }], more: null });
    const all = [...first.paragraphs, ...rest.paragraphs];
    // Each page's text without spaces: a word's place there is the word itself (spaces removed).
    const pageText = (n: number) => ps.filter((p) => p.chapterIndex === n).map((p) => p.text.replace(/\s+/g, "")).join("");
    for (const p of all) {
      const text = ps.find((x) => x.id === p.sectionId)!.text;
      expect(p.inPage, p.sectionId).toHaveLength(p.words.length);
      p.words.forEach(([, , from, to], k) => {
        const [a, b] = p.inPage![k];
        expect(pageText(p.chapterIndex).slice(a, b)).toBe(text.slice(from, to).replace(/\s+/g, ""));
      });
    }
    // The last part's first word comes after page 2's running head and first paragraph.
    expect(rest.paragraphs[0].inPage![0][0]).toBe(("PagesReadAloud" + body[2].text).replace(/\s+/g, "").length);
    // Every word read aloud has its time and place, the broken word as one word across the line break.
    const words = all.flatMap((p) => p.words.map(([, , from, to]) => ps.find((x) => x.id === p.sectionId)!.text.slice(from, to)));
    expect(words).toHaveLength(said.join(" ").split(" ").length);
    expect(words).toContain("normal- scientific");
    // The pause after each paragraph is in the audio: the next paragraph starts 0.8 s later.
    expect(all[1].startMs - all[0].endMs).toBeGreaterThanOrEqual(800);
  });
});
