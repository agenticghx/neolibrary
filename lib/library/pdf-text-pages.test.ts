import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { readBook } from "./ebook";
import { importBook } from "./import";
import { getBook } from "./paths";
import { hasOwnText, pagesFromPdfText, rawPdfPages } from "./pdf-text-pages";
import { getSections } from "./sections-store";
import { makeTextEditionFromPdfText, pdfTextEditionForPage, TextEditionError } from "./text-edition";

/**
 * An invented book, typeset like a real one (M31): a running head in italics and a page number on every page, a
 * bold chapter heading, paragraphs set in from the margin, italics, a footnote in smaller type with its raised
 * reference, and words broken at line ends. Body 12 pt, notes 9 pt, raised numbers 7 pt.
 */
async function inventedBook() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Microsoft Word - lamps.docx");
  const roman = await pdf.embedFont(StandardFonts.TimesRoman);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  type Run = [string, PDFFont?];
  const line = (page: PDFPage, y: number, x: number, runs: Run[], size = 12) => {
    let at = x;
    for (const [text, font = roman] of runs) {
      page.drawText(text, { x: at, y, size, font });
      at += font.widthOfTextAtSize(text, size);
    }
  };
  const frame = (page: PDFPage, n: number) => {
    line(page, 740, 72, [["An Invented Book of Lamps", italic]], 11);
    line(page, 40, 300, [[String(n)]], 11);
  };
  // Page 1: a chapter opens.
  const p1 = pdf.addPage([612, 792]);
  frame(p1, 1);
  line(p1, 680, 72, [["I. The First Lamps", bold]], 14);
  line(p1, 640, 90, [["The first lamps burned oil in small dishes, and every house kept one by the "]]);
  line(p1, 624, 72, [["door. The ", roman], ["Lamp Gazette", italic], [" praised them, and the keep-"]]);
  line(p1, 608, 72, [["ers trimmed their wicks at dusk. A well-known maker sold them by the dozen."]]);
  line(p1, 592, 90, [["Later lamps were brighter and burned longer, though each one cost more and"]]);
  line(p1, 576, 72, [["needed more care than the dish it replaced, as one keeper wrote."]]);
  line(p1, 582, 72 + roman.widthOfTextAtSize("needed more care than the dish it replaced, as one keeper wrote.", 12), [["1"]], 7);
  line(p1, 120, 72, [["1"]], 7);
  line(p1, 115, 78, [["A keeper's diary, kept in the town hall, records the change in a single line."]], 9);
  // Page 2: the chapter goes on; a paragraph runs over the page break.
  const p2 = pdf.addPage([612, 792]);
  frame(p2, 2);
  line(p2, 680, 90, [["Gas came next. It was cheaper than oil and far cleaner, and the streets of the town were lit by it"]]);
  line(p2, 664, 72, [["within ten years, from the station to the furthest well-"]]);
  line(p2, 648, 72, [["known corner of the market square, which pleased every shopkeeper there"]]);
  // Page 3: a new chapter.
  const p3 = pdf.addPage([612, 792]);
  frame(p3, 3);
  line(p3, 680, 72, [["II. Electric Light", bold]], 14);
  line(p3, 640, 90, [["Then came electric light, which needed no flame at all and could be switched on from across the room by anyone."]]);
  line(p3, 624, 72, [["It changed the evenings of the town for good, and the lamp keepers found other work."]]);
  return pdf.save();
}

