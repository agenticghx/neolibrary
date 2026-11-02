import { strToU8 } from "fflate";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { sections } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { equationAt, explainMath, ExplainMathError, listExplainMath } from "./explain-math";
import { importBook } from "./import";

// M41 R4b: explain an equation. The paper is invented; its formula is a textbook one.
const LATEX = "E = \\frac{E_{\\max}\\,D}{D_{50}+D} \\tag{1}";
const PAPER = `# Results

Before the dose-response model, a word on units: doses are in micromolar.

The Hill equation relates dose to effect, as below.

$$
${LATEX}
$$

Here the effect halves at the median dose.

The end.
`;

let database: Database;
let ownerId: string;
let bookId: string;
let rows: { id: string; cfi: string; form: string; text: string; position: number }[];

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "paper.md", bytes: strToU8(PAPER) })).bookId;
  rows = await database.db
    .select({ id: sections.id, cfi: sections.cfi, form: sections.form, text: sections.text, position: sections.position })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "paragraph")));
  rows.sort((a, b) => a.position - b.position);
});
afterEach(() => database.raw.close());

describe("explain an equation (M41 R4b)", () => {
  it("asks with the LaTeX, its number and the prose around it, stores the answer and serves it again free", async () => {
    const eqn = rows.find((r) => r.form === "equation")!;
    const model = new FakeModel();
    const out = await explainMath(database.db, model, ownerId, { bookId, cfi: eqn.cfi, latex: LATEX });
    expect(out.reused).toBe(false);
    expect(out.equation).toEqual({ id: eqn.id, latex: LATEX, number: "1" });
    expect(model.calls).toHaveLength(1);
    const prompt = model.calls[0].prompt;
    expect(prompt).toContain("Task: Explain an equation");
    expect(prompt).toContain(`Equation (1): ${LATEX}`);
    expect(prompt).toContain("Before the dose-response model");
    expect(prompt).toContain("The Hill equation relates dose to effect");
    expect(prompt).toContain("Here the effect halves at the median dose.");
    expect(prompt).not.toContain("The end.");
    expect(out.generation.output).toMatch(/^Fake explain an equation:/);

    const again = await explainMath(database.db, model, ownerId, { bookId, cfi: eqn.cfi, latex: LATEX });
    expect(again.reused).toBe(true);
    expect(model.calls).toHaveLength(1);
    expect(await listExplainMath(database.db, ownerId, bookId, out.equation)).toHaveLength(1);
    // Asked again on purpose: a second answer.
    await explainMath(database.db, model, ownerId, { bookId, cfi: eqn.cfi, latex: LATEX, fresh: true });
    expect(model.calls).toHaveLength(2);
    expect(await listExplainMath(database.db, ownerId, bookId, out.equation)).toHaveLength(2);
  });

  it("refuses prose, a missing or overlong LaTeX, and another reader's book", async () => {
    const eqn = rows.find((r) => r.form === "equation")!;
    const prose = rows.find((r) => r.form === "prose")!;
    await expect(equationAt(database.db, ownerId, bookId, prose.cfi, "x")).rejects.toThrow(new ExplainMathError("Tap an equation set on its own line to have it explained."));
    await expect(equationAt(database.db, ownerId, bookId, eqn.cfi, "  ")).rejects.toThrow("This equation has no LaTeX to read.");
    await expect(equationAt(database.db, ownerId, bookId, eqn.cfi, "x".repeat(2001))).rejects.toThrow("This equation is too long to explain.");
    await expect(equationAt(database.db, "00000000-0000-4000-8000-000000000000", bookId, eqn.cfi, LATEX)).rejects.toThrow("Book not found");
  });
});
