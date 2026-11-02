import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { XMLValidator } from "fast-xml-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { readBook } from "./ebook";
import { importBook, picturesNote } from "./import";
import { chaptersOf, markdownToEpub } from "./markdown-epub";
import { pictureKind, Pictures, zipPath } from "./markdown-pictures";
import { getBook } from "./paths";
import { extractSections } from "./sections";
import { markdownIn, ZIP_NOT_A_BOOK, zipNames } from "./zip-names";

// M41 R2: a paper's figures, uploaded with its .md in one .zip. The picture is a 1-by-1 PNG; the text is invented.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1]);
const SVG = strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const PAPER = `# A Short Paper

Doses and effects.

![Figure 1](figures/fig-01.png)

**Figure 1.** The effect falls as the dose rises.

Again: ![Figure 1, small](./figures/fig-01.png "a title") inline, and ![Figure 2](figures/fig-02.png).

![Escaping](../secret.png) ![Remote](https://example.org/x.png) ![Data](data:image/png;base64,AAAA) ![Vector](figures/v.svg)
`;

describe("pictures in a Markdown book (M41 R2)", () => {
  it("finds a picture's path in the zip from the Markdown file's folder, and never outside it", () => {
    expect(zipPath("figures/fig-01.png", "")).toBe("figures/fig-01.png");
    expect(zipPath("./figures/fig%2001.png", "paper")).toBe("paper/figures/fig 01.png");
    expect(zipPath("../shared/fig.png", "paper/text")).toBe("paper/shared/fig.png");
    for (const src of ["../x.png", "/etc/passwd", "https://example.org/x.png", "data:image/png;base64,AA", "file:///x.png", "C:\\x.png", "%E0%A4%A"]) {
      expect(zipPath(src, "")).toBeNull();
    }
  });

  it("knows PNG, JPEG, GIF and WebP by their first bytes, and nothing else (no SVG)", () => {
    expect(pictureKind(PNG)?.mediaType).toBe("image/png");
    expect(pictureKind(JPEG)?.mediaType).toBe("image/jpeg");
    expect(pictureKind(strToU8("GIF89a......"))?.mediaType).toBe("image/gif");
    expect(pictureKind(strToU8("RIFF....WEBPVP8 "))?.mediaType).toBe("image/webp");
    expect(pictureKind(SVG)).toBeNull();
    expect(pictureKind(strToU8("not a picture at all"))).toBeNull();
  });

  it("puts each picture the upload holds into the book once, as a figure when it stands alone, and lists the rest", () => {
    const pictures = new Pictures({ "figures/fig-01.png": PNG, "figures/v.svg": SVG, "secret.png": PNG }, "");
    const html = chaptersOf(PAPER, pictures)[0].html.join("\n");
    expect(html).toContain('<p class="figure"><img src="images/p1.png" alt="Figure 1"/></p>');
    expect(html).toContain('<p><strong>Figure 1.</strong> The effect falls as the dose rises.</p>');
    expect(html).toContain('Again: <img src="images/p1.png" alt="Figure 1, small"/> inline, and <em>Figure 2</em>.');
    expect(html).toContain("<em>Escaping</em> <em>Remote</em> <em>Data</em> <em>Vector</em>");
    expect(pictures.used.map((p) => p.href)).toEqual(["images/p1.png"]);
    expect(pictures.missing).toEqual(["figures/fig-02.png", "../secret.png", "https://example.org/x.png", "data:image/png;base64,AAAA", "figures/v.svg"]);
  });

  it("makes an EPUB that holds the picture, lists it, and whose figure is not a paragraph", async () => {
    const out = markdownToEpub(PAPER, "a_short_paper.md", new Date("2026-11-02T12:00:00Z"), new Pictures({ "figures/fig-01.png": PNG }, ""));
    expect(out.pictures).toEqual({ used: 1, missing: ["figures/fig-02.png", "../secret.png", "https://example.org/x.png", "data:image/png;base64,AAAA", "figures/v.svg"] });
    const files = unzipSync(out.bytes);
    expect(files["OEBPS/images/p1.png"]).toEqual(PNG);
    expect(strFromU8(files["OEBPS/content.opf"])).toContain('<item id="img1" href="images/p1.png" media-type="image/png"/>');
    expect(XMLValidator.validate(strFromU8(files["OEBPS/c1.xhtml"]))).toBe(true);
    const info = await readBook(out.bytes, "x.epub");
    const texts = extractSections(out.bytes, info.toc).filter((s) => s.kind === "paragraph").map((s) => s.text);
    expect(texts).toContain("Figure 1. The effect falls as the dose rises.");
    expect(texts.some((t) => t === "")).toBe(false);
  });

  it("says how many pictures came, which were not found, and how to bring them", () => {
    expect(picturesNote({ used: 33, missing: [] }, true)).toBe("With 33 pictures.");
    expect(picturesNote({ used: 0, missing: [] }, false)).toBeNull();
    expect(picturesNote({ used: 1, missing: ["a.png", "b.png", "c.png", "d.png"] }, true)).toBe("With 1 picture; 4 pictures not found in the .zip (a.png, b.png, c.png, …).");
    expect(picturesNote({ used: 0, missing: ["figures/fig-01.png"] }, false)).toBe(
      "1 picture not in this file (figures/fig-01.png). To include them, add the .md and its pictures together as one .zip.",
    );
  });

  it("reads a zip's file names from its table of contents, and leaves out macOS's copies and hidden files", async () => {
    const zip = zipSync({ "paper/a.md": strToU8("# A"), "paper/figures/f.png": PNG, "__MACOSX/paper/._a.md": strToU8("x"), "paper/.notes.md": strToU8("x") });
    const names = await zipNames(new Blob([zip]));
    expect(names?.sort()).toEqual(["__MACOSX/paper/._a.md", "paper/.notes.md", "paper/a.md", "paper/figures/f.png"]);
    expect(markdownIn(names!)).toEqual(["paper/a.md"]);
    expect(await zipNames(new Blob([strToU8("PK")]))).toBeNull();
    expect(await zipNames(new Blob([strToU8("not a zip")]))).toBeNull();
  });
});

