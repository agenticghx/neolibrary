import { describe, expect, it } from "vitest";
import { ASK_AGAIN_USD, goAhead, mayPay, mustAskAgain, paidFor, soFar, TURN_OFF, turnStore } from "./rewritten-turn";

describe("read it rewritten as you turn (M17 R3)", () => {
  it("counts only what was paid, and asks again once $1 has been paid since the last go-ahead", () => {
    expect(ASK_AGAIN_USD).toBe(1);
    let t = goAhead(TURN_OFF);
    expect(t).toEqual({ on: true, count: 0, usd: 0, sinceOk: 0 });
    expect(soFar(t)).toBe("");
    t = paidFor(t, 0.6);
    expect(mustAskAgain(t.sinceOk)).toBe(false);
    expect(soFar(t)).toBe(" So far: 1 paragraph rewritten, about $0.60.");
    t = paidFor(t, 0.6);
    expect(mustAskAgain(t.sinceOk)).toBe(true);
    expect(soFar(t)).toBe(" So far: 2 paragraphs rewritten, about $1.20.");
    // Keep rewriting: the count towards the next question starts again; the total goes on.
    t = goAhead(t);
    expect(t).toMatchObject({ on: true, count: 2, sinceOk: 0 });
    expect(mustAskAgain(t.sinceOk)).toBe(false);
    expect(soFar(paidFor(t, 0.004))).toBe(" So far: 3 paragraphs rewritten, about $1.20.");
    expect(soFar(paidFor(TURN_OFF, 0.004))).toBe(" So far: 1 paragraph rewritten, under $0.01.");
  });

  it("pays for the next paragraph only if the total since the go-ahead stays within $1 with it (finding 8)", () => {
    expect(mayPay(0, 0.6, false)).toBe(true);
    expect(mayPay(0.6, 0.6, false)).toBe(false); // $1.20: ask first
    expect(mayPay(0.4, 0.6, false)).toBe(true); // exactly $1
    expect(mayPay(0.33 + 0.56, 0.11, false)).toBe(true); // 1.0000000000000002 in floating point: still $1
    expect(mayPay(0.6, 0.41, false)).toBe(false);
    // A paragraph that alone costs more than $1: only right after the reader's press, at the price shown.
    expect(mayPay(0, 1.2, false)).toBe(false);
    expect(mayPay(0, 1.2, true)).toBe(true);
  });

  it("the store: changed at once, one loop at a time, and the open pane is told when a loop ends (findings 9, 10)", () => {
    const turns = turnStore();
    let renders = 0;
    const unsubscribe = turns.subscribe(() => renders++);
    turns.change(goAhead);
    turns.change((t) => paidFor(t, 0.6));
    expect(turns.get()).toMatchObject({ on: true, sinceOk: 0.6, count: 1 });
    expect(renders).toBe(2);
    unsubscribe();
    expect(turns.begin()).toBe(true);
    expect(turns.begin()).toBe(false);
    const told: string[] = [];
    const off = turns.onEnd((ended) => told.push(ended.at));
    turns.end({ by: {}, at: "a" });
    expect(told).toEqual(["a"]);
    expect(turns.begin()).toBe(true);
    off();
    turns.end({ by: {}, at: "b" });
    expect(told).toEqual(["a"]);
  });
});
