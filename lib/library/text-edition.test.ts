import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { and, eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBatchModel } from "@/lib/ai";
import { batchCostUsd, FakeBatchModel, type BatchRequest } from "@/lib/ai/batch";
import { resetSpendHoldsForTests, spending, spendingWithJobs } from "@/lib/ai/generate";
import { AiNotConfigured } from "@/lib/ai/model";
import { readPrompt, sha256 } from "@/lib/ai/prompts";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books, generations, textEditionJobs } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { importBook } from "./import";
import { searchLibrary } from "./search";
import { listShelf } from "./shelf";
import { getSections } from "./sections-store";
import {
  forgetTextEditionsForTests,
  makeTextEdition,
  pageEstimateUsd,
  pollTextEditions,
  savePagesReadElsewhere,
  SUBSCRIPTION_PROVIDER,
  startTextEdition,
  stopTextEdition,
  TextEditionError,
  textEditionForPage,
  textEditionSummary,
  type TextEditionDeps,
} from "./text-edition";

// M25 S4: reading a scanned PDF's pages through the Batch API, with the fake batch model only (no key, no network).

let database: Database;
let storage: MemoryStorage;
let ownerId: string;
const CAPS = { perBookUsd: 5, perMonthUsd: 20 };

/** The scanned fixture (page 1 JPEG 2000, page 2 JBIG2, each with Descartes' words as invisible text) plus a blank page 3. */
async function scannedBook() {
  const doc = await PDFDocument.load(readFileSync(new URL("../../fixtures/books/scanned-meditation.pdf", import.meta.url)));
  doc.addPage([612, 792]);
  const { bookId } = await importBook(database.db, storage, ownerId, { name: "scanned-meditation.pdf", bytes: await doc.save() });
  return bookId;
}

/** Page 1 read as the scan says; page 2 read as other words (the check should list it). */
const READ: Record<string, string> = {
  "page-1": "# MEDITATION I.\n\n## Of the things of which we may doubt.\n\nSeveral years have now elapsed since I first became aware that I had accepted, even from my youth, many false opinions for true.",
  "page-2": "# A different page\n\nThese words are not the ones printed on the page, so the reading and the scan's own text disagree throughout, every one of them.",
};
const answer = (r: BatchRequest) => READ[r.id] ?? `Text of ${r.id}.`;

function deps(model = new FakeBatchModel({ answer }), over: Partial<TextEditionDeps> = {}): TextEditionDeps {
  return { db: database.db, storage, model, caps: CAPS, ...over };
}

const jobRow = async (bookId: string) => (await database.db.select().from(textEditionJobs).where(eq(textEditionJobs.bookId, bookId)))[0];
const pagesRead = async (bookId: string) =>
  (await database.db.select().from(generations).where(and(eq(generations.bookId, bookId), eq(generations.kind, "transcribe")))).map((g) => g.sectionId).sort();

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(async () => {
  forgetTextEditionsForTests();
  resetSpendHoldsForTests();
  await database.raw.close();
});

