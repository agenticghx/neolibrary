import { createHash } from "node:crypto";
import { strFromU8 } from "fflate";
import { safeUnzip, ZipError } from "./zipread";

/**
 * Read-along packages (M13): an audiobook made outside the app, with the
 * scripts that were read aloud, word timings measured from the audio, and
 * where each paragraph is in the book. Made on the laptop by the
 * `readalong-audio` skill; format in `tools/readalong/package-format.md`.
 *
 * This reads a package and checks it the same way as the skill's
 * `tools/readalong/validate_package.py` (same rules, same verdicts; the test
 * runs both). The audio may arrive separately (it can be larger than a web
 * request should carry), so its checksum is checked only when given.
 */
export const FORMAT = "neolibrary-readalong/1";

export type WordTiming = {
  w: string;
  from: number;
  to: number;
  start: number | null;
  end: number | null;
  score: number | null;
  source: "aligned" | "not_spoken";
};

export type ManifestChapter = {
  n: number;
  title: string;
  audio: string;
  start: number;
  end: number;
  script: string;
  timings: string;
  check: string | null;
};

export type Manifest = {
  format: string;
  title?: string | null;
  author?: string | null;
  book: { file: string; sha256: string };
  audio: { file: string; sha256: string; seconds: number }[];
  voice?: string | null;
  made_with?: string | null;
  chapters: ManifestChapter[];
  book_map: string;
};

export type BookMapParagraph = {
  script: string;
  paragraph: number;
  from: number;
  found: boolean;
  page: number | null;
  chapter: number | null;
  quote: string | null;
};

export type Chapter = ManifestChapter & { text: string; words: WordTiming[] };

export type Package = { manifest: Manifest; chapters: Chapter[]; bookMap: BookMapParagraph[] };

export type Verdict = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** The checker's one-line summary when ok, as the Python checker prints it. */
  summary: string | null;
};

export class PackageError extends Error {}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/**
 * Limits on what a package zip may unpack to, checked from the zip's own
 * table of contents before anything is unpacked (lib/readalong/zipread.ts:
 * a crafted "zip bomb" can claim or produce gigabytes). A package's scripts
 * and timings are a few MB even for a long book; a .zip may hold the audio
 * too (up to the 50 MB the page sends in one request), so allow some more.
 */
export const MAX_UNPACKED_BYTES = 120 * 1024 * 1024;
export const MAX_ENTRIES = 5000;

/** Unzips a package. The zip may hold the files at its root or inside one folder. */
export function readPackageZip(zip: Uint8Array): Record<string, Uint8Array> {
  let files: Record<string, Uint8Array>;
  try {
    files = safeUnzip(zip, { maxUnpacked: MAX_UNPACKED_BYTES, maxEntries: MAX_ENTRIES });
  } catch (e) {
    if (e instanceof ZipError && e.message !== "not a zip" && e.message !== "broken directory") {
      throw new PackageError("This zip unpacks to more than a read-along package can hold, or uses a kind of zip that is not supported.");
    }
    throw new PackageError("This is not a zip file.");
  }
  const names = Object.keys(files).filter((n) => !n.endsWith("/"));
  const manifest = names.find((n) => n === "manifest.json" || /^[^/]+\/manifest\.json$/.test(n));
  if (!manifest) throw new PackageError("No manifest.json in this package.");
  const prefix = manifest.slice(0, -"manifest.json".length);
  return Object.fromEntries(names.filter((n) => n.startsWith(prefix)).map((n) => [n.slice(prefix.length), files[n]]));
}

function json<T>(files: Record<string, Uint8Array>, name: string): T {
  const f = files[name];
  if (!f) throw new PackageError(`missing ${name}`);
  try {
    return JSON.parse(strFromU8(f)) as T;
  } catch {
    throw new PackageError(`${name} is not valid JSON`);
  }
}

/** Parses the package's files (audio not needed). Throws PackageError when a file is missing or unreadable. */
export function parsePackage(files: Record<string, Uint8Array>): Package {
  const manifest = json<Manifest>(files, "manifest.json");
  if (!Array.isArray(manifest.chapters) || !Array.isArray(manifest.audio)) throw new PackageError("manifest.json has no chapters or audio list");
  const chapters = manifest.chapters.map((c) => {
    if (!files[c.script]) throw new PackageError(`missing ${c.script}`);
    return { ...c, text: strFromU8(files[c.script]), words: json<{ words: WordTiming[] }>(files, c.timings).words };
  });
  return { manifest, chapters, bookMap: json<{ paragraphs: BookMapParagraph[] }>(files, manifest.book_map).paragraphs };
}

