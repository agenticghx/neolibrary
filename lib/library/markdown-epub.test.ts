import { strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import { books } from "@/lib/db/schema";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { ImportError, readBook } from "./ebook";
import { importBook } from "./import";
import { chaptersOf, inline, isMarkdownName, markdownToEpub, titleFromName } from "./markdown-epub";
import { getBook } from "./paths";
import { extractSections } from "./sections";
import { getSections } from "./sections-store";

// M29: a Markdown book becomes an EPUB at import. The book below is invented (the repository is public).
const BOOK = `Thank you for reading this little book.

## Praise for THE LAMP

"A bright book." —A Reader

# Part I: LIGHT

## Chapter 1: The First Lamp

The first lamp burned oil. It
was smoky, and _The_ _Lamp Gazette_ said so.

### A small heading

**Edison** tried many filaments; the snake_case_word stays.

> A quoted line
> that goes on.

- one item
- two items

## Chapter 2: <Wires> & Poles

A paragraph with a [link](https://example.org) and \`code\` and <script>alert(1)</script>.

# Part II: POWER

## Chapter 3: The Grid

The grid joined the towns.
`;

describe("Markdown to EPUB (M29)", () => {
  it("knows a Markdown file by its name, and makes a title from the name", () => {
    expect(["chip_war.md", "Notes.MARKDOWN", " a.md "].map(isMarkdownName)).toEqual([true, true, true]);
    expect(["book.epub", "md.pdf", "readme.txt"].map(isMarkdownName)).toEqual([false, false, false]);
    expect(titleFromName("chip_war.md")).toBe("Chip War");
    expect(titleFromName("/Users/x/chip+war.md")).toBe("Chip War");
    expect(titleFromName("the-lamp.markdown")).toBe("The Lamp");
    expect(titleFromName(".md")).toBe("Untitled");
  });

  it("marks bold, italics (also in runs) and code, keeps a link's text, and escapes everything else", () => {
    expect(inline("_The_ _Washington Post_ and *this* and **that** and __bold__")).toBe(
      "<em>The</em> <em>Washington Post</em> and <em>this</em> and <strong>that</strong> and <strong>bold</strong>",
    );
    expect(inline("snake_case_word stays")).toBe("snake_case_word stays");
    expect(inline("a [link](https://x.org) and `x < y`")).toBe("a link and <code>x &lt; y</code>");
    expect(inline("<b>no</b> & \"quotes\"")).toBe("&lt;b&gt;no&lt;/b&gt; &amp; &quot;quotes&quot;");
  });

  it("starts a chapter at every level-1 and level-2 heading; text before the first is the opening pages", () => {
    const chapters = chaptersOf(BOOK);
    expect(chapters.map((c) => [c.level, c.title])).toEqual([
      [0, "Opening pages"],
      [2, "Praise for THE LAMP"],
      [1, "Part I: LIGHT"],
      [2, "Chapter 1: The First Lamp"],
      [2, "Chapter 2: <Wires> & Poles"],
      [1, "Part II: POWER"],
      [2, "Chapter 3: The Grid"],
    ]);
    const one = chapters[3].html.join("\n");
    expect(one).toContain("<p>The first lamp burned oil. It was smoky, and <em>The</em> <em>Lamp Gazette</em> said so.</p>");
    expect(one).toContain("<h3>A small heading</h3>");
    expect(one).toContain("<blockquote><p>A quoted line that goes on.</p></blockquote>");
    expect(one).toContain("<ul><li>one item</li><li>two items</li></ul>");
    const two = chapters[4].html.join("\n");
    expect(two).toContain("<h2>Chapter 2: &lt;Wires&gt; &amp; Poles</h2>");
    expect(two).not.toContain("<script");
    expect(two).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("makes an EPUB the app reads: title, author from front matter, nested contents, one chapter per file", async () => {
    const md = `---\ntitle: "The Lamp"\nauthor: Ann Example\n---\n${BOOK}`;
    const out = markdownToEpub(md, "lamp.md", new Date("2026-10-20T12:00:00Z"));
    expect(out).toMatchObject({ title: "The Lamp", author: "Ann Example", chapters: 7 });
    const info = await readBook(out.bytes, "lamp.epub");
    expect(info).toMatchObject({ type: "epub", title: "The Lamp", author: "Ann Example", language: "en" });
    expect(info.toc.map((t) => [t.label, t.children.map((c) => c.label)])).toEqual([
      ["Opening pages", []],
      ["Praise for THE LAMP", []],
      ["Part I: LIGHT", ["Chapter 1: The First Lamp", "Chapter 2: <Wires> & Poles"]],
      ["Part II: POWER", ["Chapter 3: The Grid"]],
    ]);
    const secs = extractSections(out.bytes, info.toc);
    expect(secs.filter((s) => s.kind === "chapter").map((s) => s.label)).toEqual([
      "Opening pages",
      "Praise for THE LAMP",
      "Part I: LIGHT",
      "Chapter 1: The First Lamp",
      "Chapter 2: <Wires> & Poles",
      "Part II: POWER",
      "Chapter 3: The Grid",
    ]);
    expect(secs.filter((s) => s.kind === "paragraph").map((s) => s.text)).toContain("The grid joined the towns.");
    // The same file makes the same EPUB.
    expect(markdownToEpub(md, "lamp.md", new Date("2026-10-20T12:00:00Z")).bytes).toEqual(out.bytes);
  });

  it("takes the title from the file name when there is no front matter, and no author", () => {
    expect(markdownToEpub(BOOK, "the_lamp.md")).toMatchObject({ title: "The Lamp", author: "" });
  });
});

describe("importing a Markdown book (M29)", () => {
  let database: Database;
  let storage: MemoryStorage;
  let ownerId: string;
  beforeEach(async () => {
    database = await testDatabase();
    storage = new MemoryStorage();
    ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  });
  afterEach(() => database.raw.close());

  it("adds it as an EPUB with its chapters and paragraphs, keeping the .md file name", async () => {
    const r = await importBook(database.db, storage, ownerId, { name: "the_lamp.md", bytes: strToU8(BOOK) });
    expect(r).toMatchObject({ status: "added", title: "The Lamp" });
    const { book, available } = (await getBook(database.db, ownerId, r.bookId, true))!;
    expect(book).toMatchObject({ title: "The Lamp", fileType: "epub", fileName: "the_lamp.md" });
    expect(available.read).toBe(true);
    expect(book.fileKey).toMatch(/\.epub$/);
    const stored = await storage.get(book.fileKey!);
    expect(stored?.contentType).toBe("application/epub+zip");
    expect((await readBook(stored!.data, "x.epub")).title).toBe("The Lamp");
    const secs = await getSections(database.db, ownerId, r.bookId);
    expect(secs.filter((s) => s.kind === "chapter")).toHaveLength(7);
    expect(secs.filter((s) => s.kind === "paragraph").length).toBeGreaterThanOrEqual(8);
  });

  it("attaches to a title waiting for it, by name or when chosen", async () => {
    const [waiting] = await database.db.insert(books).values({ ownerId, title: "The Lamp", author: "Ann Example" }).returning();
    const r = await importBook(database.db, storage, ownerId, { name: "the_lamp.md", bytes: strToU8(BOOK) });
    expect(r).toMatchObject({ status: "attached", bookId: waiting.id, title: "The Lamp" });
    const [other] = await database.db.insert(books).values({ ownerId, title: "A Different Name", author: "" }).returning();
    const chosen = await importBook(database.db, storage, ownerId, { name: "notes.md", bytes: strToU8("# One\n\nText.") }, { attachTo: other.id });
    expect(chosen).toMatchObject({ status: "attached", bookId: other.id, title: "A Different Name" });
  });

  it("refuses a file that is not text, and one with no text, and stores nothing", async () => {
    const notText = new Uint8Array([0xff, 0xfe, 0x00, 0x41]);
    await expect(importBook(database.db, storage, ownerId, { name: "x.md", bytes: notText })).rejects.toThrow(new ImportError("This Markdown file is not plain text (UTF-8)."));
    await expect(importBook(database.db, storage, ownerId, { name: "x.md", bytes: strToU8("  \n\n") })).rejects.toThrow("This Markdown file has no text.");
    expect(await database.db.select().from(books)).toEqual([]);
  });
});
