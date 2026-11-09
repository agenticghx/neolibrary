import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { sections } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { parseEpub } from "./ebook";
import { numberChapters } from "./genealogy";
import { genealogyPromptHash, saveGenealogy, type SentLink } from "./genealogy-store";
import { genealogyNames, genealogyView } from "./genealogy-view";
import { importBook } from "./import";
import { extractPdfSections } from "./pdf-sections";
import { extractSections } from "./sections";

let database: Database;
let ownerId: string;
let bookId: string;
const bytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
const all = extractSections(bytes, parseEpub(bytes).toc as { label: string; href: string }[]);
const laptop = all.filter((s) => s.kind === "paragraph" && s.text.length > 200);
const words = (p: { text: string }, n = 8) => p.text.split(" ").slice(0, n).join(" ");
// A long paragraph from early in the book, and one from a later chapter.
const early = laptop[3];
const late = laptop.find((p) => p.chapterIndex > early.chapterIndex + 3)!;

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  ({ bookId } = await importBook(database.db, new MemoryStorage(), ownerId, { name: "jekyll.epub", bytes }));
});
afterEach(() => database.raw.close());

const link = (p: { id: string; text: string }, from: string, relation: string, to: string, extra: Partial<SentLink> = {}): SentLink => ({
  from,
  from_kind: "person",
  to,
  to_kind: "person",
  relation,
  role: null,
  paragraph: p.id,
  quote: words(p),
  check: "holds",
  ...extra,
});
const cfiOf = async (id: string) => (await database.db.select({ cfi: sections.cfi }).from(sections).where(and(eq(sections.bookId, bookId), eq(sections.id, id))))[0].cfi;

