import { strToU8 } from "fflate";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { appSettings, sections } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { readBook } from "./ebook";
import { importBook } from "./import";
import { keptRuns } from "./kept-runs";
import { markdownToEpub } from "./markdown-epub";
import { paragraphFor, RewriteError } from "./rewrite";
import { backfillSectionForms, SECTION_FORMS } from "./section-forms";
import { extractSections } from "./sections";
import type { Piece } from "./rewritten";

// M41 R1c: equations and table cells are not prose. The paper below is invented; its formula is a textbook one.
const PAPER = `# Results

The Hill equation, $E = E_{\\max} D/(D_{50}+D)$, relates dose to effect.

$$
E = \\frac{E_{\\max}\\,D}{D_{50}+D} \\tag{1}
$$

| Dose | Effect |
|---:|---:|
| 0.5 | 70.1 |
| 1 | 49.0 |

The end.
`;

describe("the form of a paragraph (M41 R1c)", () => {
  it("knows a display equation and a table cell, and keeps a sentence with an inline formula as prose", async () => {
    const out = markdownToEpub(PAPER, "paper.md", new Date("2026-11-02T12:00:00Z"));
    const info = await readBook(out.bytes, "x.epub");
    const paras = extractSections(out.bytes, info.toc).filter((s) => s.kind === "paragraph");
    expect(paras.map((s) => s.form)).toEqual(["prose", "equation", "cell", "cell", "cell", "cell", "cell", "cell", "prose"]);
    expect(paras[0].text).toMatch(/^The Hill equation, E=/);
    expect(paras.at(-1)).toMatchObject({ text: "The end.", form: "prose" });
  });

  it("folds each run of equations or table cells into one line that says it is kept", () => {
    const piece = (id: string, form: Piece["form"]): Piece => ({ id, cfi: "", text: id, rewrite: null, estimate: null, form });
    const out = keptRuns([piece("a", "prose"), piece("e1", "equation"), piece("e2", "equation"), piece("c1", "cell"), piece("b", "prose"), piece("e3", "equation"), piece("c2", "cell")]);
    expect(out.map((p) => ("kept" in p ? p.kept : p.id))).toEqual([
      "a",
      "2 equations, kept as in the book.",
      "A table (1 cell), kept as in the book.",
      "b",
      "An equation, kept as in the book.",
      "A table (1 cell), kept as in the book.",
    ]);
  });
});

describe("labelling books already in the library (M41 R1c)", () => {
  let database: Database;
  let storage: MemoryStorage;
  let ownerId: string;
  beforeEach(async () => {
    database = await testDatabase();
    storage = new MemoryStorage();
    ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  });
  afterEach(() => database.raw.close());

  it("stores the forms at import, and an equation or a cell cannot be rewritten", async () => {
    const { bookId } = await importBook(database.db, storage, ownerId, { name: "paper.md", bytes: strToU8(PAPER) });
    const rows = await database.db.select({ id: sections.id, form: sections.form }).from(sections).where(and(eq(sections.bookId, bookId), eq(sections.kind, "paragraph")));
    expect(rows.filter((r) => r.form === "equation")).toHaveLength(1);
    expect(rows.filter((r) => r.form === "cell")).toHaveLength(6);
    const cell = rows.find((r) => r.form === "cell")!;
    await expect(paragraphFor(database.db, ownerId, bookId, { sectionId: cell.id })).rejects.toThrow(
      new RewriteError("Equations and tables are kept as in the book, not rewritten."),
    );
    const prose = rows.find((r) => r.form === "prose")!;
    await expect(paragraphFor(database.db, ownerId, bookId, { sectionId: prose.id })).resolves.toMatchObject({ id: prose.id });
  });

  it("labels the paragraphs of a book stored before forms existed, once, keeping every id", async () => {
    const { bookId } = await importBook(database.db, storage, ownerId, { name: "paper.md", bytes: strToU8(PAPER) });
    const before = await database.db.select({ id: sections.id, form: sections.form }).from(sections).where(eq(sections.bookId, bookId));
    // As the migration leaves it: every paragraph prose, and the pass not yet run.
    await database.db.update(sections).set({ form: "prose" }).where(eq(sections.bookId, bookId));
    await database.db.delete(appSettings).where(eq(appSettings.name, SECTION_FORMS));
    expect(await backfillSectionForms(database.db, storage)).toEqual({ books: 1, labelled: 7 });
    const after = await database.db.select({ id: sections.id, form: sections.form }).from(sections).where(eq(sections.bookId, bookId));
    expect(after.sort((a, b) => a.id.localeCompare(b.id))).toEqual(before.sort((a, b) => a.id.localeCompare(b.id)));
    // It runs once.
    await database.db.update(sections).set({ form: "prose" }).where(eq(sections.bookId, bookId));
    expect(await backfillSectionForms(database.db, storage)).toBeNull();
  });
});
