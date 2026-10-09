import { describe, expect, it } from "vitest";
import { SPINE_H, SPINE_W, measureSpine, spinePoint } from "./spine";

describe("the Spine fold", () => {
  it("lifts only a narrow strip, and mirrors the turned side", () => {
    const mid = measureSpine(0.5);
    // A tube of radius 0.34 rolls the turned half up to about 0.68 and lifts that whole half.
    // Those numbers fail the two bounds below, and a tube is not a mirror across the fold.
    expect(mid.maxZ).toBeLessThan(0.25);
    expect(mid.highCreaseFraction).toBeGreaterThan(0);
    expect(mid.highCreaseFraction).toBeLessThan(0.2);
    expect(mid.mirrors).toBe(true);
  });

  it("starts flat and is still a mirror halfway through", () => {
    const start = measureSpine(0);
    expect(start.maxZ).toBe(0);
    expect(start.highCreaseFraction).toBe(0);
    expect(start.mirrors).toBe(true);
    expect(measureSpine(0.5).mirrors).toBe(true);
  });

  it("lands the outer edge across the gutter when the turn finishes", () => {
    const end = spinePoint(SPINE_W, SPINE_H / 2, 1);
    expect(end.back).toBe(true);
    expect(end.x).toBeCloseTo(-SPINE_W);
    expect(end.z).toBeLessThan(0.25);
  });
});
