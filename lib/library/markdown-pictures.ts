/**
 * Pictures in a Markdown book (M41 R2): a paper's figures, uploaded with its `.md` in one `.zip`.
 *
 * Rules:
 * - A picture comes only from inside the upload. An address (`https://…`, `data:…`), a path from the root (`/x.png`)
 *   or one that climbs out of the zip (`../x.png`) is never followed; the picture keeps its description, as before.
 * - Only PNG, JPEG, GIF and WebP, known by their first bytes, not their names. No SVG: an SVG file can carry code.
 * - Each picture is stored once in the book, however often the text shows it.
 */

export type Picture = { href: string; mediaType: string; bytes: Uint8Array };

const KINDS: { ext: string; mediaType: string; test: (b: Uint8Array) => boolean }[] = [
  { ext: "png", mediaType: "image/png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: "jpg", mediaType: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", mediaType: "image/gif", test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  {
    ext: "webp",
    mediaType: "image/webp",
    test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

/** The picture kind of these bytes, or null when they are not a PNG, JPEG, GIF or WebP. */
export function pictureKind(bytes: Uint8Array) {
  return KINDS.find((k) => bytes.length >= 12 && k.test(bytes)) ?? null;
}

/** A path in the zip from a picture's address in the text, relative to the Markdown file's folder; null if outside. */
export function zipPath(src: string, baseDir: string): string | null {
  let s = src.trim();
  if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("/") || s.startsWith("\\")) return null;
  try {
    s = decodeURIComponent(s);
  } catch {
    return null;
  }
  s = s.replace(/[?#].*$/, "");
  const parts: string[] = baseDir ? baseDir.split("/").filter(Boolean) : [];
  for (const part of s.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? parts.join("/") : null;
}

/** The pictures a Markdown book can show: the files that came with it, and the ones its text names but lacks. */
export class Pictures {
  private readonly byPath = new Map<string, Picture>();
  readonly used: Picture[] = [];
  readonly missing: string[] = [];

  constructor(
    private readonly files: Record<string, Uint8Array> = {},
    private readonly baseDir = "",
  ) {}

  /** The book's address for the picture at `src`, or null (and `src` noted as missing) when there is none. */
  resolve(src: string): Picture | null {
    const path = zipPath(src, this.baseDir);
    const bytes = path ? this.files[path] : undefined;
    const kind = bytes ? pictureKind(bytes) : null;
    if (!path || !bytes || !kind) {
      if (!this.missing.includes(src)) this.missing.push(src);
      return null;
    }
    let pic = this.byPath.get(path);
    if (!pic) {
      pic = { href: `images/p${this.used.length + 1}.${kind.ext}`, mediaType: kind.mediaType, bytes };
      this.byPath.set(path, pic);
      this.used.push(pic);
    }
    return pic;
  }
}
