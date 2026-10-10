import { readFileSync } from "node:fs";
import * as CFI from "foliate-js/epubcfi.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { SpendingCapReached } from "@/lib/ai/generate";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { setStyle, StyleError } from "./ai-style";
import { paragraphsBetween } from "./annotations";
import { importBook } from "./import";
import { rewriteFor } from "./levels";
import { rewriteParagraph } from "./rewrite";
import { inStyle, rewriteInStyle, rewrittenView } from "./rewritten";
import { getSections } from "./sections-store";
import type { Section } from "./sections";

let database: Database;
let ownerId: string;
let bookId: string;
let all: Section[];
let paragraphs: Section[];

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "jh.epub", bytes: file })).bookId;
  all = await getSections(database.db, ownerId, bookId);
  paragraphs = all.filter((s) => s.kind === "paragraph" && s.text.length > 200);
});
afterEach(() => database.raw.close());

/** The visible range an EPUB page reports: from a few letters into `a` to a few letters into `b` (one CFI, as foliate gives it). */
function rangeCfi(a: Section, b: Section) {
  const steps = (c: string) => c.slice("epubcfi(".length, -1).split("/");
  const [x, y] = [steps(a.cfi), steps(b.cfi)];
  let n = 0;
  while (n < x.length - 1 && x[n] === y[n]) n++;
  return `epubcfi(${x.slice(0, n).join("/")},/${x.slice(n).join("/")}/1:4,/${y.slice(n).join("/")}/1:5)`;
}

/** Paragraphs of one chapter, three in a row. */
function threeInARow() {
  const ps = all.filter((s) => s.kind === "paragraph");
  const i = ps.findIndex((p, k) => k > 10 && ps[k + 2]?.chapterIndex === p.chapterIndex && p.text.length > 100);
  return ps.slice(i, i + 3);
}

describe("the paragraphs on screen (M17)", () => {
  it("an EPUB page: from the paragraph it starts in to the last one that starts on it", async () => {
    const [a, b, c] = threeInARow();
    const range = rangeCfi(a, c);
    expect(CFI.collapse(range)).toBe(a.cfi.replace(/\)$/, "/1:4)"));
    const got = await paragraphsBetween(database.db, bookId, range, range);
    expect(got.map((p) => p.id)).toEqual([a.id, b.id, c.id]);
    // A page that starts in the middle of a paragraph still shows it.
    const mid = a.cfi.replace(/\)$/, "/1:30)");
    expect((await paragraphsBetween(database.db, bookId, mid, mid)).map((p) => p.id)).toEqual([a.id]);
  });

  it("a page at the top of a chapter, before its first paragraph, starts there and not in the chapter before", async () => {
    const ps = all.filter((s) => s.kind === "paragraph");
    const firstOfChapter = ps.find((p, k) => k > 0 && ps[k - 1].chapterIndex !== p.chapterIndex)!;
    const chapterTop = /^epubcfi\(\/6\/\d+!/.exec(firstOfChapter.cfi)![0] + "/4/1:0)";
    const got = await paragraphsBetween(database.db, bookId, chapterTop, firstOfChapter.cfi);
    expect(got.map((p) => p.id)).toEqual([firstOfChapter.id]);
  });

  it("a PDF: every paragraph of each page on screen (two pages side by side bring both)", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    for (const paras of [
      [["A first paragraph sits at the top of", "the first page, before the second."], ["Then a second paragraph follows", "on the same page, after a gap."]],
      [["The second page holds a third", "paragraph, alone on its page."]],
    ]) {
      const page = doc.addPage([612, 792]);
      let y = 700;
      for (const lines of paras) {
        for (const line of lines) {
          page.drawText(line, { x: 72, y, size: 12, font });
          y -= 15;
        }
        y -= 20;
      }
    }
    const id = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "two.pdf", bytes: new Uint8Array(await doc.save()) })).bookId;
    const ps = (await getSections(database.db, ownerId, id)).filter((s) => s.kind === "paragraph");
    expect(ps.map((p) => p.cfi)).toEqual(["epubcfi(/6/2)", "epubcfi(/6/2)", "epubcfi(/6/4)"]);
    const ids = async (from: string, to: string) => (await paragraphsBetween(database.db, id, from, to)).map((p) => p.id);
    expect(await ids("epubcfi(/6/2)", "epubcfi(/6/2)")).toEqual([ps[0].id, ps[1].id]);
    expect(await ids("epubcfi(/6/4)", "epubcfi(/6/4)")).toEqual([ps[2].id]);
    expect(await ids("epubcfi(/6/2)", "epubcfi(/6/4)")).toEqual(ps.map((p) => p.id));
  });
});

