import { describe, expect, it } from "vitest";
import { safeNext } from "./session";

describe("where to go after signing in", () => {
  it("allows a path on this site only", () => {
    expect(safeNext("/books/1")).toBe("/books/1");
    expect(safeNext("/")).toBe("/");
    expect(safeNext("//elsewhere.example")).toBe("/");
    expect(safeNext("/\\elsewhere.example")).toBe("/");
    expect(safeNext("https://elsewhere.example")).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    // Browsers drop control characters from addresses, so "/<tab>/elsewhere" would open "//elsewhere".
    expect(safeNext("/\t/elsewhere.example")).toBe("/");
    expect(safeNext("/books\n")).toBe("/");
  });
});
