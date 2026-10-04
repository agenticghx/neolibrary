import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb, parseColorTokens } from "./contrast";

describe("contrast helpers", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(hexToRgb("#abc")).toEqual([170, 187, 204]);
  });

  it("parses colour tokens", () => {
    expect(parseColorTokens("--paper: #F3EDE1; --space-1: 0.25rem;")).toEqual({ paper: "#f3ede1" });
  });
});