describe("a book's genealogy as the views draw it (M43 S3)", () => {
  it("is null for a book with none sent", async () => {
    expect(await genealogyView(database.db, ownerId, bookId, null)).toBeNull();
  });

  it("numbers the chapters as the laptop skill does, so chapter 3 is the same chapter in both", async () => {
    await saveGenealogy(database.db, ownerId, bookId, { model: "claude-sonnet-5-5", promptHash: await genealogyPromptHash(), links: [link(early, "Gabriel John Utterson", "friend", "Henry Jekyll")], lives: {} });
    const view = (await genealogyView(database.db, ownerId, bookId, null))!;
    // The skill's own count: the file split on the laptop, sized as scripts/genealogy-on-subscription.ts sizes it.
    const byChapter = new Map<number, { label: string; size: number }>();
    for (const s of all) {
      if (s.kind === "chapter") byChapter.set(s.chapterIndex, { label: s.label, size: 0 });
      else if (s.kind === "paragraph" && s.text.trim() && s.form !== "equation") byChapter.get(s.chapterIndex)!.size += s.text.replace(/\s+/g, " ").trim().length;
    }
    const skill = numberChapters([...byChapter].sort((a, b) => a[0] - b[0]).map(([, c]) => c));
    expect(view.n).toBe(skill.chapters.length);
    expect(Object.values(view.chapters)).toEqual(skill.chapters.map((c) => c.title));
    expect(view.parts).toEqual(skill.parts);
  });

  it("gives each link its chapter number and place, keeps removed links apart, and points lives at the right links when one was left out", async () => {
    const sent: SentLink[] = [
      link(early, "Gabriel John Utterson", "friend", "Henry Jekyll", { date: { year: 1885, paragraph: early.id, quote: words(early, 4) } }),
      link(early, "Nobody", "friend", "Henry Jekyll", { quote: "words that are nowhere in this book" }), // left out by the site's check
      link(late, "Henry Jekyll", "friend", "Hastie Lanyon", { check: "fix", was: "Jekyll mentored Lanyon", why: "The paragraph says they were friends." }),
      link(late, "Poole", "worked_for", "Henry Jekyll", { removed: true, check: null, why: "Not said here." }),
    ];
    await saveGenealogy(database.db, ownerId, bookId, {
      model: "claude-sonnet-5-5",
      promptHash: await genealogyPromptHash(),
      links: sent,
      lives: {
        "Henry Jekyll": [
          { what: "friend", with: "Gabriel John Utterson", links: [0], start_year: 1885, date_links: [0], basis: "stated" },
          { what: "friend", with: "Hastie Lanyon", links: [2], basis: "ordered", order: { paragraph: late.id, quote: words(late, 5) }, gk: { start_year: 1860, confidence: "medium", note: "At school together." } },
        ],
      },
    });
    const view = (await genealogyView(database.db, ownerId, bookId, null))!;
    expect(view.links.map((l) => `${l.from} ${l.relation} ${l.to}`)).toEqual(["Gabriel John Utterson friend Henry Jekyll", "Henry Jekyll friend Hastie Lanyon"]);
    expect(view.doubted.map((l) => l.from)).toEqual(["Poole"]);
    const [first, second] = view.links;
    expect(first.chapter).toBeGreaterThanOrEqual(1);
    expect(second.chapter).toBeGreaterThan(first.chapter);
    expect(second.chapter).toBeLessThanOrEqual(view.n);
    expect(first.cfi).toBe(await cfiOf(early.id));
    expect([second.check, second.was]).toEqual(["fix", "Jekyll mentored Lanyon"]);
    expect(first.year).toBe(1885);
    // Lives refer to places in `links`: the sent link 2 is link 1 here, since sent link 1 was left out.
    const life = view.lives["Henry Jekyll"];
    expect(life.map((e) => e.links)).toEqual([[0], [1]]);
    expect(life[0].date_ids).toEqual([0]);
    expect(view.dates[0]).toMatchObject({ year: 1885, chapter: first.chapter, cfi: await cfiOf(early.id) });
    expect(life[1]).toMatchObject({ order_chapter: second.chapter, order_cfi: await cfiOf(late.id), gk: { start_year: 1860, confidence: "medium", note: "At school together." } });
    expect(view.nodes).toMatchObject({ "Henry Jekyll": "person", Poole: "person" });
    expect(view.top.person[0]).toBe("Henry Jekyll");
    expect(view.model).toBe("claude-sonnet-5-5");
  });

  it("knows the reader's chapter from their place in the book", async () => {
    await saveGenealogy(database.db, ownerId, bookId, { model: "claude-sonnet-5-5", promptHash: await genealogyPromptHash(), links: [link(late, "Henry Jekyll", "friend", "Hastie Lanyon")], lives: {} });
    const start = (await genealogyView(database.db, ownerId, bookId, null))!;
    expect(start.at).toBe(1);
    const there = (await genealogyView(database.db, ownerId, bookId, await cfiOf(late.id)))!;
    expect(there.at).toBe(there.links[0].chapter);
  });

  it("lists its names for the Who & what card, with kinds, link counts and which have a family tree", async () => {
    expect(await genealogyNames(database.db, ownerId, bookId)).toEqual([]);
    const org = (from: string, relation: string, to: string): SentLink => ({ ...link(late, from, relation, to), from_kind: "organisation", to_kind: "organisation" });
    await saveGenealogy(database.db, ownerId, bookId, {
      model: "claude-sonnet-5-5",
      promptHash: await genealogyPromptHash(),
      links: [link(early, "Gabriel John Utterson", "friend", "Henry Jekyll"), link(late, "Henry Jekyll", "friend", "Hastie Lanyon"), org("The cabinet", "part_of", "Jekyll's house"), { ...link(late, "Poole", "family", "Henry Jekyll"), removed: true }],
      lives: {},
    });
    expect(await genealogyNames(database.db, ownerId, bookId)).toEqual([
      { name: "Henry Jekyll", kind: "person", links: 2, tree: false },
      { name: "Gabriel John Utterson", kind: "person", links: 1, tree: false },
      { name: "Hastie Lanyon", kind: "person", links: 1, tree: false },
      { name: "The cabinet", kind: "organisation", links: 1, tree: true },
      { name: "Jekyll's house", kind: "organisation", links: 1, tree: true },
    ]);
  });

  it("groups a PDF's pages into the same chapters as the skill, and finds the links by the skill's paragraph ids", async () => {
    const pdfBytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/descartes-meditation-one.pdf", import.meta.url)));
    const { bookId: pdfId } = await importBook(database.db, new MemoryStorage(), ownerId, { name: "descartes.pdf", bytes: pdfBytes });
    const pdfSections = await extractPdfSections(pdfBytes); // as the skill's fetch splits it
    const para = pdfSections.find((p) => p.kind === "paragraph" && p.text.length > 60)!;
    const saved = await saveGenealogy(database.db, ownerId, pdfId, { model: "claude-sonnet-5-5", promptHash: await genealogyPromptHash(), links: [{ ...link(para, "René Descartes", "friend", "Marin Mersenne"), paragraph: para.id }], lives: {} });
    expect(saved.dropped).toEqual({});
    const view = (await genealogyView(database.db, ownerId, pdfId, null))!;
    const sizes = new Map<number, { label: string; size: number }>();
    for (const x of pdfSections) {
      if (x.kind === "chapter") sizes.set(x.chapterIndex, { label: x.label, size: 0 });
      else if (x.text.trim()) sizes.get(x.chapterIndex)!.size += x.text.replace(/\s+/g, " ").trim().length;
    }
    const skill = numberChapters([...sizes].sort((a, b) => a[0] - b[0]).map(([, c]) => c));
    expect(Object.values(view.chapters)).toEqual(skill.chapters.map((c) => c.title));
    expect(view.chapters[1]).toMatch(/^Pages? \d/);
    expect(view.links[0].chapter).toBe(1);
  });

  it("is only for the book's owner", async () => {
    await expect(genealogyView(database.db, "00000000-0000-0000-0000-000000000000", bookId, null)).rejects.toThrow("not found");
  });
});
