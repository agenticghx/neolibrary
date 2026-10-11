import { describe, expect, it } from "vitest";
import { dimPixels } from "./spine-fold";

// The by-hand copy of DIM_FILTER (invert(0.88) hue-rotate(180deg)), for a canvas that cannot draw through a filter.
describe("dimPixels", () => {
  it("turns white paper the grey of a dimmed page and black ink light grey, and leaves alpha alone", () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 128]);
    dimPixels(px);
    expect(Array.from(px)).toEqual([31, 31, 31, 255, 224, 224, 224, 128]);
  });

  it("keeps a grey grey and stays within 0 to 255 for strong colours", () => {
    const px = new Uint8ClampedArray([128, 128, 128, 255, 255, 0, 0, 255, 0, 0, 255, 255]);
    dimPixels(px);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    for (const v of px) expect(v).toBeGreaterThanOrEqual(0);
  });
});
