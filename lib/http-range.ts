/**
 * HTTP byte ranges for stored files. Audio players ask for ranges to learn a
 * file's length and to seek; without them a browser may treat the audio as
 * an endless stream.
 */
/** A single "bytes=start-end" range (end inclusive), null for none, "invalid" if it cannot be served. */
export function byteRange(header: string | null, size: number): [number, number] | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    // "bytes=-500": the last 500 bytes.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return [start, end];
}

/**
 * The most one range request returns (bytes): M13 audiobooks can be hundreds
 * of MB. FILES_MAX_RANGE_BYTES sets it lower for the browser tests (64 KB,
 * playwright.config.ts), so that every test that plays audio runs past the
 * end of several answers and proves the browser asks for the rest in time.
 */
export const MAX_RANGE = Number(process.env.FILES_MAX_RANGE_BYTES) > 0 ? Math.floor(Number(process.env.FILES_MAX_RANGE_BYTES)) : 8 * 1024 * 1024;

/**
 * The bytes to send for a request: like byteRange, but never more than
 * MAX_RANGE bytes from the start of what was asked, so a long audiobook is
 * never read whole for one request. This applies to every form: open-ended
 * ("bytes=0-", how Chromium starts), closed ("bytes=0-21168043": Safari's
 * engine asks for the whole file this way) and suffix ("bytes=-500"). The
 * Content-Range header then says which bytes came, and players ask for the
 * rest as they play (checked in Chromium and WebKit, e2e/readalong.spec.ts).
 */
export function servedRange(header: string | null, size: number, max = MAX_RANGE): [number, number] | null | "invalid" {
  const r = byteRange(header, size);
  if (!r || r === "invalid") return r;
  return [r[0], Math.min(r[1], r[0] + max - 1)];
}
