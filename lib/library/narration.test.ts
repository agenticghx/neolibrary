import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spending } from "@/lib/ai/generate";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { FakeSpeech } from "@/lib/speech/fake";
import { SpeechError, speechCost, type SpeechRequest } from "@/lib/speech/model";
import { MemoryStorage } from "@/lib/storage";
import { speakPassage } from "./audio";
import { importBook } from "./import";
import { forgetNarrationsForTests, limitStop, narrationSummary, NarrationError, runningNarrations, startNarration, stopNarration } from "./narration";
import { getSections } from "./sections-store";
import { readableEpub } from "./test-epub";

// M14 follow-up V5: whole-book narration, with the fake voice only (Samuel's rule: never ElevenLabs for a whole book).

let database: Database;
let storage: MemoryStorage;
let ownerId: string;

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/books/${name}`, import.meta.url)));

/** A small EPUB whose eight paragraphs all differ (a saved paragraph is found by its text). Invented text. */
const SMALL = readableEpub(
  "Eight Lamps",
  [`<h1>The lamps</h1>${Array.from({ length: 8 }, (_, i) => `<p>Lamp ${i + 1} is lit at dusk by the keeper, who walks the length of the quay.</p>`).join("")}`],
  "Iris Wick",
);
/** A second small EPUB, of three paragraphs. Invented text. */
const BOATS = readableEpub(
  "Nine Boats",
  [`<h1>The boats</h1>${Array.from({ length: 3 }, (_, i) => `<p>Boat ${i + 1} is tied up at dusk by the keeper, who walks the length of the quay.</p>`).join("")}`],
  "Iris Wick",
);

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(async () => {
  forgetNarrationsForTests();
  await database.raw.close();
});

async function small() {
  const bookId = (await importBook(database.db, storage, ownerId, { name: "eight-lamps.epub", bytes: SMALL })).bookId;
  const paragraphs = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph");
  expect(paragraphs).toHaveLength(8);
  return { bookId, paragraphs };
}

/** speakPassage, counting which paragraphs a run asks it for. */
function counted() {
  const asked: string[] = [];
  const speak: typeof speakPassage = (db, st, model, owner, input, opts) => {
    asked.push(input.sectionId);
    return speakPassage(db, st, model, owner, input, opts);
  };
  return { asked, speak };
}

/** The fake voice, held at each paragraph until the test lets it go. */
class GatedSpeech extends FakeSpeech {
  private gates: (() => void)[] = [];
  get waiting() {
    return this.gates.length;
  }
  release() {
    this.gates.shift()?.();
  }
  async speak(req: SpeechRequest) {
    await new Promise<void>((resolve) => this.gates.push(resolve));
    return super.speak(req);
  }
}

describe("what narrating a whole book involves, before anything is made", () => {
  it("names the whole book: its paragraphs, characters and cost (the plan's table), minus what is saved", async () => {
    const voice = new FakeSpeech();
    const jekyll = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: fixture("stevenson-jekyll-and-hyde.epub") })).bookId;
    const s = await narrationSummary(database.db, voice, ownerId, jekyll, "fake-ada");
    expect(s).toMatchObject({
      book: { id: jekyll, title: "The Strange Case of Dr. Jekyll and Mr. Hyde" },
      voice: "fake-ada",
      paragraphs: 354,
      characters: 141_929,
      usdPer1kChars: 0.3,
      saved: 0,
      toMake: { paragraphs: 354, characters: 141_929 },
      caps: { perBookUsd: 5, perMonthUsd: 20, spentBookUsd: 0, spentMonthUsd: 0 },
      running: false,
      stopping: false,
      stoppedBecause: null,
    });
    expect(s.totalUsd.toFixed(2)).toBe("42.58");
    expect(s.estimateUsd).toBeCloseTo(s.totalUsd, 9);
    expect(voice.calls).toHaveLength(0);

    // The $5 limit stops it early: after the paragraphs whose costs, in reading order, add up to $5 at most.
    const ps = (await getSections(database.db, ownerId, jekyll)).filter((p) => p.kind === "paragraph");
    let spent = 0;
    let fit = 0;
    while (spent + speechCost(ps[fit].text.length) <= 5) spent += speechCost(ps[fit++].text.length);
    expect(fit).toBe(36);
    expect(s.stopsAt).toBe(36);
    // Limits that allow the whole book: no early stop.
    expect((await narrationSummary(database.db, voice, ownerId, jekyll, "fake-ada", { caps: { perBookUsd: 100, perMonthUsd: 100 } })).stopsAt).toBeNull();

    // Two paragraphs saved (as the Listen bar saves them): free, so the cost up front is the rest's.
    for (const p of ps.slice(0, 2)) await speakPassage(database.db, storage, voice, ownerId, { bookId: jekyll, sectionId: p.id, voice: "fake-ada" });
    const after = await narrationSummary(database.db, voice, ownerId, jekyll, "fake-ada");
    const two = ps[0].text.length + ps[1].text.length;
    expect(after).toMatchObject({ saved: 2, toMake: { paragraphs: 352, characters: 141_929 - two } });
    expect(after.estimateUsd).toBeCloseTo(speechCost(141_929 - two), 9);
    expect(after.caps.spentBookUsd).toBeCloseTo(speechCost(two), 9);
    expect(after.caps.spentMonthUsd).toBeCloseTo(speechCost(two), 9);
    // Saved in that voice only: another voice starts from nothing. With no voice asked, the first voice on offer.
    expect(await narrationSummary(database.db, voice, ownerId, jekyll, "fake-ben")).toMatchObject({ voice: "fake-ben", saved: 0 });
    expect(await narrationSummary(database.db, voice, ownerId, jekyll, null)).toMatchObject({ voice: "fake-ada", voices: await voice.voices(), saved: 2 });
  });

  it("the other two books of the plan's cost table, and where the $5 limit stops each", async () => {
    const voice = new FakeSpeech();
    for (const [name, paragraphs, characters, usd, stopsAt] of [
      ["shelley-frankenstein.epub", 806, 438_802, "131.64", 26],
      ["wells-the-time-machine.epub", 323, 182_234, "54.67", 75],
    ] as const) {
      const bookId = (await importBook(database.db, storage, ownerId, { name, bytes: fixture(name) })).bookId;
      const s = await narrationSummary(database.db, voice, ownerId, bookId, "fake-ada");
      // With nothing saved, what is paid up front is the whole book's cost (Frankenstein repeats a few short paragraphs:
      // they are counted, a few cents on the cautious side).
      expect([s.paragraphs, s.characters, s.totalUsd.toFixed(2), s.estimateUsd.toFixed(2), s.stopsAt]).toEqual([paragraphs, characters, usd, usd, stopsAt]);
    }
    expect(voice.calls).toHaveLength(0);
  });

  it("counts a text that appears twice once: the second is served again, free", () => {
    const list = ["a", "b", "a", "c"].map((key) => ({ key, characters: 1000 })); // $0.30 each
    // a ($0.30), b ($0.60), a again (free), then c would make $0.90, past $0.65: three paragraphs saved by then.
    expect(limitStop(list, new Set(), { book: 0, month: 0 }, { perBookUsd: 0.65, perMonthUsd: 100 })).toBe(3);
    expect(limitStop(list, new Set(), { book: 0, month: 0 }, { perBookUsd: 0.9, perMonthUsd: 100 })).toBeNull();
    // What is spent counts, this month's too: with $19.80 spent of $20, b ($0.30) is past it; the two a's are saved already.
    expect(limitStop(list, new Set(["a"]), { book: 0, month: 19.8 }, { perBookUsd: 100, perMonthUsd: 20 })).toBe(2);
    expect(limitStop(list, new Set(["a"]), { book: 0, month: 19.5 }, { perBookUsd: 100, perMonthUsd: 20 })).toBe(3);
  });
});

describe("making the whole book in the background (M14 follow-up V5)", () => {
  it("makes every paragraph not saved yet, in reading order, one at a time, and skips the saved ones", async () => {
    const voice = new FakeSpeech();
    const { bookId, paragraphs } = await small();
    // Paragraphs 2 and 5 were played already, so they are saved.
    for (const i of [2, 5]) await speakPassage(database.db, storage, voice, ownerId, { bookId, sectionId: paragraphs[i].id, voice: "fake-ada" });
    expect(voice.calls).toHaveLength(2);
    expect((await narrationSummary(database.db, voice, ownerId, bookId, "fake-ada")).saved).toBe(2);

    const { asked, speak } = counted();
    const run = await startNarration({ db: database.db, storage, model: voice, speak }, ownerId, bookId, "fake-ada", true);
    expect(run.started).toBe(true);
    await run.done;
    // The saved two are not asked for again; the six others, in reading order.
    expect(asked).toEqual(paragraphs.filter((_, i) => i !== 2 && i !== 5).map((p) => p.id));
    expect(voice.calls.map((c) => c.text)).toEqual([2, 5, 0, 1, 3, 4, 6, 7].map((i) => paragraphs[i].text));
    const s = await narrationSummary(database.db, voice, ownerId, bookId, "fake-ada");
    expect(s).toMatchObject({ saved: 8, toMake: { paragraphs: 0, characters: 0 }, estimateUsd: 0, stopsAt: null, running: false });
    expect(s.stoppedBecause).toEqual({ kind: "finished", message: "Every paragraph is saved in this voice." });
    // Each paragraph paid for once.
    expect((await spending(database.db, "elevenlabs", bookId)).book).toBeCloseTo(speechCost(paragraphs.reduce((n, p) => n + p.text.length, 0)), 9);

    // Again, now that all are saved: it finishes at once, paying for nothing.
    await (await startNarration({ db: database.db, storage, model: voice }, ownerId, bookId, "fake-ada", true)).done;
    expect(voice.calls).toHaveLength(8);
  });

  it("a second start while one is going on starts nothing new", async () => {
    const voice = new FakeSpeech();
    const { bookId } = await small();
    const deps = { db: database.db, storage, model: voice };
    const [a, b] = await Promise.all([startNarration(deps, ownerId, bookId, "fake-ada", true), startNarration(deps, ownerId, bookId, "fake-ada", true)]);
    expect([a.started, b.started].sort()).toEqual([false, true]);
    await Promise.all([a.done, b.done]);
    expect(voice.calls).toHaveLength(8);
  });

  it("one run per reader at a time: another voice or another book is refused while one goes on; after Stop, the next starts", async () => {
    const voice = new GatedSpeech();
    const { bookId } = await small();
    const boats = (await importBook(database.db, storage, ownerId, { name: "nine-boats.epub", bytes: BOATS })).bookId;
    const deps = { db: database.db, storage, model: voice };
    const run = await startNarration(deps, ownerId, bookId, "fake-ada", true);
    await vi.waitFor(() => expect(voice.waiting).toBe(1));
    // Each would check the spending limits before the other had paid, and the Import page shows one run only.
    const busy = "A narration is already going on: Eight Lamps, in the voice Ada (test voice). Stop it first.";
    await expect(startNarration(deps, ownerId, bookId, "fake-ben", true)).rejects.toMatchObject({ constructor: NarrationError, message: busy, status: 400 });
    await expect(startNarration(deps, ownerId, boats, "fake-ada", true)).rejects.toMatchObject({ constructor: NarrationError, message: busy, status: 400 });
    // The same book in the same voice: it carries on, as before (nothing new starts).
    expect((await startNarration(deps, ownerId, bookId, "fake-ada", true)).started).toBe(false);
    expect(runningNarrations(ownerId)).toEqual([{ bookId, voice: "fake-ada" }]);
    expect(voice.waiting).toBe(1);
    // The rule is per reader: here a reader you invited can narrate their own book meanwhile. (Only at this level: the
    // narration route lets only the library's owner start one, for now, route.test.ts; Open unknowns row 13.)
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const reader = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
    const theirs = (await importBook(database.db, storage, reader, { name: "nine-boats.epub", bytes: BOATS })).bookId;
    const elsewhere = await startNarration({ ...deps, model: new FakeSpeech() }, reader, theirs, "fake-ada", true);
    expect(elsewhere.started).toBe(true);
    await elsewhere.done;
    expect(await narrationSummary(database.db, voice, reader, theirs, "fake-ada")).toMatchObject({ saved: 3, stoppedBecause: { kind: "finished" } });

    const stopping = stopNarration(database.db, ownerId, bookId, "fake-ada", 3_000);
    expect(await narrationSummary(database.db, voice, ownerId, bookId, "fake-ada")).toMatchObject({ running: true, stopping: true });
    voice.release();
    await stopping;
    await run.done;
    expect(runningNarrations(ownerId)).toEqual([]);
    // Stopped: the other book, in the other voice, starts now.
    const next = await startNarration({ ...deps, model: new FakeSpeech() }, ownerId, boats, "fake-ben", true);
    expect(next.started).toBe(true);
    await next.done;
    expect(await narrationSummary(database.db, voice, ownerId, boats, "fake-ben")).toMatchObject({ saved: 3, running: false, stoppedBecause: { kind: "finished" } });
    expect(voice.calls).toHaveLength(1);
  });

  it("Stop: the paragraph being made is saved (it is paid for), then nothing more is made", async () => {
    const voice = new GatedSpeech();
    const { bookId } = await small();
    const run = await startNarration({ db: database.db, storage, model: voice }, ownerId, bookId, "fake-ada", true);
    await vi.waitFor(() => expect(voice.waiting).toBe(1));
    expect(runningNarrations(ownerId)).toEqual([{ bookId, voice: "fake-ada" }]);
    const stopping = stopNarration(database.db, ownerId, bookId, "fake-ada", 3_000);
    expect(await narrationSummary(database.db, voice, ownerId, bookId, "fake-ada")).toMatchObject({ running: true, stopping: true, saved: 0 });
    voice.release();
    await stopping;
    // Stopped: it did not go on to the next paragraph (the voice is not asked again).
    expect(voice.waiting).toBe(0);
    expect(runningNarrations(ownerId)).toEqual([]);
    await run.done;
    expect(voice.calls).toHaveLength(1);
    const s = await narrationSummary(database.db, voice, ownerId, bookId, "fake-ada");
    expect(s).toMatchObject({ saved: 1, running: false, stopping: false, stoppedBecause: { kind: "stopped", message: "Stopped, as you asked." } });
  });

  it("a spending limit stops it, in the limit's own words, where the summary said it would", async () => {
    const voice = new FakeSpeech();
    const { bookId, paragraphs } = await small();
    const cost = (i: number) => speechCost(paragraphs[i].text.length);
    // Room for three paragraphs and half of the fourth.
    const caps = { perBookUsd: cost(0) + cost(1) + cost(2) + cost(3) / 2, perMonthUsd: 100 };
    expect((await narrationSummary(database.db, voice, ownerId, bookId, "fake-ada", { caps })).stopsAt).toBe(3);
    await (await startNarration({ db: database.db, storage, model: voice, caps }, ownerId, bookId, "fake-ada", true)).done;
    expect(voice.calls).toHaveLength(3);
    const s = await narrationSummary(database.db, voice, ownerId, bookId, "fake-ada", { caps });
    expect(s).toMatchObject({ saved: 3, running: false, stoppedBecause: { kind: "limit" } });
    expect(s.stoppedBecause!.message).toMatch(/^This book's voice spending cap \(\$\d+\.\d+\) has been reached .*VOICE_CAP_PER_BOOK_USD\.$/);
    // The month's limit too: here it allows nothing more.
    const month = { perBookUsd: 100, perMonthUsd: cost(0) };
    expect((await narrationSummary(database.db, voice, ownerId, bookId, "fake-ben", { caps: month })).stopsAt).toBe(0);
    await (await startNarration({ db: database.db, storage, model: voice, caps: month }, ownerId, bookId, "fake-ben", true)).done;
    expect(voice.calls).toHaveLength(3);
    expect((await narrationSummary(database.db, voice, ownerId, bookId, "fake-ben")).stoppedBecause!.message).toContain("VOICE_CAP_PER_MONTH_USD");
  });

  it("after a restart nothing is going on; continuing skips the saved paragraphs and pays for none twice", async () => {
    const voice = new FakeSpeech();
    const { bookId, paragraphs } = await small();
    const caps = { perBookUsd: speechCost(paragraphs[0].text.length) * 3.5, perMonthUsd: 100 };
    await (await startNarration({ db: database.db, storage, model: voice, caps }, ownerId, bookId, "fake-ada", true)).done;
    expect(voice.calls).toHaveLength(3);
    forgetNarrationsForTests(); // the server restarted: what was going on is forgotten, what was saved is not
    expect(await narrationSummary(database.db, voice, ownerId, bookId, "fake-ada")).toMatchObject({ saved: 3, running: false, stoppedBecause: null });
    const { asked, speak } = counted();
    await (await startNarration({ db: database.db, storage, model: voice, speak }, ownerId, bookId, "fake-ada", true)).done;
    expect(asked).toEqual(paragraphs.slice(3).map((p) => p.id));
    expect(voice.calls).toHaveLength(8);
    expect((await spending(database.db, "elevenlabs", bookId)).book).toBeCloseTo(speechCost(paragraphs.reduce((n, p) => n + p.text.length, 0)), 9);
  });

  it("an error from the voice stops it and says what happened; what was made stays saved", async () => {
    class FailingSpeech extends FakeSpeech {
      async speak(req: SpeechRequest) {
        if (this.calls.length >= 1) throw new SpeechError("ElevenLabs could not read this aloud (500).");
        return super.speak(req);
      }
    }
    const voice = new FailingSpeech();
    const { bookId } = await small();
    await (await startNarration({ db: database.db, storage, model: voice }, ownerId, bookId, "fake-ada", true)).done;
    expect(await narrationSummary(database.db, voice, ownerId, bookId, "fake-ada")).toMatchObject({
      saved: 1,
      running: false,
      stoppedBecause: { kind: "error", message: "ElevenLabs could not read this aloud (500)." },
    });
  });

  it("refuses without confirming, and for a PDF, a book without its file, another reader's book, or a voice not on offer", async () => {
    const voice = new FakeSpeech();
    const { bookId } = await small();
    const deps = { db: database.db, storage, model: voice };
    for (const confirm of [undefined, false, "true", 1]) {
      await expect(startNarration(deps, ownerId, bookId, "fake-ada", confirm)).rejects.toThrow("Nothing was started: first confirm");
    }
    expect(await narrationSummary(database.db, voice, ownerId, bookId, "fake-ada")).toMatchObject({ saved: 0, running: false, stoppedBecause: null });
    expect(voice.calls).toHaveLength(0);
    await expect(startNarration(deps, ownerId, bookId, "someone", true)).rejects.toThrow("Choose one of the voices on offer.");
    await expect(startNarration(deps, ownerId, bookId, "", true)).rejects.toThrow("Choose one of the voices on offer.");
    await expect(narrationSummary(database.db, voice, ownerId, bookId, "someone")).rejects.toThrow("Choose one of the voices on offer.");

    const pdf = (await importBook(database.db, storage, ownerId, { name: "descartes.pdf", bytes: fixture("descartes-meditation-one.pdf") })).bookId;
    await expect(narrationSummary(database.db, voice, ownerId, pdf, "fake-ada")).rejects.toThrow("Only an EPUB can be narrated");
    await expect(startNarration(deps, ownerId, pdf, "fake-ada", true)).rejects.toThrow("Only an EPUB can be narrated");
    const waiting = (await database.db.insert(books).values({ ownerId, title: "A Title Waiting For Its File" }).returning())[0].id;
    await expect(narrationSummary(database.db, voice, ownerId, waiting, "fake-ada")).rejects.toThrow("This book has no file yet");

    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const other = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
    for (const attempt of [
      narrationSummary(database.db, voice, other, bookId, "fake-ada"),
      startNarration(deps, other, bookId, "fake-ada", true),
      stopNarration(database.db, other, bookId, "fake-ada"),
    ]) {
      await expect(attempt).rejects.toMatchObject({ constructor: NarrationError, message: "Book not found", status: 404 });
    }
    expect(voice.calls).toHaveLength(0);
  });
});
