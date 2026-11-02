/**
 * The file names inside a .zip, read in the browser from the zip's own table of contents (its "central directory",
 * at the end of the file), without reading the rest (M41 R2). The Import page sends a .zip only when it holds a
 * Markdown file (a paper and its pictures); an audiobook's package, often hundreds of MB, is never uploaded there.
 */

/** What a .zip without a Markdown file is told (M41 R2): what a .zip can be here, and where an audiobook goes. */
export const ZIP_NOT_A_BOOK =
  "A .zip is added as a book only when it holds a Markdown (.md) file and its pictures. If it is your own audiobook, choose its book under “Add your audiobook to a book”, then choose the .zip there.";

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/** The names in a zip, or null when the file is not a zip this can read. */
export async function zipNames(file: Blob): Promise<string[] | null> {
  // The end record is 22 bytes plus a comment of at most 65,535.
  const tailStart = Math.max(0, file.size - (22 + 65_535));
  const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = u16(tail, end + 10);
  const dirSize = u32(tail, end + 12);
  const dirAt = u32(tail, end + 16);
  if (dirAt + dirSize > file.size || dirSize > 16 * 1024 * 1024) return null;
  const dir = new Uint8Array(await file.slice(dirAt, dirAt + dirSize).arrayBuffer());
  const names: string[] = [];
  let at = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > dir.length || u32(dir, at) !== 0x02014b50) return null;
    const nameLength = u16(dir, at + 28);
    names.push(new TextDecoder().decode(dir.subarray(at + 46, at + 46 + nameLength)));
    at += 46 + nameLength + u16(dir, at + 30) + u16(dir, at + 32);
  }
  return names;
}

/** The Markdown files in a zip's names, leaving out the copies macOS adds (`__MACOSX/`, `._name`) and hidden files. */
export function markdownIn(names: string[]): string[] {
  return names.filter((p) => /\.(md|markdown)$/i.test(p) && !p.startsWith("__MACOSX/") && !p.split("/").some((part) => part.startsWith(".")));
}
