import { describe, expect, it } from "vitest";
import { ASK_AGAIN_USD, goAhead, mustAskAgain, paidFor, soFar, TURN_OFF } from "./rewritten-turn";

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
});
