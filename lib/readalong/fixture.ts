import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { wav } from "@/lib/speech/fake";
import { FORMAT, type Manifest, type WordTiming } from "./package";

/**
 * A small read-along package built in code, for tests (M13): never a real
 * audiobook. Each chapter is its own WAV of a quiet tone, and every word is
 * timed evenly at SECONDS_PER_CHAR per character from the start of the
 * chapter, so a test can say exactly when each word should light up.
 */
export const SECONDS_PER_CHAR = 0.03;

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export type FixtureChapter = {
  title: string;
  /** Paragraphs as read aloud; a spoken heading may come first. */
  paragraphs: string[];
  /** Words (by index in the chapter) the narrator skipped. */
  notSpoken?: number[];
  /** Where each paragraph is in the book (index into the book's paragraphs), or null if not in the book. */
  inBook?: (number | null)[];
};

export function buildPackage(opts: { bookBytes: Uint8Array; chapters: FixtureChapter[]; title?: string }) {
  const files: Record<string, Uint8Array> = {};
  const manifestChapters: Manifest["chapters"] = [];
  const audio: Manifest["audio"] = [];
  const paragraphs: unknown[] = [];
  opts.chapters.forEach((c, k) => {
    const n = k + 1;
    const id = String(n).padStart(2, "0");
    const text = c.paragraphs.join("\n\n") + "\n";
    const skip = new Set(c.notSpoken ?? []);
    let clock = 0;
    const words: WordTiming[] = [...text.matchAll(/\S+/g)].map((m, i) => {
      if (skip.has(i)) return { w: m[0], from: m.index!, to: m.index! + m[0].length, start: null, end: null, score: null, source: "not_spoken" };
      const start = r3(clock);
      const end = r3(clock + m[0].length * SECONDS_PER_CHAR);
      clock = end + SECONDS_PER_CHAR; // one character's pause between words
      return { w: m[0], from: m.index!, to: m.index! + m[0].length, start, end, score: -0.01, source: "aligned" };
    });
    const seconds = r3(clock + 0.2);
    const sound = wav(seconds);
    files[`audio/${id}.wav`] = sound;
    audio.push({ file: `audio/${id}.wav`, sha256: sha256(sound), seconds });
    files[`scripts/${id}.txt`] = strToU8(text);
    files[`timings/${id}.json`] = strToU8(JSON.stringify({ words }));
    manifestChapters.push({ n, title: c.title, audio: `audio/${id}.wav`, start: 0, end: seconds, script: `scripts/${id}.txt`, timings: `timings/${id}.json`, check: null });
    let at = 0;
    c.paragraphs.forEach((p, i) => {
      const place = c.inBook?.[i];
      paragraphs.push({ script: `${id}.txt`, paragraph: i, from: at, found: place !== null && place !== undefined, page: null, chapter: place ?? null, quote: place === null || place === undefined ? null : p.slice(0, 80) });
      at += p.length + 2;
    });
  });
  const manifest: Manifest = {
    format: FORMAT,
    title: opts.title ?? "Test book",
    author: null,
    book: { file: "book.epub", sha256: sha256(opts.bookBytes) },
    audio,
    voice: "test tone",
    made_with: "lib/readalong/fixture.ts",
    chapters: manifestChapters,
    book_map: "book-map.json",
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 1));
  files["book-map.json"] = strToU8(JSON.stringify({ book: "book.epub", paragraphs }));
  return { files, zip: () => zipSync(files) };
}