describe("before anything is sent", () => {
  it("leaves the book page's panel out when no AI key is set, instead of failing the page (live, 2026-10-17)", async () => {
    const bookId = await scannedBook();
    const noKey = () => getBatchModel({}); // no ANTHROPIC_API_KEY and no AI_FAKE: as on the live site
    expect(noKey).toThrow(AiNotConfigured);
    await expect(textEditionForPage({ db: database.db, storage, model: noKey, caps: CAPS }, ownerId, bookId)).resolves.toBeNull();
    // With a model, the page gets the same summary as before.
    const s = await textEditionForPage({ db: database.db, storage, model: () => new FakeBatchModel({ answer }), caps: CAPS }, ownerId, bookId);
    expect(s).toMatchObject({ pageCount: 3, done: 0, job: null });
  });

  it("says how many pages there are and what reading them costs at most, within the limits", async () => {
    const bookId = await scannedBook();
    const s = await textEditionSummary(deps(), ownerId, bookId);
    expect(s).toMatchObject({ pageCount: 3, done: 0, overLimit: null, job: null, caps: CAPS, spent: { book: 0, month: 0 } });
    expect(s.estimateUsd).toBeCloseTo(3 * pageEstimateUsd("fake"), 9);
  });

  it("refuses without the confirm box, for an EPUB, and for another reader's book", async () => {
    const bookId = await scannedBook();
    await expect(startTextEdition(deps(), ownerId, bookId, "yes")).rejects.toThrow(/first confirm/);
    const epub = await importBook(database.db, storage, ownerId, { name: "j.epub", bytes: new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url))) });
    await expect(startTextEdition(deps(), ownerId, epub.bookId, true)).rejects.toThrow(/Only a scanned PDF/);
    await expect(startTextEdition(deps(), crypto.randomUUID(), bookId, true)).rejects.toMatchObject({ status: 404 });
    expect(await jobRow(bookId)).toBeUndefined();
  });

  it("refuses when the estimate does not fit beside the book's limit, and sends nothing", async () => {
    const bookId = await scannedBook();
    const model = new FakeBatchModel({ answer });
    const err = await startTextEdition(deps(model, { caps: { perBookUsd: 0.01, perMonthUsd: 20 } }), ownerId, bookId, true).catch((e) => e);
    expect(err).toBeInstanceOf(TextEditionError);
    expect(err.status).toBe(402);
    expect(err.message).toMatch(/more than this book's AI limit allows/);
    expect(model.batches.size).toBe(0);
  });
});

