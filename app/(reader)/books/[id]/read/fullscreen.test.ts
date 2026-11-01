import { describe, expect, it } from "vitest";
import { FULL_EDGE_PX, wakesBars } from "./fullscreen";

const H = 800;
const move = (y: number, pointerType = "mouse") => ({ kind: "pointermove" as const, pointerType, y });

describe("full screen: what brings the bars back", () => {
  it("the mouse over the text does not; at the top or bottom edge it does", () => {
    expect(wakesBars(move(H / 2), H)).toBe(false);
    expect(wakesBars(move(FULL_EDGE_PX + 1), H)).toBe(false);
    expect(wakesBars(move(H - FULL_EDGE_PX - 1), H)).toBe(false);
    expect(wakesBars(move(4), H)).toBe(true);
    expect(wakesBars(move(H - 4), H)).toBe(true);
  });

  it("a mouse click on the text does not; a tap with a finger or pen does", () => {
    expect(wakesBars({ kind: "pointerdown", pointerType: "mouse", y: H / 2 }, H)).toBe(false);
    expect(wakesBars({ kind: "pointerdown", pointerType: "touch", y: H / 2 }, H)).toBe(true);
    expect(wakesBars({ kind: "pointerdown", pointerType: "pen", y: H / 2 }, H)).toBe(true);
    // A finger sliding over the page is a swipe, not a reach for the controls.
    expect(wakesBars(move(4, "touch"), H)).toBe(false);
  });

  it("turning pages with the keys does not; another key does", () => {
    for (const key of ["ArrowRight", "ArrowLeft", "PageDown", " ", "f", "Escape", "Shift"]) {
      expect(wakesBars({ kind: "keydown", key }, H)).toBe(false);
    }
    for (const key of ["Tab", "n", "?"]) expect(wakesBars({ kind: "keydown", key }, H)).toBe(true);
  });
});
