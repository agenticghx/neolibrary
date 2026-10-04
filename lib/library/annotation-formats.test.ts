import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { annotations } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { fromW3C, toMarkdown, toW3C } from "./annotation-formats";
import { createAnnotation, importAnnotations, listAnnotations, updateAnnotation } from "./annotations";
import { importBook } from "./import";
import { getSections } from "./sections-store";

let database: Database;
let ownerId: string;
let book: { id: string; title: string; author: string };

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const bytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  const { bookId } = await importBook(database.db, new MemoryStorage(), ownerId, { name: "j.epub", bytes });
  book = { id: bookId, title: "The Strange Case of Dr. Jekyll and Mr. Hyde", author: "Robert Louis Stevenson" };
  const paras = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph");
  const p = paras.find((x) => x.text.startsWith("Mr. Utterson the lawyer"))!;
  await createAnnotation(database.db, ownerId, { kind: "note", bookId, body: "The double, again." }, new Date("2026-10-01T10:00:00Z"));
  const h = await createAnnotation(
    database.db,
    ownerId,
    { kind: "highlight", bookId, cfi: p.cfi.replace(/\)$/, ",/1:43,/1:61)"), quote: { exact: "rugged countenance", prefix: "a man of a ", suffix: " that was never" }, color: "amber" },
    new Date("2026-10-01T10:05:00Z"),
  );
  await updateAnnotation(database.db, ownerId, h.id, { body: "Utterson's face is his character." }, new Date("2026-10-02T09:00:00Z"));
  await createAnnotation(database.db, ownerId, { kind: "bookmark", bookId, cfi: p.cfi, quote: { exact: "Mr. Utterson the lawyer was a man" } }, new Date("2026-10-01T10:06:00Z"));
});
afterEach(() => database.raw.close());

const chapter = () => "Story of the Door";

describe("Markdown export", () => {
  it("contains the book note, the quote under its chapter, the note and the bookmark", async () => {
    const md = toMarkdown(book, await listAnnotations(database.db, ownerId, book.id), chapter, new Date("2026-10-04T00:00:00Z"));
    expect(md).toBe(
      [
        "# The Strange Case of Dr. Jekyll and Mr. Hyde",
        "",
        "*Robert Louis Stevenson*",
        "",
        "Exported from Neolibrary on 2026-10-04.",
        "",
        "## Notes on the book",
        "",
        "The double, again.",
        "",
        "## Story of the Door",
        "",
        "- Bookmark: Mr. Utterson the lawyer was a man",
        "",
        "> rugged countenance",
        "",
        "Utterson's face is his character.",
        "",
      ].join("\n"),
    );
  });
});

describe("W3C Web Annotation export", () => {
  it("uses the standard shape with a quote selector and a CFI fragment selector", async () => {
    const w3c = toW3C(book, await listAnnotations(database.db, ownerId, book.id));
    expect(w3c["@context"]).toBe("http://www.w3.org/ns/anno.jsonld");
    expect(w3c.total).toBe(3);
    const h = w3c.first.items.find((a) => a.motivation === "highlighting")!;
    expect(h.target.source).toBe(`urn:neolibrary:book:${book.id}`);
    expect(h.target.selector).toEqual([
      { type: "TextQuoteSelector", exact: "rugged countenance", prefix: "a man of a ", suffix: " that was never" },
      { type: "FragmentSelector", conformsTo: "http://www.idpf.org/epub/linking/cfi/epub-cfi.html", value: expect.stringMatching(/^epubcfi\(/) },
    ]);
    expect(h.body).toEqual([{ type: "TextualBody", value: "Utterson's face is his character.", format: "text/plain", purpose: "commenting" }]);
    expect(h.created).toBe("2026-10-01T10:05:00.000Z");
    expect(h.modified).toBe("2026-10-02T09:00:00.000Z");
  });

  it("export → wipe → import gives back identical annotations, and importing twice adds nothing", async () => {
    const before = await listAnnotations(database.db, ownerId, book.id);
    const file = JSON.parse(JSON.stringify(toW3C(book, before)));
    await database.db.delete(annotations).where(eq(annotations.ownerId, ownerId)); // wipe
    expect(await listAnnotations(database.db, ownerId, book.id)).toEqual([]);

    expect(await importAnnotations(database.db, ownerId, book.id, fromW3C(file))).toEqual({ added: 3, skipped: 0 });
    const after = await listAnnotations(database.db, ownerId, book.id);
    // Version numbers may differ (the W3C file holds the current state, not every edit).
    const strip = (list: typeof before) => list.map((a) => ({ ...a, version: 0 }));
    expect(strip(after)).toEqual(strip(before));

    expect(await importAnnotations(database.db, ownerId, book.id, fromW3C(file))).toEqual({ added: 0, skipped: 3 });
  });

  it("rejects files that are not W3C annotations", () => {
    expect(() => fromW3C({ hello: 1 })).toThrow("not a W3C");
    expect(() => fromW3C([{ type: "Thing" }])).toThrow("not a W3C");
  });
});
