import { describe, expect, it } from "vitest";
import { titleSize } from "./Cover";

describe("cover title size", () => {
  it("shrinks titles with long words", () => {
    expect(titleSize("Chip War")).toBe("normal");
    expect(titleSize("Engineering")).toBe("long");
    expect(titleSize("Power System Economics")).toBe("normal");
    expect(titleSize("Electrification of everything")).toBe("veryLong");
    expect(titleSize("Internationalisation")).toBe("veryLong");
  });
});