describe("a run", () => {
  it("sends each page with ink as a picture with the tested instructions, skips the blank page, and saves what Claude read", async () => {
    const bookId = await scannedBook();
    const model = new FakeBatchModel({ answer });
    const { started, done } = await startTextEdition(deps(model), ownerId, bookId, true);
    expect(started).toBe(true);
    await done;
    const [sent] = [...model.batches.values()];
    expect(sent.requests.map((r) => r.id)).toEqual(["page-1", "page-2"]);
    expect(sent.requests[0].prompt).toBe(await readPrompt("transcribe-page"));
    expect(Buffer.from(sent.requests[0].images[0].base64, "base64").subarray(1, 4).toString()).toBe("PNG");
    expect((await jobRow(bookId)).status).toBe("waiting");

    await pollTextEditions(deps(model));
    const job = await jobRow(bookId);
    expect(job).toMatchObject({ status: "finished", blankPages: [3], problems: [] });
    expect(job.message).toBe("2 pages read, 1 blank, 0 not read, 1 to check.");
    expect(await pagesRead(bookId)).toEqual(["page-1", "page-2"]);
    const [row] = await database.db.select().from(generations).where(eq(generations.sectionId, "page-1"));
    expect(row).toMatchObject({ kind: "transcribe", promptName: "transcribe-page", model: "fake", inputTokens: 4000, outputTokens: 700, output: READ["page-1"] });
    expect(row.costUsd).toBeCloseTo(batchCostUsd("fake", 4000, 700), 9);
    expect(row.inputHash).toMatch(/^[0-9a-f]{64}$/);
    // The page check: page 1 agrees with the scan's own text; page 2 does not, and is listed for a look.
    expect(job.checks).toEqual([
      { page: 1, agreement: 1, flagged: false },
      { page: 2, agreement: expect.any(Number), flagged: true },
    ]);
    // The text edition is made: a book of its own, an EPUB linked to the scan, with its paragraphs built like any EPUB's.
    const [book] = await database.db.select().from(books).where(eq(books.editionOf, bookId));
    expect(book).toMatchObject({ ownerId, title: "A Scanned Meditation", fileType: "epub", fileKey: `books/${ownerId}/${book.id}.epub`, fileSize: expect.any(Number) });
    const edition = await storage.get(book.fileKey!);
    expect(edition?.contentType).toBe("application/epub+zip");
    const paragraphs = (await getSections(database.db, ownerId, book.id)).filter((x) => x.kind === "paragraph").map((x) => x.text);
    expect(paragraphs).toContain("Several years have now elapsed since I first became aware that I had accepted, even from my youth, many false opinions for true.");
    const files = unzipSync(edition!.data);
    expect(strFromU8(files["OEBPS/about.xhtml"])).toContain("read from the scanned pages of the PDF by fake on");
    expect(strFromU8(files["OEBPS/about.xhtml"])).toContain('<a href="c2.xhtml#page-2">2</a>'); // the page to check
    expect(strFromU8(files["OEBPS/c1.xhtml"])).toContain("Several years have now elapsed since I first became aware");
    expect(strFromU8(files["OEBPS/nav.xhtml"])).toContain('#page-3">3<'); // the blank page keeps its place

    const s = await textEditionSummary(deps(model), ownerId, bookId);
    expect(s.done).toBe(3); // two read, one blank
    expect(s.job).toMatchObject({ status: "finished", sent: 2, read: 2, toCheck: [{ page: 2 }] });
  });

  it("makes the edition again in place: the same book, so its notes and place stay", async () => {
    const bookId = await scannedBook();
    const model = new FakeBatchModel({ answer });
    await (await startTextEdition(deps(model), ownerId, bookId, true)).done;
    await pollTextEditions(deps(model));
    const [first] = await database.db.select().from(books).where(eq(books.editionOf, bookId));
    expect(await makeTextEdition(deps(model), ownerId, bookId)).toBe(first.id);
    expect(await database.db.select({ id: books.id }).from(books).where(eq(books.editionOf, bookId))).toEqual([{ id: first.id }]);
  });

  it("splits the pages into batches by size", async () => {
    const bookId = await scannedBook();
    const model = new FakeBatchModel({ answer });
    await (await startTextEdition(deps(model, { batchChars: 1 }), ownerId, bookId, true)).done;
    expect([...model.batches.values()].map((b) => b.requests.map((r) => r.id))).toEqual([["page-1"], ["page-2"]]);
    await pollTextEditions(deps(model));
    expect((await jobRow(bookId)).status).toBe("finished");
  });

  it("starts one job per book: a second start while it goes on starts nothing", async () => {
    const bookId = await scannedBook();
    const model = new FakeBatchModel({ answer, pollsUntilEnded: 5 });
    await (await startTextEdition(deps(model), ownerId, bookId, true)).done;
    expect((await startTextEdition(deps(model), ownerId, bookId, true)).started).toBe(false);
    expect(model.batches.size).toBe(1);
  });

  it("never pays twice: pages read before are skipped, and a book read through cannot be started again", async () => {
    const bookId = await scannedBook();
    const model = new FakeBatchModel({ answer });
    await (await startTextEdition(deps(model), ownerId, bookId, true)).done;
    await pollTextEditions(deps(model));
    expect((await textEditionSummary(deps(model), ownerId, bookId)).done).toBe(3); // two read, one blank
    await expect(startTextEdition(deps(model), ownerId, bookId, true)).rejects.toThrow(/Every page of this book has been read already/);
    expect(model.batches.size).toBe(1);
  });
});

describe("a restart while Anthropic works", () => {
  it("keeps waiting for batches sent before the restart, and saves their answers", async () => {
    const bookId = await scannedBook();
    const anthropic = new FakeBatchModel({ answer, pollsUntilEnded: 1 }); // Anthropic keeps the batch across our restart
    await (await startTextEdition(deps(anthropic), ownerId, bookId, true)).done;
    forgetTextEditionsForTests();
    await pollTextEditions(deps(anthropic));
    expect((await jobRow(bookId)).status).toBe("waiting");
    await pollTextEditions(deps(anthropic));
    expect((await jobRow(bookId)).status).toBe("finished");
    expect(await pagesRead(bookId)).toEqual(["page-1", "page-2"]);
  });

  it("picks up a preparation the restart cut short", async () => {
    const bookId = await scannedBook();
    const model = new FakeBatchModel({ answer });
    // As if the server stopped after the job was created, before any page was sent.
    await database.db.insert(textEditionJobs).values({ ownerId, bookId, provider: "anthropic", model: "fake", promptHash: (await import("@/lib/ai/prompts")).sha256(await readPrompt("transcribe-page")), status: "preparing", pageCount: 3, estimateUsd: 0.03 });
    await pollTextEditions(deps(model));
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 50 && (await jobRow(bookId)).status === "preparing"; i++) await new Promise((r) => setTimeout(r, 20));
    await pollTextEditions(deps(model));
    expect((await jobRow(bookId)).status).toBe("finished");
    expect(await pagesRead(bookId)).toEqual(["page-1", "page-2"]);
  });
});

