import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clampSide, KEY_STEP, MIN_COLUMN, readSideWidth, SIDE_WIDTH_KEY, sideForKey, subscribeSideWidth, writeSideWidth } from "./side-width";

/** Stand-ins for the browser's storage and window (this test runs in Node). */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

describe("the rewrite's width beside the page", () => {
  it("keeps both the book and the rewrite at least 20rem wide", () => {
    expect(MIN_COLUMN).toBe(320);
    expect(clampSide(500, 1000)).toBe(500);
    expect(clampSide(100, 1000)).toBe(MIN_COLUMN); // the rewrite would be too narrow
    expect(clampSide(900, 1000)).toBe(1000 - MIN_COLUMN); // the book would be too narrow
    // Too little room for both: the rewrite keeps its minimum, as the CSS track does.
    expect(clampSide(500, 600)).toBe(MIN_COLUMN);
  });

  it("moves with the arrow keys and goes to either limit with Home and End", () => {
    expect(sideForKey("ArrowLeft", 500, 1000)).toBe(500 + KEY_STEP); // the line moves left: a wider rewrite
    expect(sideForKey("ArrowRight", 500, 1000)).toBe(500 - KEY_STEP);
    expect(sideForKey("ArrowLeft", 680, 1000)).toBe(680); // already at the limit
    expect(sideForKey("Home", 500, 1000)).toBe(680);
    expect(sideForKey("End", 500, 1000)).toBe(MIN_COLUMN);
    expect(sideForKey("Enter", 500, 1000)).toBeNull();
  });

  describe("kept on this device", () => {
    let events: EventTarget;
    beforeEach(() => {
      events = new EventTarget();
      (globalThis as unknown as { window: EventTarget }).window = events;
    });
    afterEach(() => {
      delete (globalThis as { localStorage?: Storage }).localStorage;
      delete (globalThis as { window?: unknown }).window;
      writeSideWidthQuietly(null);
    });
    /** Puts the module back to "nothing kept" between tests, with storage working. */
    function writeSideWidthQuietly(v: number | null) {
      (globalThis as unknown as { window: EventTarget }).window = new EventTarget();
      globalThis.localStorage = memoryStorage();
      writeSideWidth(v);
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }

    it("is none until the line is dragged, then the share, rounded, until put back", () => {
      globalThis.localStorage = memoryStorage();
      expect(readSideWidth()).toBeNull();
      let told = 0;
      const stop = subscribeSideWidth(() => told++);
      writeSideWidth(37.26);
      expect(localStorage.getItem(SIDE_WIDTH_KEY)).toBe("37.3");
      expect(readSideWidth()).toBe(37.3);
      writeSideWidth(null);
      expect(readSideWidth()).toBeNull();
      expect(told).toBe(2);
      stop();
      writeSideWidth(40);
      expect(told).toBe(2);
    });

    it("ignores a kept value that makes no sense", () => {
      globalThis.localStorage = memoryStorage();
      for (const bad of ["abc", "0", "99", "-5"]) {
        localStorage.setItem(SIDE_WIDTH_KEY, bad);
        expect(readSideWidth(), bad).toBeNull();
      }
    });

    it("lasts until the page is left where storage is blocked", () => {
      const blocked = memoryStorage();
      blocked.setItem = () => {
        throw new Error("blocked");
      };
      globalThis.localStorage = blocked;
      writeSideWidth(30);
      expect(readSideWidth()).toBe(30);
    });
  });
});
