import { describe, expect, it } from "vitest";
import type { Annotation } from "@/lib/library/annotations";
import { withCrossed } from "./crossed-notes";

const note = (id: string, crossed?: Annotation["crossed"]) => ({ id, cfi: `epubcfi(/6/2!/4/2/1:${id.length})`, crossed }) as unknown as Annotation;

describe("the reader's notes with the other version's (Open unknowns row 23 (1))", () => {
  it("lists each crossed note before the first own note on a later page, placed or not", () => {
    const own = [note("book-note"), note("own-p2"), note("own-p5")];
    const crossed = [note("x-p1", { from: "scan", page: 1 }), note("x-p3", { from: "scan", page: 3 }), note("x-p9", { from: "scan", page: 9 })];
    const list = withCrossed({ annotations: own, crossed, pages: { "own-p2": 2, "own-p5": 5 } }, new Map([["x-p3", "epubcfi(/6/8!/4/2/1:0)"]]));
    expect(list.map((a) => a.id)).toEqual(["book-note", "x-p1", "own-p2", "x-p3", "own-p5", "x-p9"]);
    // Placed here: its place here; not yet: none (it is found when its page is shown).
    expect(list.find((a) => a.id === "x-p3")!.cfi).toBe("epubcfi(/6/8!/4/2/1:0)");
    expect(list.find((a) => a.id === "x-p1")!.cfi).toBeNull();
  });

  it("a book with only notes on the whole book still gets the crossed ones, after them; a book with none crossed is as sent", () => {
    const own = [note("book-note")];
    expect(withCrossed({ annotations: own, crossed: [note("x", { from: "text", page: 4 })], pages: {} }, new Map()).map((a) => a.id)).toEqual(["book-note", "x"]);
    expect(withCrossed({ annotations: own }, new Map())).toBe(own);
  });
});