describe("Stop", () => {
  it("cancels the batches: nothing is read or charged, and the job says it was stopped", async () => {
    const bookId = await scannedBook();
    const model = new FakeBatchModel({ answer, pollsUntilEnded: 100 });
    await (await startTextEdition(deps(model), ownerId, bookId, true)).done;
    await stopTextEdition(deps(model), ownerId, bookId);
    await pollTextEditions(deps(model));
    const job = await jobRow(bookId);
    expect(job.status).toBe("stopped");
    expect(job.problems.map((p) => [p.page, p.kind])).toEqual([[1, "canceled"], [2, "canceled"]]);
    expect(job.message).toMatch(/^Stopped, as you asked\. 0 pages read/);
    expect(await pagesRead(bookId)).toEqual([]);
    expect((await spending(database.db, "anthropic", bookId)).book).toBe(0);
    // Nothing was read, so no text edition is made.
    expect(await database.db.select().from(books).where(eq(books.editionOf, bookId))).toEqual([]);
  });
});

describe("the limits while a job goes on", () => {
  it("holds the estimate until the pages are paid for, then counts only what they cost", async () => {
    const bookId = await scannedBook();
    const model = new FakeBatchModel({ answer, pollsUntilEnded: 1 });
    const { done } = await startTextEdition(deps(model), ownerId, bookId, true);
    await done;
    const estimate = (await jobRow(bookId)).estimateUsd;
    expect((await spendingWithJobs(database.db, "anthropic", bookId)).book).toBeCloseTo(estimate, 9);
    await pollTextEditions(deps(model));
    await pollTextEditions(deps(model));
    expect((await jobRow(bookId)).status).toBe("finished");
    expect((await spendingWithJobs(database.db, "anthropic", bookId)).book).toBeCloseTo(2 * batchCostUsd("fake", 4000, 700), 9);
  });

  it("counts a page Claude declined but was billed for, lists it as not read, and never serves it as text", async () => {
    const bookId = await scannedBook();
    const model = new FakeBatchModel({
      answer: (r) => (r.id === "page-2" ? { id: r.id, kind: "refused", message: "Declined.", model: "fake", inputTokens: 4000, outputTokens: 10 } : answer(r)),
    });
    await (await startTextEdition(deps(model), ownerId, bookId, true)).done;
    await pollTextEditions(deps(model));
    const job = await jobRow(bookId);
    expect(job.problems).toEqual([{ page: 2, kind: "refused", message: "Declined." }]);
    expect(await pagesRead(bookId)).toEqual(["page-1"]);
    expect((await spending(database.db, "anthropic", bookId)).book).toBeCloseTo(batchCostUsd("fake", 4000, 700) + batchCostUsd("fake", 4000, 10), 9);
    expect((await textEditionSummary(deps(model), ownerId, bookId)).done).toBe(2); // page 1 read, page 3 blank; page 2 still to read
  });
});

