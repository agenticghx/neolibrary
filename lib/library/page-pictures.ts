/**
 * Page pictures on the server (M25 S3): draws a PDF page as a PNG for Claude
 * to read (docs/scan-to-text-plan.md). pdf.js draws it, with its picture
 * decoders read from node_modules (scanned books are JPEG 2000 and JBIG2,
 * which pdf.js cannot draw without them: docs/root-cause-scanned-pdfs.md),
 * onto a canvas from @napi-rs/canvas.
 *
 * A page is drawn at 300 dots per inch, then made smaller only as far as
 * Claude's high-resolution limits require (2,576 pixels on the long edge and
 * 4,784 picture tokens, one per 28 x 28-pixel square): a larger picture would
 * be shrunk by Claude anyway, after paying to upload it.
 */
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";

export const MAX_LONG_EDGE = 2576;
export const MAX_PICTURE_TOKENS = 4784;
const DPI = 300;

/** Claude's picture tokens for a picture of this size: one per 28 x 28-pixel square. */
export const pictureTokens = (width: number, height: number) => Math.ceil(width / 28) * Math.ceil(height / 28);

/** The pixel size to draw a page of this many points (1/72 inch) at: 300 dpi, within Claude's limits. */
export function pictureSize(widthPt: number, heightPt: number) {
  let scale = DPI / 72;
  scale = Math.min(scale, MAX_LONG_EDGE / Math.max(widthPt, heightPt));
  const size = (s: number) => ({ width: Math.max(1, Math.floor(widthPt * s)), height: Math.max(1, Math.floor(heightPt * s)), scale: s });
  while (pictureTokens(size(scale).width, size(scale).height) > MAX_PICTURE_TOKENS) scale *= 0.99;
  return size(scale);
}

export type PagePicture = {
  png: Buffer;
  width: number;
  height: number;
  /** The share of the page that is dark ink (0 to 1); a blank page is close to 0. */
  ink: number;
};

/** A page with less dark ink than this is treated as blank (measured on The Pay Off: see the test). */
export const BLANK_INK = 0.001;

export async function openPdfForPictures(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const dist = `${process.cwd()}/node_modules/pdfjs-dist`;
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    wasmUrl: `${dist}/wasm/`,
    iccUrl: `${dist}/iccs/`,
    standardFontDataUrl: `${dist}/standard_fonts/`,
    cMapUrl: `${dist}/cmaps/`,
    cMapPacked: true,
    verbosity: 0,
  });
  const pdf: PDFDocumentProxy = await task.promise;
  return {
    pageCount: pdf.numPages,
    /** Draws page `pageNumber` (from 1). */
    async picture(pageNumber: number): Promise<PagePicture> {
      const { createCanvas } = await import("@napi-rs/canvas");
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const { width, height, scale } = pictureSize(base.width, base.height);
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport: page.getViewport({ scale }),
      }).promise;
      const px = context.getImageData(0, 0, width, height).data;
      let dark = 0;
      for (let i = 0; i < px.length; i += 4) if (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 128) dark++;
      page.cleanup();
      return { png: await canvas.encode("png"), width, height, ink: dark / (width * height) };
    },
    close: () => task.destroy(),
  };
}

/**
 * Whether this server can draw page pictures: the canvas package is a native
 * module with one build per platform, so a deploy proves it loads (M25 S3).
 * Returns null when it works, else the reason.
 */
export async function pagePicturesProblem(): Promise<string | null> {
  try {
    const { createCanvas } = await import("@napi-rs/canvas");
    const png = await createCanvas(2, 2).encode("png");
    return png.length > 0 ? null : "the canvas made an empty picture";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
