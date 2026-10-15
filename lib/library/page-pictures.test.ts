import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { BLANK_INK, MAX_LONG_EDGE, MAX_PICTURE_TOKENS, openPdfForPictures, pictureSize, pictureTokens } from "./page-pictures";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("the size a page is drawn at", () => {
  it("is 300 dots per inch when that fits Claude's limits", () => {
    // The Pay Off: a page of about 326 x 536 points (4.5 x 7.4 inches).
    const s = pictureSize(326, 536);
    expect([s.width, s.height]).toEqual([1358, 2233]);
    expect(pictureTokens(s.width, s.height)).toBeLessThanOrEqual(MAX_PICTURE_TOKENS);
  });

  it("shrinks a large page only as far as Claude's limits require", () => {
    // US Letter at 300 dpi would be 2550 x 3300: too long and too many tokens.
    const s = pictureSize(612, 792);
    expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(MAX_LONG_EDGE);
    expect(pictureTokens(s.width, s.height)).toBeLessThanOrEqual(MAX_PICTURE_TOKENS);
    expect(pictureTokens(s.width, s.height)).toBeGreaterThan(MAX_PICTURE_TOKENS * 0.95);
  });

  it("counts Claude's picture tokens as 28 x 28-pixel squares (Anthropic's vision page)", () => {
    expect(pictureTokens(1360, 2225)).toBe(49 * 80);
    expect(pictureTokens(1000, 1000)).toBe(1296);
  });
});

describe("drawing pages on the server", () => {
  it("draws a scanned page's JPEG 2000 and JBIG2 pictures, with ink", async () => {
    const doc = await openPdfForPictures(readFileSync("fixtures/books/scanned-meditation.pdf"));
    try {
      expect(doc.pageCount).toBe(2);
      for (const n of [1, 2]) {
        const p = await doc.picture(n);
        expect(p.png.subarray(0, 4).equals(PNG), `page ${n} is a PNG`).toBe(true);
        expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(MAX_LONG_EDGE);
        expect(p.ink, `page ${n} has ink`).toBeGreaterThan(BLANK_INK * 10);
      }
    } finally {
      await doc.close();
    }
  });

  it("finds a blank page blank", async () => {
    // On The Pay Off (388 pages, measured 2026-10-15) the 27 blank pages, some
    // with print showing through from the other side, had at most 0.034% dark
    // ink, and the lightest page with words (a part title) 0.67%: the line at
    // 0.1% sits well between.
    const blank = await PDFDocument.create();
    blank.addPage([326, 536]);
    const doc = await openPdfForPictures(await blank.save());
    try {
      expect((await doc.picture(1)).ink).toBeLessThan(BLANK_INK);
    } finally {
      await doc.close();
    }
  });
});

describe("the start-up check", () => {
  it("says the canvas works on this machine", async () => {
    const { pagePicturesProblem } = await import("./page-pictures");
    expect(await pagePicturesProblem()).toBeNull();
  });
});
