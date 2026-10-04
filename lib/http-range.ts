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

/** The most one open-ended range request returns (bytes): M13 audiobooks can be hundreds of MB. */
export const MAX_OPEN_RANGE = 8 * 1024 * 1024;

/**
 * The bytes to send for a request: like byteRange, but an open-ended request
 * ("bytes=0-", how audio players start) gets at most MAX_OPEN_RANGE bytes, so
 * a long audiobook is never read whole for one request. Players then ask for
 * the next part as they play.
 */
export function servedRange(header: string | null, size: number, max = MAX_OPEN_RANGE): [number, number] | null | "invalid" {
  const r = byteRange(header, size);
  if (!r || r === "invalid") return r;
  const openEnded = /^bytes=\d+-$/.test((header ?? "").trim());
  return openEnded ? [r[0], Math.min(r[1], r[0] + max - 1)] : r;
}
