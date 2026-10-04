import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { createAnnotation, deleteAnnotation, importAnnotations, listAnnotations } from "./annotations";
import { fromW3C, toMarkdown, toW3C } from "./annotation-formats";
import { exportLibrary } from "./export";
import { importBook } from "./import";
import { getSections } from "./sections-store";
import { STICKERS } from "./stickers";

let database: Database;
let ownerId: string;
let bookId: string;
let para: { cfi: string; text: string };

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "jh.epub", bytes: file })).bookId;
  para = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph")[4];
});
afterEach(() => database.raw.close());

const place = () => ({ cfi: para.cfi.replace(/\)$/, "/1:0)"), quote: { exact: para.text.slice(0, 25) } });

describe("stickers (M8)", () => {
  it("puts a sticker on a passage, lists it, and exports it in every format", async () => {
    const s = await createAnnotation(database.db, ownerId, { kind: "sticker", bookId, ...place(), sticker: "question" });
    expect(s).toMatchObject({ kind: "sticker", sticker: "question", targetType: "passage", color: null, voice: null });
    expect((await listAnnotations(database.db, ownerId, bookId)).map((a) => [a.kind, a.sticker])).toEqual([["sticker", "question"]]);

    const book = { id: bookId, title: "J", author: "" };
    expect(toMarkdown(book, [s], () => "Ch")).toContain("Sticker: Question");
    const w3c = toW3C(book, [s]);
    expect(w3c.first.items[0]).toMatchObject({ motivation: "tagging", "neolibrary:sticker": "question", body: [{ value: "Sticker: Question", purpose: "tagging" }] });
    expect((await exportLibrary(database.db, ownerId)).annotations!.map((a) => [a.kind, a.sticker])).toEqual([["sticker", "question"]]);

    // W3C round trip: export, hide, import into a fresh id space keeps it a sticker.
    const back = fromW3C(JSON.parse(JSON.stringify(w3c)));
    expect(back[0]).toMatchObject({ kind: "sticker", sticker: "question", body: "" });
    await deleteAnnotation(database.db, ownerId, s.id);
    await importAnnotations(database.db, ownerId, bookId, [{ ...back[0], id: null }]);
    expect((await listAnnotations(database.db, ownerId, bookId)).map((a) => [a.kind, a.sticker])).toEqual([["sticker", "question"]]);
  });

  it("needs a place in the book and one of the stickers on offer", async () => {
    await expect(createAnnotation(database.db, ownerId, { kind: "sticker", bookId, sticker: "star" })).rejects.toThrow("Choose a sticker");
    await expect(createAnnotation(database.db, ownerId, { kind: "sticker", bookId, ...place(), sticker: "skull" })).rejects.toThrow("Choose a sticker");
    // Another tool's "tagging" annotation, without a Neolibrary sticker, comes in as a note.
    expect(fromW3C([{ type: "Annotation", id: "x", motivation: "tagging", body: [{ type: "TextualBody", value: "todo" }], target: { source: "s" } }])[0]).toMatchObject({
      kind: "note",
      body: "todo",
      sticker: null,
    });
  });

  it("every sticker has a name, a highlight colour and SVG paths", () => {
    for (const [id, s] of Object.entries(STICKERS)) {
      expect(s.label, id).not.toBe("");
      expect(["sage", "amber", "rose", "sky"], id).toContain(s.color);
      expect(s.paths.length, id).toBeGreaterThan(0);
      for (const d of s.paths) expect(d, id).toMatch(/^M[\d.\s,a-zA-Z-]+$/);
    }
  });
});