describe("the text edition in the library", () => {
  it("is hidden from the shelf and from search across the library, but searched inside itself", async () => {
    const bookId = await scannedBook();
    const model = new FakeBatchModel({ answer });
    await (await startTextEdition(deps(model), ownerId, bookId, true)).done;
    await pollTextEditions(deps(model));
    const [edition] = await database.db.select().from(books).where(eq(books.editionOf, bookId));
    expect((await listShelf(database.db, ownerId, {})).map((b) => b.id)).toEqual([bookId]);
    // "disagree throughout" is only in the edition (Claude's reading of page 2), so across the library nothing is found.
    expect(await searchLibrary(database.db, ownerId, "disagree throughout")).toEqual([]);
    expect((await searchLibrary(database.db, ownerId, "disagree throughout", 60, edition.id)).map((h) => h.bookId)).toEqual([edition.id]);
  });

  it("is never taken for its scan: adding the scan's file again finds the scan", async () => {
    const bookId = await scannedBook();
    const model = new FakeBatchModel({ answer });
    await (await startTextEdition(deps(model), ownerId, bookId, true)).done;
    await pollTextEditions(deps(model));
    const again = await importBook(database.db, storage, ownerId, { name: "again.pdf", bytes: new Uint8Array(readFileSync(new URL("../../fixtures/books/scanned-meditation.pdf", import.meta.url))) });
    expect(again).toMatchObject({ status: "duplicate", bookId });
  });

  it("shares its scan's AI limit: spending on the edition counts toward the scan", async () => {
    const bookId = await scannedBook();
    const model = new FakeBatchModel({ answer });
    await (await startTextEdition(deps(model), ownerId, bookId, true)).done;
    await pollTextEditions(deps(model));
    const [edition] = await database.db.select().from(books).where(eq(books.editionOf, bookId));
    const pages = (await spending(database.db, "anthropic", bookId)).book;
    await database.db.insert(generations).values({ ownerId, bookId: edition.id, kind: "rewrite", cacheKey: "k", provider: "anthropic", model: "fake", promptName: "rewrite", promptHash: "h", inputHash: "i", costUsd: 0.5, output: "o" });
    expect((await spending(database.db, "anthropic", bookId)).book).toBeCloseTo(pages + 0.5, 9);
    expect((await spending(database.db, "anthropic", edition.id)).book).toBeCloseTo(pages + 0.5, 9);
  });
});

