import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { createAnnotation, deleteAnnotation, importAnnotations, listAnnotations } from "./annotations";
import { fromW3C, toMarkdown, toW3C } from "./annotation-formats";
import { cleanDrawing, MAX_STROKES, PAD, strokePath } from "./drawings";
import { exportLibrary } from "./export";
import { importBook } from "./import";
import { getSections } from "./sections-store";

let database: Database;
let ownerId: string;
let bookId: string;
let para: { cfi: string; text: string };

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "jh.epub", bytes: file })).bookId;
  para = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph")[6];
});
afterEach(() => database.raw.close());

const strokes = [
  [10, 10, 120.4, 80.6, 240, 40],
  [300, 150],
];

describe("handwritten notes (M8)", () => {
  it("saves pen strokes on a passage and redraws them exactly; exports them in every format", async () => {
    const a = await createAnnotation(database.db, ownerId, {
      kind: "drawing",
      bookId,
      cfi: para.cfi.replace(/\)$/, "/1:0)"),
      quote: { exact: para.text.slice(0, 20) },
      drawing: { strokes },
    });
    const saved = { width: 600, height: 300, strokes: [[10, 10, 120, 81, 240, 40], [300, 150]] };
    expect(a).toMatchObject({ kind: "drawing", drawing: saved });
    expect((await listAnnotations(database.db, ownerId, bookId))[0].drawing).toEqual(saved);
    expect(saved.strokes.map(strokePath)).toEqual(["M10 10L120 81L240 40", "M300 150h0.01"]);

    const book = { id: bookId, title: "J", author: "" };
    expect(toMarkdown(book, [a], () => "Ch")).toContain("Handwritten note (2 strokes)");
    const w3c = JSON.parse(JSON.stringify(toW3C(book, [a])));
    expect(w3c.first.items[0]["neolibrary:drawing"]).toEqual(saved);
    expect((await exportLibrary(database.db, ownerId)).annotations!.map((x) => x.drawing)).toEqual([saved]);

    await deleteAnnotation(database.db, ownerId, a.id);
    const back = fromW3C(w3c);
    expect(back[0]).toMatchObject({ kind: "drawing", drawing: saved, body: "" });
    await importAnnotations(database.db, ownerId, bookId, [{ ...back[0], id: null }]);
    expect((await listAnnotations(database.db, ownerId, bookId)).map((x) => [x.kind, x.drawing])).toEqual([["drawing", saved]]);
  });

  it("keeps points on the pad and refuses what is not a drawing", async () => {
    expect(cleanDrawing({ strokes: [[-50, 20, 9999, 999]] })).toEqual({ ...PAD, strokes: [[0, 20, PAD.width, PAD.height]] });
    for (const bad of [null, {}, { strokes: [] }, { strokes: [[1]] }, { strokes: [[1, 2, 3]] }, { strokes: [["a", "b"]] }, { strokes: "x" }]) {
      expect(cleanDrawing(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(cleanDrawing({ strokes: Array.from({ length: MAX_STROKES + 1 }, () => [1, 1]) })).toBeNull();
    await expect(createAnnotation(database.db, ownerId, { kind: "drawing", bookId, drawing: { strokes } })).rejects.toThrow("Draw something");
    await expect(
      createAnnotation(database.db, ownerId, { kind: "drawing", bookId, cfi: para.cfi, drawing: { strokes: [] } }),
    ).rejects.toThrow("Draw something");
  });
});
