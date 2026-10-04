import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPdfSections, pageCfi } from "./pdf-sections";

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
});
