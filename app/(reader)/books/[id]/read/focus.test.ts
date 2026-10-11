import { describe, expect, it } from "vitest";
import { lineAt, linesIn, nearest, type Box } from "./focus";

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

describe("the reading ruler finds the line under the pointer (M21)", () => {
  // A paragraph of three lines in a column from x 100 to 400; its third line is cut by an italic word, so it has
  // three boxes; a fourth line lies on the next page (x 800 to 1100) and is not in this column.
  const column = box(100, 50, 400, 200);
  const boxes = [
    box(120, 60, 400, 80), // first line, indented
    box(100, 92, 400, 112),
    box(100, 124, 180, 144), // third line: plain, italic, plain
    box(180, 123, 240, 145),
    box(240, 124, 300, 144),
    box(800, 60, 1100, 80), // next page
    box(150, 70, 150, 90), // an empty box (a line break)
  ];

  it("groups the boxes of a line into one line, and keeps to the column", () => {
    expect(linesIn(boxes, column)).toEqual([box(120, 60, 400, 80), box(100, 92, 400, 112), box(100, 123, 300, 145)]);
  });

  it("picks the line under the pointer, or the nearest one between lines", () => {
    const lines = linesIn(boxes, column);
    expect(lineAt(lines, 100)).toEqual(box(100, 92, 400, 112));
    expect(lineAt(lines, 130)).toEqual(box(100, 123, 300, 145));
    // In the gap between the first and second lines, nearer the second.
    expect(lineAt(lines, 89)).toEqual(box(100, 92, 400, 112));
    // Past the end of the short last line (x 380): still that line, not the full line above it.
    expect(lineAt(lines, 135)).toEqual(box(100, 123, 300, 145));
    // Below the paragraph: its last line.
    expect(lineAt(lines, 190)).toEqual(box(100, 123, 300, 145));
    expect(lineAt([], 0)).toBeNull();
  });

  it("works with the browser's own boxes, whose fields are getters (a spread copies none of them)", () => {
    class Rect {
      #b: Box;
      constructor(b: Box) {
        this.#b = b;
      }
      get left() {
        return this.#b.left;
      }
      get top() {
        return this.#b.top;
      }
      get right() {
        return this.#b.right;
      }
      get bottom() {
        return this.#b.bottom;
      }
    }
    const lines = linesIn(boxes.map((b) => new Rect(b)), column);
    expect(lines).toEqual([box(120, 60, 400, 80), box(100, 92, 400, 112), box(100, 123, 300, 145)]);
    expect(lineAt(lines, 100)).toEqual(box(100, 92, 400, 112));
  });

  it("picks the part of a paragraph in the pointer's column when it runs over two pages", () => {
    const parts = [box(100, 50, 400, 600), box(800, 50, 1100, 300)];
    expect(nearest(parts, 900, 120)).toEqual(parts[1]);
    expect(nearest(parts, 300, 590)).toEqual(parts[0]);
  });
});
