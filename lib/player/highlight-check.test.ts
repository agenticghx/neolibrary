import { describe, expect, it } from "vitest";
import { checkHighlight, type Said } from "./highlight-check";

// Four words of the fake voice (30 ms a character): "It was a dreary".
const said: Said[] = [
  { word: "It", startMs: 0, endMs: 90 },
  { word: "was", startMs: 90, endMs: 210 },
  { word: "a", startMs: 210, endMs: 270 },
  { word: "dreary", startMs: 270, endMs: 470 },
];
const everyFrame = Array.from({ length: 29 }, (_, i) => i * 16.7);
const lit = (...words: [string, number][]) => words.map(([word, atMs]) => ({ word, atMs }));

describe("checkHighlight (the read-aloud tests' rule, Samuel's choice (b))", () => {
  it("passes every word lit in order and on time", () => {
    expect(checkHighlight(said, lit(["It", 2], ["was", 100], ["a", 217], ["dreary", 284]), everyFrame)).toEqual({ ok: true, lit: 4, skipped: [] });
  });

  it("accepts a word missing only when the page never redrew while it was said", () => {
    // A busy machine: no redraw between 200 and 280 ms, so "a" (210-270 ms) could not be lit.
    const stalled = everyFrame.filter((t) => t < 200 || t > 280);
    const r = checkHighlight(said, lit(["It", 2], ["was", 100], ["dreary", 284]), stalled);
    expect(r).toEqual({ ok: true, lit: 3, skipped: [{ word: "a", startMs: 210, endMs: 270 }] });
  });

  it("still fails a missing word when the page redrew while it was said (a real skip)", () => {
    const r = checkHighlight(said, lit(["It", 2], ["was", 100], ["dreary", 284]), everyFrame);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/"a" \(210-270 ms\) was not lit, though the page redrew/);
  });

  it("a redraw only at the very edge of a word (within the margin) does not count", () => {
    // Redraws at 207 and 268 ms: inside "a" by under 5 ms at each end, so the clocks may disagree there.
    const edges = [...everyFrame.filter((t) => t < 200 || t > 280), 207, 268];
    expect(checkHighlight(said, lit(["It", 2], ["was", 100], ["dreary", 284]), edges).ok).toBe(true);
  });

  it("fails a word lit late, early, out of order, or not said", () => {
    expect(checkHighlight(said, lit(["It", 2], ["was", 195], ["a", 217], ["dreary", 284]), everyFrame)).toMatchObject({ ok: false, reason: expect.stringMatching(/"was" was lit 105 ms after/) });
    expect(checkHighlight(said, lit(["It", 2], ["was", 80], ["a", 217], ["dreary", 284]), everyFrame)).toMatchObject({ ok: false, reason: expect.stringMatching(/"was" was lit 10 ms before/) });
    expect(checkHighlight(said, lit(["It", 2], ["a", 217], ["was", 220], ["dreary", 284]), everyFrame).ok).toBe(false);
    expect(checkHighlight(said, lit(["It", 2], ["was", 100], ["a", 217], ["dreary", 284], ["night", 480]), everyFrame)).toMatchObject({
      ok: false,
      reason: 'lit but not said next: "night"',
    });
  });
});
