import type { Section } from "./sections";

/**
 * Section model for PDFs: one chapter per page ("Page N"), paragraphs split
 * where the text breaks to a new block. A PDF has no finer addresses than the
 * page, so every paragraph's CFI points at its page (the same page addresses
 * foliate-js uses for fixed-layout books: epubcfi(/6/2) is page 1).
 */
type TextItem = { str: string; hasEOL?: boolean; transform: number[]; height: number };

export const pageCfi = (index: number) => `epubcfi(/6/${(index + 1) * 2})`;

export async function extractPdfSections(bytes: Uint8Array): Promise<Section[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    // Only text is read here, but pdf.js warns without its font folder.
    standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`,
    // The character maps the reader's pdf.js uses too (public/pdfjs/cmaps is a copy): without them,
    // text in some fonts (Chinese, Japanese, Korean) is not read here but is on the page, and the
    // read-along highlight, which counts characters from the top of the page, lands on other words.
    cMapUrl: `${process.cwd()}/node_modules/pdfjs-dist/cmaps/`,
    cMapPacked: true,
  });
  const pdf = await task.promise;
  const out: Section[] = [];
  let position = 0;
  try {
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      const items = content.items.filter((x) => "str" in x) as unknown as TextItem[];
      // Group into paragraphs: a new paragraph where the gap to the next line
      // is clearly larger than the page's typical line step (the median).
      const steps: number[] = [];
      for (let k = 1; k < items.length; k++) {
        const step = items[k - 1].transform[5] - items[k].transform[5];
        if (step > 0) steps.push(step);
      }
      const sorted = [...steps].sort((a, b) => a - b);
      const typical = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      const paragraphs: string[] = [];
      let current = "";
      let lastY: number | null = null;
      for (const it of items) {
        const y = it.transform[5];
        if (lastY !== null && y < lastY) {
          if (typical && lastY - y > typical * 1.4 && current.trim()) {
            paragraphs.push(current);
            current = "";
          } else if (!current.endsWith(" ")) current += " ";
        }
        current += it.str;
        lastY = y;
      }
      if (current.trim()) paragraphs.push(current);
      const texts = paragraphs.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
      if (!texts.length) continue;
      const chapterId = `c-page-${i + 1}`;
      const cfi = pageCfi(i);
      out.push({ id: chapterId, kind: "chapter", parentId: null, position: position++, chapterIndex: i, href: `page-${i + 1}`, cfi, label: `Page ${i + 1}`, text: "" });
      texts.forEach((text, n) => {
        out.push({ id: `p-page-${i + 1}-${n + 1}`, kind: "paragraph", parentId: chapterId, position: position++, chapterIndex: i, href: `page-${i + 1}`, cfi, label: "", text });
      });
    }
  } finally {
    await task.destroy();
  }
  return out;
}
