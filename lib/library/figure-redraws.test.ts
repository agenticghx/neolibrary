import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books, generations } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { FakePapers } from "@/lib/papers/fake";
import { MemoryStorage } from "@/lib/storage";
import { figuresOf } from "./figure-redraw";
import { figureRedrawsFor, figureRedrawSvg, FigureRedrawError, redrawPromptHash, saveFigureRedraws, type SentFigure } from "./figure-redraws";
import { importBook } from "./import";
import { setPaper } from "./papers";

// M41 R6: redrawn figures sent from the laptop are checked against the book's own file, stored with their provenance,
// and served to whoever may read the paper. The paper and its 1-by-1 picture are invented.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
const MD = "# Results\n\nThe lamp warms the page.\n\n![Figure 1](figures/fig-01.png)\n\nFigure 1. A lamp.\n";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="1" height="1"><rect x="0" y="0" width="1" height="1" fill="#fff"/></svg>';

let database: Database;
let storage: MemoryStorage;
let ownerId: string;
let bookId: string;
let sent: SentFigure;

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "Sam Owner", password: "long enough pw" })).id;
  const zip = zipSync({ "lamp.md": strToU8(MD), "figures/fig-01.png": PNG });
  bookId = (await importBook(database.db, storage, ownerId, { name: "lamp.zip", bytes: zip })).bookId;
  const [b] = await database.db.select({ fileKey: books.fileKey }).from(books).where(eq(books.id, bookId));
  const [figure] = figuresOf((await storage.get(b.fileKey!))!.data);
  sent = {
    chapter: figure.spots[0].chapter,
    nth: figure.spots[0].nth,
    src: figure.src,
    inputHash: createHash("sha256").update(figure.bytes).digest("hex"),
    svg: SVG,
    model: "claude-opus-5-5",
    promptHash: await redrawPromptHash(),
    inputTokens: 1200,
    outputTokens: 900,
    check: { tolerance: 3, missed: 0.01, extra: 0, wordsAstray: 0, rounds: 1, reviewedBy: "claude-sonnet-5-5" },
  };
});
afterEach(() => database.raw.close());

const save = (figures: unknown[], who = ownerId, id = bookId) => saveFigureRedraws({ db: database.db, storage }, who, id, { figures });
const own = () => ({ id: bookId, ownerId, sharedFrom: null });

describe("redrawn figures (M41 R6)", () => {
  it("stores a redraw with its provenance, once, and serves the newest", async () => {
    expect(await save([sent])).toEqual({ saved: 1, figures: 1 });
    expect(await save([sent])).toEqual({ saved: 0, figures: 1 }); // sent again: nothing new
    const [row] = await database.db.select().from(generations).where(eq(generations.kind, "figure-redraw"));
    expect(row).toMatchObject({ provider: "claude-subscription", model: "claude-opus-5-5", costUsd: 0, sectionId: `${sent.chapter}#0`, inputHash: sent.inputHash, output: SVG });
    expect(JSON.parse(row.options.check)).toMatchObject({ rounds: 1, reviewedBy: "claude-sonnet-5-5" });

    const newer = SVG.replace('fill="#fff"', 'fill="#fefefe"');
    expect((await save([{ ...sent, svg: newer }])).saved).toBe(1);
    const list = await figureRedrawsFor(database.db, own());
    expect(list).toEqual([expect.objectContaining({ chapter: sent.chapter, nth: 0, model: "claude-opus-5-5" })]);
    expect(await figureRedrawSvg(database.db, own(), list[0].id)).toBe(newer);
  });

  it.each([
    ["another picture's bytes", { inputHash: "0".repeat(64) }, /another picture/],
    ["a place the book has no picture at", { nth: 3 }, /no picture/],
    ["a drawing with a script", { svg: SVG.replace("</svg>", "<script>alert(1)</script></svg>") }, /<script>/],
    ["other instructions", { promptHash: "f".repeat(64) }, /other instructions/],
    ["a model that is not Claude", { model: "gpt-x" }, /Claude model/],
    ["no check figures", { check: {} }, /check/],
  ])("refuses %s, and stores nothing", async (_, change, why) => {
    await expect(save([sent, { ...sent, ...change }])).rejects.toThrow(why);
    expect(await database.db.select().from(generations).where(eq(generations.kind, "figure-redraw"))).toEqual([]);
  });

  it("refuses a book that is not the sender's, and serves no redraw of another book", async () => {
    await save([sent]);
    const other = (await importBook(database.db, storage, ownerId, { name: "other.md", bytes: strToU8("# Other\n\nText.\n") })).bookId;
    const [g] = await database.db.select({ id: generations.id }).from(generations).where(eq(generations.kind, "figure-redraw"));
    expect(await figureRedrawSvg(database.db, { id: other, ownerId, sharedFrom: null }, g.id)).toBeNull();
    await expect(save([sent], ownerId, "00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(FigureRedrawError);
  });

  it("shows the owner's redraws to a reader the paper is shared with, who cannot send any", async () => {
    await save([sent]);
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "Sam Owner", role: "admin" });
    const ann = (await acceptInvite(database.db, token, { email: "ann@example.com", name: "Ann", password: "long enough pw" })).id;
    await setPaper(database.db, new FakePapers(), ownerId, bookId, "10.5555/12345678");
    const [copy] = await database.db.select().from(books).where(and(eq(books.ownerId, ann), eq(books.sharedFrom, bookId)));
    const list = await figureRedrawsFor(database.db, copy);
    expect(list).toHaveLength(1);
    expect(await figureRedrawSvg(database.db, copy, list[0].id)).toBe(SVG);
    await expect(save([sent], ann, copy.id)).rejects.toThrow(/only its owner/);
  });
});