describe("importing a paper's .zip (M41 R2)", () => {
  let database: Database;
  let storage: MemoryStorage;
  let ownerId: string;
  beforeEach(async () => {
    database = await testDatabase();
    storage = new MemoryStorage();
    ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  });
  afterEach(() => database.raw.close());

  it("adds the Markdown with its pictures, finding them from the Markdown file's folder, and says so", async () => {
    const zip = zipSync({ "paper/a_short_paper.md": strToU8(PAPER), "paper/figures/fig-01.png": PNG, "paper/figures/fig-02.png": JPEG });
    const r = await importBook(database.db, storage, ownerId, { name: "a_short_paper.zip", bytes: zip });
    expect(r).toMatchObject({ status: "added", title: "A Short Paper" });
    expect(r.note).toBe("With 2 pictures; 4 pictures not found in the .zip (../secret.png, https://example.org/x.png, data:image/png;base64,AAAA, …).");
    const { book } = (await getBook(database.db, ownerId, r.bookId, true))!;
    expect(book).toMatchObject({ fileType: "epub", fileName: "a_short_paper.zip" });
    const files = unzipSync((await storage.get(book.fileKey!))!.data);
    expect(Object.keys(files).filter((f) => f.startsWith("OEBPS/images/")).sort()).toEqual(["OEBPS/images/p1.png", "OEBPS/images/p2.jpg"]);
  });

  it("tells a lone .md which pictures it lacks", async () => {
    const r = await importBook(database.db, storage, ownerId, { name: "a_short_paper.md", bytes: strToU8("# P\n\n![Figure 1](figures/fig-01.png)\n") });
    expect(r.note).toBe("1 picture not in this file (figures/fig-01.png). To include them, add the .md and its pictures together as one .zip.");
  });

  it("refuses a .zip with no Markdown file (an audiobook's package, say), with several, or that is not a zip", async () => {
    const audio = zipSync({ "book.mp3": strToU8("ID3"), "sync.json": strToU8("{}") });
    await expect(importBook(database.db, storage, ownerId, { name: "audiobook.zip", bytes: audio })).rejects.toThrow(ZIP_NOT_A_BOOK);
    const two = zipSync({ "a.md": strToU8("# A"), "b.md": strToU8("# B") });
    await expect(importBook(database.db, storage, ownerId, { name: "two.zip", bytes: two })).rejects.toThrow("This .zip holds 2 Markdown files.");
    await expect(importBook(database.db, storage, ownerId, { name: "broken.zip", bytes: strToU8("PK not really") })).rejects.toThrow("This .zip could not be opened.");
  });
});