/** Python's str() of a number from JSON, for messages that match the Python checker. */
const num = (x: number | null) => (x === null ? "None" : String(x));

/**
 * Checks a package. `audio` maps each audio file's package path to its
 * bytes, for the ones at hand; a listed file that is absent counts as
 * missing only when `requireAudio` is set.
 */
export function checkPackage(pkg: Package, opts: { audio?: Record<string, Uint8Array>; requireAudio?: boolean } = {}): Verdict {
  const errors: string[] = [];
  const warnings: string[] = [];
  const m = pkg.manifest;
  if (m.format !== FORMAT) errors.push(`format is ${m.format === undefined ? "None" : `'${m.format}'`}, expected '${FORMAT}'`);
  for (const a of m.audio) {
    const bytes = opts.audio?.[a.file];
    if (!bytes) {
      if (opts.requireAudio) errors.push(`missing ${a.file}`);
    } else if (sha256(bytes) !== a.sha256) errors.push(`${a.file} does not match its recorded sha256`);
  }
  let total = 0;
  let spoken = 0;
  let low = 0;
  for (const c of pkg.chapters) {
    const words = [...c.text.matchAll(/\S+/gu)];
    const t = c.words;
    if (t.length !== words.length) {
      errors.push(`chapter ${c.n}: ${t.length} timed words for ${words.length} script words`);
      continue;
    }
    // Offsets in the package count characters as Python does (code points,
    // not JavaScript's UTF-16 units), so map one to the other once.
    const points = [...c.text];
    const pointAt = new Map<number, number>();
    for (let p = 0, u = 0; p <= points.length; u += points[p]?.length ?? 0, p++) pointAt.set(u, p);
    let last = c.start;
    for (let i = 0; i < t.length; i++) {
      const w = t[i];
      const s = words[i];
      const from = pointAt.get(s.index!)!;
      const to = pointAt.get(s.index! + s[0].length)!;
      if (w.from !== from || w.to !== to || points.slice(w.from, w.to).join("") !== w.w) {
        errors.push(`chapter ${c.n} word ${i}: offsets do not point at '${w.w}'`);
        break;
      }
      if (w.source === "not_spoken") {
        if (w.start !== null) errors.push(`chapter ${c.n} word ${i}: marked not spoken but has a time`);
        continue;
      }
      if (w.start === null || w.end === null || !(c.start - 0.5 <= w.start && w.start <= w.end && w.end <= c.end + 0.5)) {
        errors.push(`chapter ${c.n} word ${i} '${w.w}': time ${num(w.start)}-${num(w.end)} outside the chapter (${num(c.start)}-${num(c.end)})`);
        break;
      }
      if (w.start < last - 0.05) {
        errors.push(`chapter ${c.n} word ${i} '${w.w}': starts before the previous word`);
        break;
      }
      last = w.start;
      spoken += 1;
      if ((w.score ?? 0) < -2) low += 1;
    }
    total += words.length;
  }
  const missing = pkg.bookMap.filter((p) => !p.found);
  if (low) warnings.push(`${low} low-confidence words (${((low / Math.max(spoken, 1)) * 100).toFixed(1)}%)`);
  if (missing.length) warnings.push(`${missing.length} of ${pkg.bookMap.length} paragraphs not found in the book (spoken headings are expected here)`);
  const ok = errors.length === 0;
  const n = (x: number) => x.toLocaleString("en-US");
  const summary = ok
    ? `Package OK: ${pkg.chapters.length} chapters, ${n(total)} words (${n(total - spoken)} not spoken)` + (warnings.length ? `; warnings: ${warnings.join("; ")}` : "")
    : null;
  return { ok, errors, warnings, summary };
}

/** True when the package belongs to this book file. */
export const isForBook = (pkg: Package, bookBytes: Uint8Array) => pkg.manifest.book.sha256 === sha256(bookBytes);
