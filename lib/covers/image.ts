/**
 * Checks a downloaded cover before it is stored (M22): a JPEG, PNG or WebP of a
 * sensible size and shape. A catalogue sometimes answers with a 1-pixel or
 * blank placeholder, a banner, or a page that is not a picture at all.
 */

export const MAX_COVER_BYTES = 3 * 1024 * 1024;
const MIN_WIDTH = 60;
const MIN_HEIGHT = 90;

export type CoverImage = { data: Uint8Array; contentType: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp"; width: number; height: number };

/** Width and height from a JPEG (its first frame header), PNG (IHDR) or WebP (VP8, VP8L, VP8X) header; null if unreadable. */
export function imageSize(b: Uint8Array): { type: CoverImage["contentType"]; width: number; height: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u32 = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const le16 = (i: number) => b[i] | (b[i + 1] << 8);
  const le24 = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { type: "image/png", width: u32(16), height: u32(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      if (b[i + 1] === 0xff) {
        i += 1; // fill byte
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      // Start of frame (baseline, progressive, …), not DHT (c4), JPG (c8) or DAC (cc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: "image/jpeg", height: u16(i + 5), width: u16(i + 7) };
      }
      i += 2 + u16(i + 2);
    }
    return null;
  }
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const kind = ascii(12, 4);
    if (kind === "VP8 ") return { type: "image/webp", width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    if (kind === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { type: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X") return { type: "image/webp", width: le24(24) + 1, height: le24(27) + 1 };
  }
  return null;
}

/**
 * The picture, if it can be a book cover: a known image type (read from its bytes, not from what the server
 * said), at most 3 MB, at least 60 × 90 pixels, and roughly the shape of a book (between a square and a
 * thin paperback). Otherwise the reason it was refused.
 */
export function checkCover(data: Uint8Array): CoverImage | { refused: string } {
  if (data.byteLength > MAX_COVER_BYTES) return { refused: "larger than 3 MB" };
  const size = imageSize(data);
  if (!size) return { refused: "not a JPEG, PNG or WebP picture" };
  if (size.width < MIN_WIDTH || size.height < MIN_HEIGHT) return { refused: `too small (${size.width} × ${size.height})` };
  const shape = size.height / size.width;
  if (shape < 0.9 || shape > 2.4) return { refused: `not the shape of a cover (${size.width} × ${size.height})` };
  const ext = size.type === "image/png" ? "png" : size.type === "image/webp" ? "webp" : "jpg";
  return { data, contentType: size.type, ext, width: size.width, height: size.height };
}
