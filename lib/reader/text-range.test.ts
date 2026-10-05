import { DOMParser } from "linkedom";
import { describe, expect, it } from "vitest";
import { extractPdfSections } from "@/lib/library/pdf-sections";
import { nonSpaceBefore, positionsForNonSpace, positionsForOffsets } from "./text-range";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

describe("word offsets to a range on the page (M7)", () => {
  it("finds every word of a paragraph with inline markup and odd whitespace", () => {
    const html = `<html><body><p id="p">
      That evening, <i>Mr.  Utterson</i>
      came&#160;home to his <b>bach</b>elor house.</p></body></html>`;
    const doc = new DOMParser().parseFromString(html, "text/html") as unknown as Document;
    const el = doc.getElementById("p")!;
    const text = clean(el.textContent!);
    // Reads the text between two positions, across text nodes (what a Range would hold).
    const between = (a: [Node, number], b: [Node, number]) => {
      const walker = doc.createTreeWalker(el, 4);
      let out = "";
      let on = false;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const v = n.nodeValue ?? "";
        const s = n === a[0] ? a[1] : 0;
        if (n === a[0]) on = true;
        if (!on) continue;
        if (n === b[0]) return out + v.slice(s, b[1]);
        out += v.slice(s);
      }
      return out;
    };
    const words = [...text.matchAll(/\S+/g)];
    expect(words.map((m) => m[0])).toEqual(["That", "evening,", "Mr.", "Utterson", "came", "home", "to", "his", "bachelor", "house."]);
    for (const m of words) {
      const at = positionsForOffsets(el, m.index!, m.index! + m[0].length);
      expect(at, m[0]).not.toBeNull();
      expect(between(at!.start, at!.end)).toBe(m[0]);
    }
    expect(positionsForOffsets(el, 500, 505)).toBeNull();
  });
});

/** The text between two positions under `root`, across text nodes (what a Range would hold). */
function between(root: Element, a: [Node, number], b: [Node, number]) {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  let out = "";
  let on = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const v = n.nodeValue ?? "";
    const s = n === a[0] ? a[1] : 0;
    if (n === a[0]) on = true;
    if (!on) continue;
    if (n === b[0]) return out + v.slice(s, b[1]);
    out += v.slice(s);
  }
  return out;
}

describe("a word on a PDF page, by non-space characters (M13 (e))", () => {
  it("finds every word of the server's paragraphs in a text layer built like pdf.js's, glued running head and broken word included", async () => {
    // A page drawn here (no copyrighted text): a word broken across lines
    // with a hyphen, a second paragraph, and a running head drawn after the
    // body at the top, which pdf.js reads last, so the server's text glues
    // it onto the last word ("irreducibleIntroduction"), as in the Descartes
    // demo PDF (Samuel's Kuhn draws its running head first).
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.TimesRoman);
    const page = pdf.addPage([612, 792]);
    let y = 700;
    for (const line of ["The first paragraph tells how a normal-", "scientific habit forms over the years.", "", "A second paragraph follows on the same", "page, and it ends with the word irreducible"]) {
      if (line) page.drawText(line, { x: 72, y, size: 11, font });
      y -= line ? 14 : 18;
    }
    page.drawText("Introduction", { x: 72, y: 750, size: 9, font });
    page.drawText("x", { x: 520, y: 750, size: 9, font });
    const bytes = await pdf.save();

    const paragraphs = (await extractPdfSections(bytes)).filter((s) => s.kind === "paragraph");
    expect(paragraphs.map((p) => p.text)).toEqual([
      "The first paragraph tells how a normal- scientific habit forms over the years.",
      "A second paragraph follows on the same page, and it ends with the word irreducibleIntroduction x",
    ]);

    // The text layer as pdf.js's TextLayer builds it: one span per text item (none for an empty one), a <br> after an item that ends a line.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/` });
    const doc = await task.promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items.filter((x) => "str" in x) as { str: string; hasEOL: boolean }[];
    const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const html = `<html><body><div class="textLayer">${items.map((i) => (i.str ? `<span>${escape(i.str)}</span>` : "") + (i.hasEOL ? "<br>" : "")).join("")}<div class="endOfContent"></div></div></body></html>`;
    const layer = (new DOMParser().parseFromString(html, "text/html") as unknown as Document).querySelector(".textLayer")!;
    await task.destroy();

    // Each word's place on the page, as the server works it out for the player.
    let base = 0;
    const found: string[] = [];
    for (const p of paragraphs) {
      const before = nonSpaceBefore(p.text);
      for (const m of p.text.matchAll(/\S+/g)) {
        const at = positionsForNonSpace(layer, base + before[m.index!], base + before[m.index! + m[0].length]);
        expect(at, m[0]).not.toBeNull();
        found.push(between(layer, at!.start, at!.end));
      }
      base += before[p.text.length];
    }
    expect(found).toEqual(paragraphs.flatMap((p) => p.text.match(/\S+/g)!));
    // The matcher joins a broken word ("normal-" + "scientific"): one place across both lines.
    const first = paragraphs[0].text;
    const from = first.indexOf("normal-");
    const to = first.indexOf("scientific") + "scientific".length;
    const before = nonSpaceBefore(first);
    const joined = positionsForNonSpace(layer, before[from], before[to])!;
    expect(between(layer, joined.start, joined.end)).toBe("normal-scientific");
    // Nothing past the end, and no empty word.
    expect(positionsForNonSpace(layer, base, base + 3)).toBeNull();
    expect(positionsForNonSpace(layer, 5, 5)).toBeNull();
  });

  it("counts non-space string units the same way on both sides", () => {
    expect(nonSpaceBefore("a b\u00a0c")).toEqual([0, 1, 1, 2, 2, 3]);
    expect(nonSpaceBefore("")).toEqual([0]);
    // A character outside the Basic Multilingual Plane is two string units, counted as two, as the reader counts them.
    expect(nonSpaceBefore("x\u{1D400}y")).toEqual([0, 1, 2, 3, 4]);
  });
});
