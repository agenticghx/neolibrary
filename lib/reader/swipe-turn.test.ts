import { describe, expect, it } from "vitest";
import { sideways, swipeDirection, wheelTurner, type Turn } from "./swipe-turn";

const wheel = (deltaX: number, deltaY = 0, extra: { deltaMode?: number; shiftKey?: boolean } = {}) => ({
  deltaX,
  deltaY,
  deltaMode: extra.deltaMode ?? 0,
  shiftKey: extra.shiftKey ?? false,
});

/** A turner on a clock the test moves, and the turns it made. */
function setup() {
  let clock = 0;
  const turns: Turn[] = [];
  const onWheel = wheelTurner((d) => turns.push(d), () => clock);
  /** A trackpad swipe: `n` events `every` ms apart, each `dx` sideways. */
  const swipe = (dx: number, n = 30, every = 16, dy = 0) => {
    const used: boolean[] = [];
    for (let i = 0; i < n; i++) {
      used.push(onWheel(wheel(dx, dy)));
      clock += every;
    }
    return used;
  };
  const pause = (ms: number) => (clock += ms);
  return { onWheel, swipe, pause, turns };
}

describe("wheelTurner", () => {
  it("turns one page for one swipe, however long it coasts", () => {
    const { swipe, turns } = setup();
    swipe(8, 60);
    expect(turns).toEqual(["next"]);
  });

  it("turns again after a pause, and backwards for a swipe the other way", () => {
    const { swipe, pause, turns } = setup();
    swipe(8);
    pause(400);
    swipe(8);
    pause(400);
    swipe(-8);
    expect(turns).toEqual(["next", "next", "prev"]);
  });

  it("does not turn for a short nudge", () => {
    const { swipe, turns } = setup();
    swipe(4, 5);
    expect(turns).toEqual([]);
  });

  it("leaves scrolling up and down alone, even when it drifts sideways", () => {
    const { swipe, turns } = setup();
    const used = swipe(5, 60, 16, 20);
    expect(turns).toEqual([]);
    expect(used.every((u) => !u)).toBe(true);
  });

  it("uses (cancels) every sideways event of a swipe, so the browser does not go back a page", () => {
    const { swipe } = setup();
    expect(swipe(8, 20).every(Boolean)).toBe(true);
  });

  it("leaves the whole swipe to a box that scrolls sideways on its own", () => {
    let clock = 0;
    const turns: Turn[] = [];
    const onWheel = wheelTurner((d) => turns.push(d), () => clock);
    let tableHasRoom = true;
    const used: boolean[] = [];
    for (let i = 0; i < 40; i++) {
      if (i === 10) tableHasRoom = false; // the table reaches its end while the swipe coasts on
      used.push(onWheel(wheel(8), () => tableHasRoom));
      clock += 16;
    }
    expect(turns).toEqual([]);
    expect(used.every((u) => !u)).toBe(true);
  });
});

describe("sideways", () => {
  it("reads Shift with a mouse wheel as sideways, and lines as pixels", () => {
    expect(sideways(wheel(0, 100, { shiftKey: true }))).toBe(100);
    expect(sideways(wheel(3, 0, { deltaMode: 1 }))).toBe(48);
    expect(sideways(wheel(10, 10))).toBe(0);
  });
});

describe("swipeDirection", () => {
  it("a finger moving left is the next page, right the previous", () => {
    expect(swipeDirection({ x: 300, y: 200, t: 0 }, { x: 150, y: 210, t: 200 })).toBe("next");
    expect(swipeDirection({ x: 100, y: 200, t: 0 }, { x: 250, y: 190, t: 200 })).toBe("prev");
  });

  it("ignores a scroll down, a short move and a slow drag", () => {
    expect(swipeDirection({ x: 200, y: 400, t: 0 }, { x: 120, y: 200, t: 200 })).toBeNull();
    expect(swipeDirection({ x: 200, y: 200, t: 0 }, { x: 170, y: 200, t: 100 })).toBeNull();
    expect(swipeDirection({ x: 300, y: 200, t: 0 }, { x: 100, y: 200, t: 1500 })).toBeNull();
  });
});
