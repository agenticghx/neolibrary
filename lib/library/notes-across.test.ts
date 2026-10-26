import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPrompt, sha256 } from "@/lib/ai/prompts";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { createAnnotation, listAnnotations } from "./annotations";
import { importBook } from "./import";
import { notesAcross } from "./notes-across";
import { savePagesReadElsewhere } from "./text-edition";

/**
 * Notes cross between a scan and its text edition (Open unknowns row 23 (1), decided 2026-10-26): each version's
 * reader gets the other's notes with the printed page each is on, and its own notes' pages; nothing moves.
 */
let database: Database;
let storage: MemoryStorage;
let ownerId: string;

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

/** A 3-page scan read for its edition: pages 1 and 2 in a chapter "One", page 3 in a chapter "Two". */
async function scanAndEdition() {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (const line of ["ONE. The first page.", "The quick brovvn fox jumps over the lazy dog.", "TWO. The third page."]) doc.addPage([612, 792]).drawText(line, { x: 72, y: 700, size: 12, font });
  const scanId = (await importBook(database.db, storage, ownerId, { name: "scan.pdf", bytes: new Uint8Array(await doc.save()) })).bookId;
  const promptHash = sha256(await readPrompt("transcribe-page"));
  const read = (page: number, markdown: string) => ({ page, markdown, model: "claude-sonnet-5-5", promptHash, inputHash: sha256(`picture ${page}`), inputTokens: 1, outputTokens: 1 });
  const pages = [read(1, "# One\n\nThe first page."), read(2, "The quick brown fox jumps over the lazy dog."), read(3, "# Two\n\nThe third page.")];
  const { editionId } = await savePagesReadElsewhere({ db: database.db, storage }, ownerId, scanId, { pages, finish: true });
  return { scanId, editionId: editionId! };
}

const highlight = (bookId: string, cfi: string, exact: string, prefix = "") =>
  createAnnotation(database.db, ownerId, { kind: "highlight", bookId, cfi, quote: { exact, prefix, suffix: "" }, color: "sage" });

describe("notes across a scan and its text edition", () => {
  it("each version is given the other's notes with their printed pages, and its own notes' pages", async () => {
    const { scanId, editionId } = await scanAndEdition();
    // On the scan's page 2 (spine step 4), in the Archive's spelling.
    const onScan = await highlight(scanId, "epubcfi(/6/4!/4/2/1:4)", "quick brovvn fox", "The ");
    // In the edition: chapter "One" is spine step 4 (after "About this edition"), chapter "Two" step 6.
    const onTextPage2 = await highlight(editionId, "epubcfi(/6/4!/4/6/1:30)", "the lazy dog", "fox jumps over ");
    const onTextPage3 = await highlight(editionId, "epubcfi(/6/6!/4/4/1:4)", "third page", "The ");

    const inEdition = await notesAcross(database.db, storage, ownerId, editionId, await listAnnotations(database.db, ownerId, editionId));
    expect(inEdition.crossed.map((a) => [a.id, a.crossed, a.quote.exact])).toEqual([[onScan.id, { from: "scan", page: 2 }, "quick brovvn fox"]]);
    expect(inEdition.pages).toEqual({ [onTextPage2.id]: 2, [onTextPage3.id]: 3 });

    const onScanSide = await notesAcross(database.db, storage, ownerId, scanId, await listAnnotations(database.db, ownerId, scanId));
    expect(onScanSide.crossed.map((a) => [a.id, a.crossed])).toEqual([
      [onTextPage2.id, { from: "text", page: 2 }],
      [onTextPage3.id, { from: "text", page: 3 }],
    ]);
    expect(onScanSide.pages).toEqual({ [onScan.id]: 2 });

    // Nothing moved: each book's own notes (what its export holds) are only the ones made in it.
    expect((await listAnnotations(database.db, ownerId, scanId)).map((a) => a.id)).toEqual([onScan.id]);
    expect((await listAnnotations(database.db, ownerId, editionId)).map((a) => a.id).sort()).toEqual([onTextPage2.id, onTextPage3.id].sort());
  });

  it("a book with no other version gets nothing more", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).drawText("Alone on the shelf.", { x: 72, y: 700, size: 12, font: await doc.embedFont(StandardFonts.TimesRoman) });
    const id = (await importBook(database.db, storage, ownerId, { name: "alone.pdf", bytes: new Uint8Array(await doc.save()) })).bookId;
    await highlight(id, "epubcfi(/6/2!/4/2/1:0)", "Alone");
    expect(await notesAcross(database.db, storage, ownerId, id, await listAnnotations(database.db, ownerId, id))).toEqual({ crossed: [], pages: {} });
  });
});