describe("a PDF's own text, laid out again (M31)", () => {
  it("drops running heads and page numbers, and finds chapters, paragraphs, italics, notes and broken words", async () => {
    const raw = await rawPdfPages(await inventedBook());
    expect(hasOwnText(raw)).toBe(true);
    const pages = pagesFromPdfText(raw);
    expect(pages.map((p) => p.kind)).toEqual(["read", "read", "read"]);
    const [one, two, three] = pages.map((p) => (p.kind === "read" ? p.markdown : ""));
    expect(one).not.toContain("Invented Book of Lamps");
    expect(one.split("\n\n")).toEqual([
      "# I. The First Lamps",
      "The first lamps burned oil in small dishes, and every house kept one by the door. The *Lamp Gazette* praised them, and the keepers trimmed their wicks at dusk. A well-known maker sold them by the dozen.",
      "Later lamps were brighter and burned longer, though each one cost more and needed more care than the dish it replaced, as one keeper wrote.[^1]",
      "[^1]: A keeper's diary, kept in the town hall, records the change in a single line.",
    ]);
    // "well-" at a line end keeps its hyphen: the book writes "well-known" inside a line too.
    expect(two).toBe(
      "Gas came next. It was cheaper than oil and far cleaner, and the streets of the town were lit by it within ten years, from the station to the furthest well-known corner of the market square, which pleased every shopkeeper there",
    );
    expect(three.split("\n\n")[0]).toBe("# II. Electric Light");
    expect(three).not.toMatch(/^3$/m);
  });

  it("knows a scan from a PDF with text of its own", async () => {
    const scan = await rawPdfPages(new Uint8Array(readFileSync(new URL("../../fixtures/books/scanned-meditation.pdf", import.meta.url))));
    expect(hasOwnText(scan)).toBe(false);
  });
});

describe("making the flowing text edition from it (M31)", () => {
  let database: Database;
  let storage: MemoryStorage;
  let ownerId: string;
  beforeEach(async () => {
    database = await testDatabase();
    storage = new MemoryStorage();
    ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  });
  afterEach(() => database.raw.close());

  it("makes an EPUB edition linked to the PDF, chapter by chapter, saying no AI was used; made again, it keeps its id", async () => {
    const added = await importBook(database.db, storage, ownerId, { name: "lamps.pdf", bytes: await inventedBook() });
    expect(await pdfTextEditionForPage(database.db, ownerId, added.bookId)).toEqual({ editionId: null });
    const made = await makeTextEditionFromPdfText({ db: database.db, storage }, ownerId, added.bookId);
    expect(made).toMatchObject({ pages: 3, read: 3 });
    const edition = (await getBook(database.db, ownerId, made.editionId, true))!.book;
    expect(edition).toMatchObject({ editionOf: added.bookId, fileType: "epub" });
    const file = await storage.get(edition.fileKey!);
    const info = await readBook(file!.data, "x.epub");
    expect(info.toc.map((t) => t.label)).toEqual(["About this edition", "I. The First Lamps", "II. Electric Light"]);
    const text = new TextDecoder().decode(file!.data);
    expect(text).not.toContain("by the the PDF"); // the About page is written for a PDF's own text
    const chapters = (await getSections(database.db, ownerId, made.editionId)).filter((s) => s.kind === "chapter").map((s) => s.label);
    expect(chapters).toEqual(["About this edition", "I. The First Lamps", "II. Electric Light"]);
    const paragraphs = (await getSections(database.db, ownerId, made.editionId)).filter((s) => s.kind === "paragraph").map((s) => s.text);
    expect(paragraphs[0]).toMatch(/^This text is the PDF's own text, laid out again to flow/);
    expect(paragraphs[0]).toContain("No AI read or wrote it.");
    expect(await pdfTextEditionForPage(database.db, ownerId, added.bookId)).toEqual({ editionId: made.editionId });
    const again = await makeTextEditionFromPdfText({ db: database.db, storage }, ownerId, added.bookId);
    expect(again.editionId).toBe(made.editionId);
  });

  it("refuses a scan (no text of its own) and another reader's book, and is not offered for them", async () => {
    const scan = await importBook(database.db, storage, ownerId, {
      name: "scanned-meditation.pdf",
      bytes: new Uint8Array(readFileSync(new URL("../../fixtures/books/scanned-meditation.pdf", import.meta.url))),
    });
    expect(await pdfTextEditionForPage(database.db, ownerId, scan.bookId)).toBeNull();
    await expect(makeTextEditionFromPdfText({ db: database.db, storage }, ownerId, scan.bookId)).rejects.toThrow(/no text of its own/);
    await expect(makeTextEditionFromPdfText({ db: database.db, storage }, crypto.randomUUID(), scan.bookId)).rejects.toThrow(TextEditionError);
  });
});
