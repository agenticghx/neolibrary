import { describe, expect, it } from "vitest";
import type { PlayerParagraph } from "@/lib/readalong/player";
import { playsOnAt, skipInBook, skipInClip } from "./skip";

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
