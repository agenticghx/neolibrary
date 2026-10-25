import { describe, expect, it } from "vitest";
import { turnAmount, swipeDirection, wheelTurner, type Turn } from "./swipe-turn";

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

  it("turns a page for every swipe of a reader swiping page after page, each starting while the last still coasts", () => {
    let clock = 0;
    const turns: Turn[] = [];
    const onWheel = wheelTurner((d) => turns.push(d), () => clock);
    const send = (dx: number) => {
      onWheel(wheel(dx));
      clock += 16;
    };
    for (let k = 0; k < 5; k++) {
      for (const d of [2, 5, 10, 18, 26, 30]) send(d); // fingers on the trackpad
      for (let d = 28, i = 0; i < 10; d *= 0.93, i++) send(Math.round(d)); // coasting, cut short by the next swipe
    }
    expect(turns).toEqual(["next", "next", "next", "next", "next"]);
  });

  it("does not take coasting that wobbles (two events in one) for a new swipe", () => {
    let clock = 0;
    const turns: Turn[] = [];
    const onWheel = wheelTurner((d) => turns.push(d), () => clock);
    const coast = [30, 28, 26, 48, 22, 20, 36, 17, 15, 13, 24, 11, 9, 8, 14, 6, 5, 4, 7, 3, 2, 2, 3, 1, 1, 2, 1];
    for (const d of [5, 15, 30, ...coast]) {
      onWheel(wheel(d));
      clock += 16;
    }
    expect(turns).toEqual(["next"]);
  });

  it("goes back at once for a swipe the other way, even while the last one coasts", () => {
    const { onWheel, turns } = setup();
    for (const d of [10, 20, 30, 25, 20]) onWheel(wheel(d));
    for (const d of [-10, -20, -30]) onWheel(wheel(d));
    expect(turns).toEqual(["next", "prev"]);
  });

  it("turns with up and down when asked (Pages), and leaves it alone otherwise (Scroll)", () => {
    const { onWheel, turns } = setup();
    expect(onWheel(wheel(0, 100), false)).toBe(false);
    expect(turns).toEqual([]);
    expect(onWheel(wheel(0, 100), true)).toBe(true);
    expect(turns).toEqual(["next"]);
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
      used.push(onWheel(wheel(8), false, () => tableHasRoom));
      clock += 16;
    }
    expect(turns).toEqual([]);
    expect(used.every((u) => !u)).toBe(true);
  });
});

describe("turnAmount", () => {
  it("reads Shift with a mouse wheel as sideways, and lines as pixels", () => {
    expect(turnAmount(wheel(0, 100, { shiftKey: true }), false)).toEqual({ axis: "x", px: 100 });
    expect(turnAmount(wheel(3, 0, { deltaMode: 1 }), false)).toEqual({ axis: "x", px: 48 });
    expect(turnAmount(wheel(10, 10), true)).toBeNull();
  });

  it("counts up and down only where it may turn pages (Pages)", () => {
    expect(turnAmount(wheel(2, 100), false)).toBeNull();
    expect(turnAmount(wheel(2, 100), true)).toEqual({ axis: "y", px: 100 });
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