describe("pages read on the owner's Claude subscription (scripts/text-edition-on-subscription.ts)", () => {
  const page = async (n: number, over: Record<string, unknown> = {}) => ({
    page: n,
    markdown: READ[`page-${n}`],
    model: "claude-sonnet-5-5",
    promptHash: sha256(await readPrompt("transcribe-page")),
    inputHash: sha256(`picture ${n}`),
    inputTokens: 4321,
    outputTokens: 600,
    ...over,
  });

  it("saves the pages in parts, then checks them and makes the text edition, at no cost to the AI limits", async () => {
    const bookId = await scannedBook();
    const save = (input: Record<string, unknown>) => savePagesReadElsewhere(deps(), ownerId, bookId, input);
    expect(await save({ pages: [await page(1)], finish: false })).toMatchObject({ saved: 1, editionId: null });
    expect(await database.db.select().from(books).where(eq(books.editionOf, bookId))).toEqual([]); // not before the last part
    const done = await save({ pages: [await page(2)], blankPages: [3], finish: true });
    expect(done).toMatchObject({ saved: 1, read: 2, blankPages: [3], toCheck: [{ page: 2, flagged: true }], editionId: expect.any(String) });

    const rows = await database.db.select().from(generations).where(eq(generations.bookId, bookId));
    expect(rows.map((r) => [r.sectionId, r.kind, r.provider, r.model, r.costUsd, r.inputTokens])).toEqual([
      ["page-1", "transcribe", SUBSCRIPTION_PROVIDER, "claude-sonnet-5-5", 0, 4321],
      ["page-2", "transcribe", SUBSCRIPTION_PROVIDER, "claude-sonnet-5-5", 0, 4321],
    ]);
    expect((await spending(database.db, "anthropic", bookId)).book).toBe(0);
    const job = await jobRow(bookId);
    expect(job).toMatchObject({ provider: SUBSCRIPTION_PROVIDER, status: "finished", blankPages: [3], estimateUsd: 0 });
    expect(job.message).toBe("Read on the owner's Claude subscription: 2 pages read, 1 blank, 1 to check.");

    // The edition, as a batch job makes it: its paragraphs, the page to check, the blank page's marker, who read it.
    const paragraphs = (await getSections(database.db, ownerId, done.editionId!)).filter((x) => x.kind === "paragraph").map((x) => x.text);
    expect(paragraphs).toContain("Several years have now elapsed since I first became aware that I had accepted, even from my youth, many false opinions for true.");
    const [edition] = await database.db.select().from(books).where(eq(books.editionOf, bookId));
    const files = unzipSync((await storage.get(edition.fileKey!))!.data);
    expect(strFromU8(files["OEBPS/about.xhtml"])).toContain("by claude-sonnet-5-5 on");
    expect(strFromU8(files["OEBPS/about.xhtml"])).toContain('<a href="c2.xhtml#page-2">2</a>');
    expect(strFromU8(files["OEBPS/nav.xhtml"])).toContain('#page-3">3<');

    // The server (whose batch model is Sonnet 5.5, as these pages' reader) never reads them again through the API.
    const model = Object.defineProperty(new FakeBatchModel({ answer }), "model", { value: "claude-sonnet-5-5" });
    expect((await textEditionSummary(deps(model), ownerId, bookId)).done).toBe(3);
    await expect(startTextEdition(deps(model), ownerId, bookId, true)).rejects.toThrow("Every page of this book has been read already.");
  });

  it("sent again, adds nothing; read again with other words, the newer reading is used", async () => {
    const bookId = await scannedBook();
    const save = (input: Record<string, unknown>) => savePagesReadElsewhere(deps(), ownerId, bookId, input);
    await save({ pages: [await page(1), await page(2)], finish: true });
    expect(await save({ pages: [await page(1), await page(2)], finish: false })).toMatchObject({ saved: 0 });
    expect(await pagesRead(bookId)).toEqual(["page-1", "page-2"]);
    const first = (await database.db.select().from(books).where(eq(books.editionOf, bookId)))[0].id;
    const again = await save({ pages: [await page(2, { markdown: "# Page two\n\nRead again, with these words instead." })], finish: true });
    expect(again.editionId).toBe(first); // the same edition, so its notes and place stay
    expect(await pagesRead(bookId)).toEqual(["page-1", "page-2", "page-2"]);
    const paragraphs = (await getSections(database.db, ownerId, first)).filter((x) => x.kind === "paragraph").map((x) => x.text);
    expect(paragraphs).toContain("Read again, with these words instead.");
  });

  it("refuses pages read with other instructions, bad page numbers, another reader's book, and while a batch job goes on", async () => {
    const bookId = await scannedBook();
    const save = (input: Record<string, unknown>, owner = ownerId, book = bookId) => savePagesReadElsewhere(deps(), owner, book, input);
    await expect(save({ pages: [await page(1, { promptHash: sha256("other instructions") })] })).rejects.toThrow("read with other instructions");
    await expect(save({ pages: [await page(9)] })).rejects.toThrow("between 1 and 3");
    // A blank page the book does not have, or a page count for a different file, is refused before anything is saved.
    await expect(save({ pages: [await page(1)], blankPages: [4] })).rejects.toThrow("between 1 and 3");
    await expect(save({ pages: [await page(1)], pageCount: 388 })).rejects.toThrow("3 pages, not 388");
    await expect(save({ pages: [await page(1, { model: "gpt-5" })] })).rejects.toThrow("must be a Claude model");
    await expect(save({ pages: [], finish: true })).rejects.toThrow("No page of this book has been read yet");
    await expect(save({ pages: [await page(1)] }, crypto.randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(await pagesRead(bookId)).toEqual([]);

    const model = new FakeBatchModel({ answer });
    await (await startTextEdition(deps(model), ownerId, bookId, true)).done;
    await expect(save({ pages: [await page(1)] })).rejects.toMatchObject({ status: 409 });
  });
});