describe("read it rewritten, in the book's style (M17)", () => {
  it("maps each style to a rewrite level", () => {
    expect(rewriteFor("plain")).toEqual({ level: "plain" });
    expect(rewriteFor("ste-light")).toEqual({ level: "ste", strictness: "light" });
    expect(rewriteFor("ste-standard")).toEqual({ level: "ste", strictness: "standard" });
    expect(rewriteFor("ste-strict")).toEqual({ level: "ste", strictness: "strict" });
  });

  it("shows the price first, then the stored rewrite with provenance, re-served without a second call", async () => {
    // In plain English (new readers start in STE light: lib/library/preferences.test.ts).
    await setStyle(database.db, ownerId, bookId, { scope: "all", style: "plain" });
    const model = new FakeModel();
    const [a, b] = threeInARow();
    const range = rangeCfi(a, b);
    const before = await rewrittenView(database.db, model, ownerId, bookId, { from: range, to: range });
    expect(before.style).toBe("plain");
    expect(before.pieces.map((p) => [p.id, p.rewrite, p.estimate! > 0])).toEqual([
      [a.id, null, true],
      [b.id, null, true],
    ]);
    expect(model.calls).toHaveLength(0);

    const made = await rewriteInStyle(database.db, model, ownerId, { bookId, sectionId: a.id });
    expect(made).toMatchObject({ style: "plain", reused: false, generation: { options: { level: "plain" }, provenance: { promptName: "plain-rewrite + plain/SKILL" } } });
    expect(model.calls[0].system).toContain("One idea per sentence.");

    const after = await rewrittenView(database.db, model, ownerId, bookId, { from: range, to: range });
    expect(after.pieces[0].rewrite).toMatchObject({ id: made.generation.id, text: expect.stringMatching(/^Fake rewrite \(plain english\): /) });
    expect(after.pieces[0].estimate).toBeNull();
    expect(after.pieces[1].rewrite).toBeNull();
    expect(await rewriteInStyle(database.db, model, ownerId, { bookId, sectionId: a.id })).toMatchObject({ reused: true, generation: { id: made.generation.id } });
    expect(model.calls).toHaveLength(1);
  });

  it("follows the book's style: STE strict asks for Strict, and shows only rewrites at that strictness", async () => {
    const model = new FakeModel();
    const p = paragraphs[0];
    await rewriteInStyle(database.db, model, ownerId, { bookId, sectionId: p.id });
    await setStyle(database.db, ownerId, bookId, { scope: "book", style: "ste-strict" });
    const view = async () => (await rewrittenView(database.db, model, ownerId, bookId, { from: p.cfi, to: p.cfi })).pieces[0];
    // The Plain rewrite is not STE strict.
    expect((await view()).rewrite).toBeNull();
    const strict = await rewriteInStyle(database.db, model, ownerId, { bookId, sectionId: p.id });
    expect(strict).toMatchObject({ style: "ste-strict", generation: { options: { level: "ste", strictness: "strict" } } });
    expect(model.calls[1].system).toContain("Strictness level: Strict (full STE)");
    expect((await view()).rewrite).toMatchObject({ id: strict.generation.id, ste: { score: expect.any(Number) } });
    expect((await view()).rewrite!.meaningChanges.length).toBeGreaterThan(0);
    // STE Standard (the reader's setting for all books) is a different strictness.
    await setStyle(database.db, ownerId, bookId, { scope: "book", style: "ste-standard" });
    expect((await view()).rewrite).toBeNull();
  });

  it("a rewrite made in the Rewrite panel at the same level shows here and is not paid for again", async () => {
    const model = new FakeModel();
    const p = paragraphs[1];
    await setStyle(database.db, ownerId, bookId, { scope: "book", style: "ste-light" });
    const panel = await rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: p.id, level: "ste", strictness: "light" });
    const piece = (await rewrittenView(database.db, model, ownerId, bookId, { from: p.cfi, to: p.cfi })).pieces[0];
    expect(piece.rewrite?.id).toBe(panel.generation.id);
    expect(await rewriteInStyle(database.db, model, ownerId, { bookId, sectionId: p.id })).toMatchObject({ reused: true });
    expect(model.calls).toHaveLength(1);
    // Other levels of the panel are not the style's.
    expect(inStyle({ options: { level: "shorter" } }, "plain")).toBe(false);
    expect(inStyle({ options: { level: "ste" } }, "ste-standard")).toBe(true);
  });

  it("stops at the spending cap, and shows no prices without Claude set up", async () => {
    const model = new FakeModel();
    const p = paragraphs[2];
    await expect(rewriteInStyle(database.db, model, ownerId, { bookId, sectionId: p.id }, { caps: { perBookUsd: 0.000001, perMonthUsd: 20 } })).rejects.toBeInstanceOf(
      SpendingCapReached,
    );
    expect(model.calls).toHaveLength(0);
    const piece = (await rewrittenView(database.db, null, ownerId, bookId, { from: p.cfi, to: p.cfi })).pieces[0];
    expect(piece).toMatchObject({ id: p.id, rewrite: null, estimate: null });
  });

  it("is private: another reader cannot see or make rewrites of this book", async () => {
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const other = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
    const p = paragraphs[0];
    const model = new FakeModel();
    await expect(rewrittenView(database.db, model, other, bookId, { from: p.cfi, to: p.cfi })).rejects.toBeInstanceOf(StyleError);
    await expect(rewriteInStyle(database.db, model, other, { bookId, sectionId: p.id })).rejects.toBeInstanceOf(StyleError);
    expect(model.calls).toHaveLength(0);
  });
});
