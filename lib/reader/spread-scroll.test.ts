import { describe, expect, it } from "vitest";
import { spreadAlign, spreadCss, spreadPitch, spreadTurn } from "./spread-scroll";

const twoInScroll = { flow: "scrolled", pages: "two" };

describe("spreadPitch", () => {
  it("is the box's height in Scroll with Two pages, in a wide window, where columns can wrap", () => {
    expect(spreadPitch(twoInScroll, { width: 1280, height: 691 }, true)).toBe(691);
  });

  it("is 0 (one column) otherwise", () => {
    expect(spreadPitch(twoInScroll, { width: 1280, height: 691 }, false)).toBe(0); // Safari
    expect(spreadPitch({ flow: "paginated", pages: "two" }, { width: 1280, height: 691 }, true)).toBe(0);
    expect(spreadPitch({ flow: "scrolled", pages: "one" }, { width: 1280, height: 691 }, true)).toBe(0);
    expect(spreadPitch(twoInScroll, { width: 390, height: 700 }, true)).toBe(0); // a phone held upright
    expect(spreadPitch(twoInScroll, { width: 660, height: 500 }, true)).toBe(0); // too narrow
  });
});

describe("spreadTurn", () => {
  const pitch = 700;
  it("goes to the next spread's top, from a spread's top or from between two", () => {
    expect(spreadTurn(0, pitch, "next")).toBe(700);
    expect(spreadTurn(1400, pitch, "next")).toBe(700);
    expect(spreadTurn(1000, pitch, "next")).toBe(400);
    expect(spreadTurn(1399, pitch, "next")).toBe(701); // 1 px short of a spread counts as on it
  });

  it("goes back to the spread before, or to the top of the one half shown", () => {
    expect(spreadTurn(1400, pitch, "prev")).toBe(700);
    expect(spreadTurn(1000, pitch, "prev")).toBe(300);
    expect(spreadTurn(701, pitch, "prev")).toBe(701);
    expect(spreadTurn(0, pitch, "prev")).toBe(700); // past the top: foliate goes to the chapter before
  });
});

describe("spreadAlign", () => {
  it("lines the screen up on the spread holding a jump's target (shown 40 px down)", () => {
    expect(spreadAlign(1100 - 40, 700)).toBe(700 - 1060); // target at 1100, in the second spread
    expect(spreadAlign(1400 - 40, 700)).toBe(40); // target at a spread's very top
    expect(spreadAlign(1400, 700)).toBe(0); // already lined up
  });
});

describe("spreadCss", () => {
  it("makes columns one screen tall less the gap, and keeps pictures inside them", () => {
    const css = spreadCss(700);
    expect(css).toContain("column-height: 620px");
    expect(css).toContain("row-gap: 80px");
    expect(css).toContain("max-height: 620px");
  });
});
