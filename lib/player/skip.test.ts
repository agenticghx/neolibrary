import { describe, expect, it } from "vitest";
import type { PlayerParagraph } from "@/lib/readalong/player";
import { playsOnAt, skipAcross, skipInBook, skipInClip } from "./skip";

// File 0: A 0-10 s, B 20-30 s (a 10 s untimed stretch before it, which playing jumps: from 10.85 s to 20 s),
// C 31-40 s (a 1 s pause, which plays); the file is 45 s long.
const words = (from: number, to: number): [number, number, number, number][] => [[from, to, 0, 4]];
const ps: PlayerParagraph[] = [
  { file: 0, startMs: 0, endMs: 10_000, words: words(0, 10_000) },
  { file: 0, startMs: 20_000, endMs: 30_000, words: words(20_000, 30_000) },
  { file: 0, startMs: 31_000, endMs: 40_000, words: words(31_000, 40_000) },
];
const END = 45_000;

describe("skipInBook", () => {
  it("moves 15 s within what plays", () => {
    expect(skipInBook(ps, 0, 35_000, -15_000, END)).toBe(20_000);
    expect(skipInBook(ps, 0, 22_000, 15_000, END)).toBe(37_000);
  });

  it("does not count a stretch that playing jumps, nor land in it", () => {
    // Back from B at 25 s: 5 s of B, then the jump (not counted), then 10 s of A: 0.85 s.
    expect(skipInBook(ps, 0, 25_000, -15_000, END)).toBe(850);
    // Forward from A at 5 s: 5.85 s of A up to the jump, then 9.15 s of B: 29.15 s.
    expect(skipInBook(ps, 0, 5_000, 15_000, END)).toBe(29_150);
  });

  it("from inside a jumped stretch, counts from its edge", () => {
    expect(skipInBook(ps, 0, 15_000, -5_000, END)).toBe(5_850);
    expect(skipInBook(ps, 0, 15_000, 5_000, END)).toBe(25_000);
  });

  it("stops at the file's start, and just before its end (which reads on)", () => {
    expect(skipInBook(ps, 0, 9_000, -15_000, END)).toBe(0);
    expect(skipInBook(ps, 0, 40_000, 15_000, END)).toBe(END - 50);
  });

  it("plays on wherever it lands: never in a stretch that playing would jump", () => {
    for (let t = 0; t <= END; t += 250) {
      for (const d of [-15_000, -5_000, 5_000, 15_000]) {
        const at = skipInBook(ps, 0, t, d, END);
        expect(at, `from ${t} by ${d}`).toBeGreaterThanOrEqual(0);
        expect(at, `from ${t} by ${d}`).toBeLessThanOrEqual(END);
        expect(playsOnAt(ps, 0, 0, at), `from ${t} by ${d} to ${at}`).toBe(true);
      }
    }
  });

  it("ignores other files' paragraphs", () => {
    const two: PlayerParagraph[] = [...ps, { file: 1, startMs: 0, endMs: 5_000, words: words(0, 5_000) }];
    expect(skipInBook(two, 0, 35_000, -15_000, END)).toBe(20_000);
    expect(skipInBook(two, 1, 2_000, -15_000, 5_000)).toBe(0);
  });
});

describe("skipInClip", () => {
  const both = { prev: true, next: true };
  it("moves within the clip", () => {
    expect(skipInClip(20_000, -15_000, 40_000, both)).toEqual({ kind: "seek", toMs: 5_000 });
    expect(skipInClip(20_000, 15_000, 40_000, both)).toEqual({ kind: "seek", toMs: 35_000 });
  });
  it("goes to the paragraph before, as far from its end as the skip went past this start", () => {
    expect(skipInClip(4_000, -15_000, 40_000, both)).toEqual({ kind: "previous", fromEndMs: 11_000 });
  });
  it("goes on to the paragraph after", () => {
    expect(skipInClip(30_000, 15_000, 40_000, both)).toEqual({ kind: "next" });
  });
  it("stops at 0 with nothing before, and at the end with nothing after", () => {
    expect(skipInClip(4_000, -15_000, 40_000, { prev: false, next: true })).toEqual({ kind: "seek", toMs: 0 });
    expect(skipInClip(30_000, 15_000, 40_000, { prev: true, next: false })).toEqual({ kind: "seek", toMs: 39_950 });
  });
});

describe("skipAcross (M14 step 6b, part 2b)", () => {
  // File 0 as above (45 s long); file 1: D 2-12 s (so playing starts it at 0), E 13-25 s.
  const two: PlayerParagraph[] = [...ps, { file: 1, startMs: 2_000, endMs: 12_000, words: words(2_000, 12_000) }, { file: 1, startMs: 13_000, endMs: 25_000, words: words(13_000, 25_000) }];

  it("moves within the file as skipInBook does", () => {
    expect(skipAcross(two, 1, 0, 22_000, 15_000, END)).toEqual({ kind: "seek", toMs: 37_000 });
    expect(skipAcross(two, 4, 1, 20_000, -15_000, 30_000)).toEqual({ kind: "seek", toMs: 5_000 });
  });

  it("goes on into the next file with what is left over, from where playing starts it", () => {
    // From 38 s: 7 s to the file's end (45 s, before the 6 s after C's end), then 8 s of file 1.
    expect(skipAcross(two, 2, 0, 38_000, 15_000, END)).toEqual({ kind: "load", index: 3, toMs: 8_000 });
    // A longer file is left 6 s after its last paragraph (46 s), as playing leaves it.
    expect(skipAcross(two, 2, 0, 38_000, 15_000, 60_000)).toEqual({ kind: "load", index: 3, toMs: 7_000 });
  });

  it("goes back into the file before, from its last word's end, with what is left over", () => {
    // From 6 s into file 1: 6 s of it, then 9 s back from C's end (40.25 s).
    expect(skipAcross(two, 3, 1, 6_000, -15_000, 30_000)).toEqual({ kind: "load", index: 2, toMs: 31_250 });
    // Further back, the stretch playing jumps over in file 0 does not count.
    expect(skipAcross(two, 3, 1, 2_000, -25_000, 30_000)).toEqual({ kind: "load", index: 0, toMs: 8_100 });
  });

  it("goes only into files whose paragraphs are loaded", () => {
    // No file after: forward stops just before this file's end, which reads on.
    expect(skipAcross(ps, 2, 0, 38_000, 15_000, END)).toEqual({ kind: "seek", toMs: END - 50 });
    // The reading began in file 1: back stops at its start.
    expect(skipAcross(two.slice(3), 0, 1, 6_000, -15_000, 30_000)).toEqual({ kind: "seek", toMs: 0 });
  });

  it("lands where playing plays on", () => {
    for (const [file, len] of [[0, END], [1, 30_000]] as const) {
      for (let t = 0; t <= len; t += 500) {
        for (const d of [-15_000, 15_000]) {
          const index = two.findIndex((p) => p.file === file);
          const s = skipAcross(two, index, file, t, d, len);
          const f = s.kind === "seek" ? file : two[s.index].file;
          expect(playsOnAt(two, s.kind === "seek" ? index : s.index, f, s.toMs), `${file}@${t}${d > 0 ? "+" : ""}${d}`).toBe(true);
        }
      }
    }
  });
});
