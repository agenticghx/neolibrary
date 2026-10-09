import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { FakeImageGenerator } from "@/lib/images/generate";
import { MemoryStorage } from "@/lib/storage";
import { createAnnotation, deleteAnnotation, importAnnotations, listAnnotations } from "./annotations";
import { fromW3C, toMarkdown, toW3C } from "./annotation-formats";
import { exportLibrary } from "./export";
import { importBook } from "./import";
import { makePicture } from "./pictures";
import { cleanPicture } from "./pinned";
import { getSections } from "./sections-store";

let database: Database;
let storage: MemoryStorage;
let ownerId: string;
let bookId: string;
let at: { cfi: string; quote: { exact: string } };

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: file })).bookId;
  const p = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph")[7];
  at = { cfi: p.cfi.replace(/\)$/, "/1:0)"), quote: { exact: p.text.slice(0, 20) } };
});
afterEach(() => database.raw.close());

const commons = {
  source: "wikimedia",
  title: "Silicon wafer",
  thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/W.jpg/480px-W.jpg",
  imageUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/W.jpg",
  pageUrl: "https://commons.wikimedia.org/wiki/File:W.jpg",
  credit: "Ada",
  licence: "CC BY-SA 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0",
};

describe("pinned pictures (M9)", () => {
  it("pins a Commons picture to a passage with its credit and licence, and exports it in every format", async () => {
    const a = await createAnnotation(database.db, ownerId, { kind: "image", bookId, ...at, picture: commons });
    expect(a).toMatchObject({ kind: "image", picture: commons, targetType: "passage" });
    expect((await listAnnotations(database.db, ownerId, bookId))[0].picture).toEqual(commons);
    const book = { id: bookId, title: "J", author: "" };
    expect(toMarkdown(book, [a], () => "Ch")).toContain("Picture: Silicon wafer, by Ada, CC BY-SA 4.0 (https://commons.wikimedia.org/wiki/File:W.jpg)");
    const w3c = JSON.parse(JSON.stringify(toW3C(book, [a])));
    expect(w3c.first.items[0]).toMatchObject({ motivation: "describing", "neolibrary:picture": commons });
    expect((await exportLibrary(database.db, ownerId)).annotations!.map((x) => x.picture)).toEqual([commons]);
    // W3C round trip: export, hide, import keeps the picture.
    await deleteAnnotation(database.db, ownerId, a.id);
    await importAnnotations(database.db, ownerId, bookId, [{ ...fromW3C(w3c)[0], id: null }]);
    expect((await listAnnotations(database.db, ownerId, bookId)).map((x) => [x.kind, x.picture])).toEqual([["image", commons]]);
  });

  it("pins a generated picture by its stored file, labelled as generated", async () => {
    const made = await makePicture(database.db, storage, new FakeImageGenerator(), ownerId, { bookId, subject: "a gas lamp" });
    const picture = { source: "generated", key: made.generation.output, subject: "a gas lamp", model: "fake-image" };
    const a = await createAnnotation(database.db, ownerId, { kind: "image", bookId, ...at, picture });
    expect(a.picture).toEqual(picture);
    expect(toMarkdown({ id: bookId, title: "J", author: "" }, [a], () => "Ch")).toContain("Generated picture: a gas lamp (made by AI, fake-image)");
  });

  it("pins a scaled Commons thumbnail served from thumb.wikimedia.org", async () => {
    const picture = {
      ...commons,
      title: "National Renewable Energy Laboratory logo (2 rows)",
      thumbUrl:
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e5/National_Renewable_Energy_Laboratory_logo_%282_rows%29.jpg/500px-National_Renewable_Energy_Laboratory_logo_%282_rows%29.jpg",
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/e/e5/National_Renewable_Energy_Laboratory_logo_%282_rows%29.jpg",
    };
    const a = await createAnnotation(database.db, ownerId, { kind: "image", bookId, ...at, picture });
    expect(a).toMatchObject({ kind: "image", picture, targetType: "passage" });
    expect((await listAnnotations(database.db, ownerId, bookId))[0].picture).toEqual(picture);
  });

  it("only pins pictures it can trust: Commons links, or the reader's own generated files", () => {
    expect(cleanPicture(commons, ownerId)).toEqual(commons);
    const scaledThumb = "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e5/Logo.jpg/480px-Logo.jpg?utm_source=commons";
    const cleaned = cleanPicture({ ...commons, thumbUrl: scaledThumb }, ownerId);
    if (cleaned?.source !== "wikimedia") throw new Error("a scaled thumbnail was refused");
    expect(cleaned.thumbUrl).toBe(scaledThumb);
    expect(cleanPicture({ ...commons, thumbUrl: "https://evil.example/x.jpg" }, ownerId)).toBeNull();
    expect(cleanPicture({ ...commons, thumbUrl: "https://thumb.wikimedia.org.evil.example/x.jpg" }, ownerId)).toBeNull();
    expect(cleanPicture({ ...commons, imageUrl: "javascript:alert(1)" }, ownerId)).toBeNull();
    expect(cleanPicture({ ...commons, pageUrl: "http://commons.wikimedia.org/x" }, ownerId)).toBeNull();
    expect(cleanPicture({ ...commons, licenceUrl: "javascript:x" }, ownerId)).toMatchObject({ licenceUrl: null });
    expect(cleanPicture({ source: "generated", key: `images/someone-else/${ownerId}/x.png` }, ownerId)).toBeNull();
    expect(cleanPicture({ source: "generated", key: `images/${ownerId}/../secret.png` }, ownerId)).toBeNull();
    expect(cleanPicture(null, ownerId)).toBeNull();
    expect(cleanPicture({ source: "flickr" }, ownerId)).toBeNull();
  });

  it("needs a place in the book", async () => {
    await expect(createAnnotation(database.db, ownerId, { kind: "image", bookId, picture: commons })).rejects.toThrow("Choose a picture");
    await expect(createAnnotation(database.db, ownerId, { kind: "image", bookId, ...at, picture: { source: "x" } })).rejects.toThrow("Choose a picture");
  });
});
