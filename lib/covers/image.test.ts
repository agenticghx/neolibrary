import { describe, expect, it } from "vitest";
import { bookPng } from "./fake-png";
import { checkCover, imageSize, MAX_COVER_BYTES } from "./image";

/** The start of a JPEG: SOI, an APP0 segment, then a baseline frame header with its height and width. */
function jpegHead(width: number, height: number) {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xff, // a fill byte before the next marker
    0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
}

/** A WebP (VP8X) header: canvas width and height minus one, 24 bits each, little-endian. */
function webpHead(width: number, height: number) {
  const b = new Uint8Array(30);
  b.set(new TextEncoder().encode("RIFF"), 0);
  b.set(new TextEncoder().encode("WEBPVP8X"), 8);
  const w = width - 1;
  const h = height - 1;
  b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return b;
}

describe("cover pictures", () => {
  it("reads the size from PNG, JPEG and WebP headers, whatever the server said the type was", () => {
    expect(imageSize(bookPng(120, 180, [10, 20, 30]))).toEqual({ type: "image/png", width: 120, height: 180 });
    expect(imageSize(jpegHead(333, 500))).toEqual({ type: "image/jpeg", width: 333, height: 500 });
    expect(imageSize(webpHead(400, 600))).toEqual({ type: "image/webp", width: 400, height: 600 });
    expect(imageSize(new TextEncoder().encode("<html>Not found</html>"))).toBeNull();
  });

  it("keeps a book-shaped picture and says why it refuses the others", () => {
    const ok = checkCover(jpegHead(333, 500));
    expect(ok).toMatchObject({ contentType: "image/jpeg", ext: "jpg", width: 333, height: 500 });
    expect(checkCover(bookPng(1, 1, [0, 0, 0]))).toEqual({ refused: "too small (1 × 1)" });
    expect(checkCover(bookPng(400, 120, [0, 0, 0]))).toEqual({ refused: "not the shape of a cover (400 × 120)" });
    expect(checkCover(new TextEncoder().encode("<html></html>"))).toEqual({ refused: "not a JPEG, PNG or WebP picture" });
    expect(checkCover(new Uint8Array(MAX_COVER_BYTES + 1))).toEqual({ refused: "larger than 3 MB" });
  });
});
