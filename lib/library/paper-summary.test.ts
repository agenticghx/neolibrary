import { strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { FakePapers } from "@/lib/papers/fake";
import { MemoryStorage } from "@/lib/storage";
import { importBook } from "./import";
import { listSummaries, paperText, PaperSummaryError, summariseCard } from "./paper-summary";
import { setPaper } from "./papers";

// M41 R4a: a paper's summary card. Invented paper text.
let database: Database;
let ownerId: string;
const add = async (md: string) => (await importBook(database.db, new MemoryStorage(), ownerId, { name: `p${Math.random()}.md`, bytes: strToU8(md) })).bookId;

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

const SHORT = "# Abstract\n\nLamplight speeds the reading of small print.\n\n$$\nE = mc^2\n$$\n\n# Conclusions\n\nWarm light helps.\n";

describe("a paper's summary card (M41 R4a)", () => {
  it("is made from the paper, stored, and served again with no second call", async () => {
    const bookId = await add(SHORT);
    await setPaper(database.db, new FakePapers(), ownerId, bookId, "10.5555/12345678");
    const model = new FakeModel();
    const out = await summariseCard(database.db, model, ownerId, { bookId });
    expect(out.reused).toBe(false);
    expect(out.generation.card).toEqual({
      question: 'The test AI\'s question, from "## Abstract Lamplight speeds the reading of small…".',
      method: "The test AI's method: a made-up line.",
      finding: "The test AI's finding: a made-up line.",
      limits: "The test AI's limits: a made-up line.",
    });
    const prompt = model.calls[0].prompt;
    expect(prompt).toContain("Paper: Lamplight and the reading of small print, by Wick and Keeper");
    expect(prompt).toContain("Warm light helps.");
    // Equations are not prose (R1c): the card is read from the words.
    expect(prompt).not.toContain("mc");
    expect((await summariseCard(database.db, model, ownerId, { bookId })).reused).toBe(true);
    expect(model.calls).toHaveLength(1);
    await summariseCard(database.db, model, ownerId, { bookId, fresh: true });
    expect(await listSummaries(database.db, ownerId, bookId)).toHaveLength(2);
  });

  it("is only for a paper, and only the reader's own", async () => {
    const bookId = await add(SHORT);
    await expect(summariseCard(database.db, new FakeModel(), ownerId, { bookId })).rejects.toThrow(new PaperSummaryError("Mark this title as a paper first (its DOI or PubMed ID)."));
    await setPaper(database.db, new FakePapers(), ownerId, bookId, "7568331");
    await expect(listSummaries(database.db, "00000000-0000-4000-8000-000000000000", bookId)).rejects.toThrow("Book not found");
  });

  it("reads a long paper's start and end whole, and its middle by section titles only", async () => {
    const para = (n: number) => `Paragraph ${n} ${"of careful words ".repeat(60)}`;
    const md = ["# Abstract", "", "The abstract says what was found.", ""]
      .concat(Array.from({ length: 60 }, (_, i) => [`## Section ${i + 1}`, "", para(i + 1), ""]).flat())
      .concat(["# Conclusions", "", "The conclusions close the paper."])
      .join("\n");
    const text = await paperText(database.db, await add(md));
    expect(text).toContain("The abstract says what was found.");
    expect(text).toContain("The conclusions close the paper.");
    expect(text).toContain("[… the middle of the paper, by its section titles:]");
    expect(text).toContain("## Section 30");
    expect(text).not.toContain("Paragraph 30 ");
    expect(text.length).toBeLessThan(40_000);
  });
});
