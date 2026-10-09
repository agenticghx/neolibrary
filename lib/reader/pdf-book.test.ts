import { describe, expect, it } from "vitest";
import { spreadForPages } from "./pdf-book";

describe("how many PDF pages face the reader", () => {
  it("centres one page unless two pages was chosen", () => {
    expect(spreadForPages("one")).toBe("none");
    // Not "both" or "portrait": those would keep two pages when the window is taller than it is wide.
    expect(spreadForPages("two")).toBe("landscape");
  });
});
