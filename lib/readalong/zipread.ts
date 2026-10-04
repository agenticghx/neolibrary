import { inflateRawSync } from "node:zlib";

/**
 * Unpacking an uploaded zip without letting it take the server down (M13
 * c3). A "zip bomb" is a small zip that unpacks to gigabytes, or that makes
 * the server decompress the same data again and again. So, before any
 * unpacking, from the zip's own table of contents (its "central
 * directory"):
 *   - at most `maxEntries` entries, and their declared sizes add up to at
 *     most `maxUnpacked` bytes;
 *   - every entry's data lies inside the file, and no two entries share data;
 *   - only plain stored or deflated entries; no encryption, no zip64.
 * Then each deflated entry is unpacked by Node's zlib with a hard cap at its
 * declared size, so an entry that would unpack to more stops at once
 * (fflate keeps decompressing past its buffer, costing minutes of CPU).
 */
export class ZipError extends Error {}

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

export function safeUnzip(zip: Uint8Array, limits: { maxUnpacked: number; maxEntries: number }): Record<string, Uint8Array> {
  const bad = (why: string) => new ZipError(why);
  // The end-of-central-directory record: the last 22 bytes, or up to 64 KB earlier if the zip has a comment.
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (u32(zip, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw bad("not a zip");
  const count = u16(zip, end + 10);
  const dirSize = u32(zip, end + 12);
  const dirAt = u32(zip, end + 16);
  if (count === 0xffff || dirSize === 0xffffffff || dirAt === 0xffffffff) throw bad("zip64 is not supported");
  if (count > limits.maxEntries) throw bad("too many entries");
  if (dirAt + dirSize > end) throw bad("broken directory");

  type Entry = { name: string; method: number; packed: number; unpacked: number; dataAt: number };
  const entries: Entry[] = [];
  let declared = 0;
  for (let i = 0, at = dirAt; i < count; i++) {
    if (at + 46 > end || u32(zip, at) !== 0x02014b50) throw bad("broken directory");
    const flags = u16(zip, at + 8);
    const method = u16(zip, at + 10);
    const packed = u32(zip, at + 20);
    const unpacked = u32(zip, at + 24);
    const nameLength = u16(zip, at + 28);
    const next = at + 46 + nameLength + u16(zip, at + 30) + u16(zip, at + 32);
    const local = u32(zip, at + 42);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    at = next;
    if (flags & 1) throw bad("encrypted entries are not supported");
    if (method !== 0 && method !== 8) throw bad("unsupported compression");
    if (method === 0 && packed !== unpacked) throw bad("stored entry sizes disagree");
    if (local + 30 > dirAt || u32(zip, local) !== 0x04034b50) throw bad("broken entry");
    const dataAt = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
    if (dataAt + packed > dirAt) throw bad("entry runs past the data");
    declared += unpacked;
    if (declared > limits.maxUnpacked) throw bad("too large");
    if (!name.endsWith("/")) entries.push({ name, method, packed, unpacked, dataAt });
  }
  // No two entries may share bytes (that is how one stream gets unpacked many times).
  const spans = entries.map((e) => [e.dataAt, e.dataAt + e.packed]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][1]) throw bad("entries overlap");

  const files: Record<string, Uint8Array> = {};
  for (const e of entries) {
    const data = zip.subarray(e.dataAt, e.dataAt + e.packed);
    if (e.method === 0) {
      files[e.name] = data.slice();
      continue;
    }
    let out: Buffer;
    try {
      // maxOutputLength must be at least 1; an empty file inflates to nothing.
      out = inflateRawSync(data, { maxOutputLength: Math.max(1, e.unpacked) });
    } catch {
      throw bad("an entry unpacks to more than it declares, or is damaged");
    }
    if (out.length !== e.unpacked) throw bad("an entry unpacks to a different size than it declares");
    files[e.name] = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  }
  return files;
}
