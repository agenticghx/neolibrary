import { describe, expect, it } from "vitest";
import { focusAfter, orderOf } from "./focus";

const ids = (...list: string[]) => list.map((id) => ({ id }));

describe("focus after Move and Remove (M14 step 5)", () => {
  it("stays on the moved title: the same button while it can go that way again, else the other one", () => {
    expect(focusAfter(ids("b", "a"), { op: "up", slotId: "b", index: 1 })).toBe("b:down"); // now first: Move up is off
    expect(focusAfter(ids("a", "c", "b"), { op: "up", slotId: "c", index: 2 })).toBe("c:up");
    expect(focusAfter(ids("b", "a"), { op: "down", slotId: "a", index: 0 })).toBe("a:up"); // now last: Move down is off
    expect(focusAfter(ids("b", "a", "c"), { op: "down", slotId: "a", index: 0 })).toBe("a:down");
    expect(focusAfter(ids("a"), { op: "up", slotId: "gone", index: 0 })).toBeNull();
  });

  it("after Remove goes to the title now in its place, else the one before, else the heading", () => {
    expect(focusAfter(ids("a", "c"), { op: "remove", slotId: "b", index: 1 })).toBe("c:remove");
    expect(focusAfter(ids("a"), { op: "remove", slotId: "b", index: 1 })).toBe("a:remove");
    expect(focusAfter([], { op: "remove", slotId: "a", index: 0 })).toBeNull();
  });

  it("tells one order from another", () => {
    expect(orderOf(ids("a", "b"))).toBe("a b");
    expect(orderOf(ids("b", "a"))).not.toBe(orderOf(ids("a", "b")));
  });
});
