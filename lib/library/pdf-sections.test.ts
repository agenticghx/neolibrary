import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPdfSections, pageCfi, toolParagraphs } from "./pdf-sections";

/**
 * A one-page PDF, written out here: a line of Japanese in a font that is not
 * embedded and has no map to Unicode of its own (pdf.js reads it only with
 * its character maps, as the reader's pages do), then a line in English.
 */
function japanesePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 7 0 R >> >> /Contents 8 0 R >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /KozMinPr6N-Regular /Encoding /UniJIS-UCS2-H /DescendantFonts [5 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /KozMinPr6N-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /FontDescriptor 6 0 R /DW 1000 >>",
    "<< /Type /FontDescriptor /FontName /KozMinPr6N-Regular /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 740 /StemV 80 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  // <65E5672C8A9E> is 日本語 ("Japanese") in the font's encoding.
  const content = "BT /F1 12 Tf 72 700 Td <65E5672C8A9E> Tj ET\nBT /F2 12 Tf 72 680 Td (Hello reader of this page) Tj ET\n";
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe("PDF sections", () => {
  it("gives one chapter per page and paragraphs with the page's address", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/descartes-meditation-one.pdf", import.meta.url)));
    const s = await extractPdfSections(bytes);
    expect(s[0]).toMatchObject({ kind: "chapter", label: "Page 1", cfi: "epubcfi(/6/2)" });
    const paragraphs = s.filter((x) => x.kind === "paragraph");
    expect(paragraphs.length).toBeGreaterThanOrEqual(4);
    expect(paragraphs[0].text).toBe("MEDITATION I. OF THE THINGS OF WHICH WE MAY DOUBT.");
    expect(paragraphs[1].text).toMatch(/^Several years have now elapsed since I first became aware/);
    expect(paragraphs[1].text).toMatch(/superstructure in the sciences\.$/);
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
    const again = await extractPdfSections(bytes);
    expect(again.map((x) => x.id)).toEqual(s.map((x) => x.id));
    expect(pageCfi(4)).toBe("epubcfi(/6/10)");
  });

  it("reads text in a font only pdf.js's character maps can read (M13 (e)), as the reader's pages do", async () => {
    // Without them the Japanese is dropped here but shown on the page, and the
    // read-along highlight, counting characters from the top, would land on other words.
    const paragraphs = (await extractPdfSections(japanesePdf())).filter((x) => x.kind === "paragraph");
    expect(paragraphs.map((p) => p.text)).toEqual(["日本語 Hello reader of this page"]);
  });

  it("lists the paragraphs for the laptop's tools: the app's own ids, pages counted from 1, the same text (Part D)", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/descartes-meditation-one.pdf", import.meta.url)));
    const s = await extractPdfSections(bytes);
    const listed = toolParagraphs(s);
    const paragraphs = s.filter((x) => x.kind === "paragraph");
    expect(listed.map((p) => p.id)).toEqual(paragraphs.map((p) => p.id));
    expect(listed.map((p) => p.text)).toEqual(paragraphs.map((p) => p.text));
    expect(listed[0]).toEqual({ id: "p-page-1-1", page: 1, text: "MEDITATION I. OF THE THINGS OF WHICH WE MAY DOUBT." });
    expect(listed.every((p, k) => p.page === paragraphs[k].chapterIndex + 1)).toBe(true);
  });
});
