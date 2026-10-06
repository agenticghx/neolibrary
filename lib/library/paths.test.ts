import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hiddenMachinery } from "@/data/paths/hidden-machinery";
import type { Database } from "@/lib/db/client";
import { books, readalongImports } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { createFirstAdmin, createInvite, acceptInvite } from "@/lib/auth/service";
import {
  addSection,
  addTitle,
  choosePillar,
  createPath,
  getBook,
  getPathView,
  listPathsWithProgress,
  moveTitle,
  normaliseTitle,
  pillarProgress,
  removeTitle,
  renamePath,
  seedPath,
  slugify,
  type SlotView,
} from "./paths";

let database: Database;
let ownerId: string;
beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

describe("normaliseTitle", () => {
  it("ignores case, punctuation, accents and subtitles", () => {
    expect(normaliseTitle("Chip War: The Fight for the World's Most Critical Technology")).toBe("chip war");
    expect(normaliseTitle("Gideon's Trumpet")).toBe("gideon s trumpet");
    expect(normaliseTitle("The Logic of Failure (Dörner)")).toBe("the logic of failure");
    expect(normaliseTitle("Rubbish!")).toBe("rubbish");
  });
});

describe("seeding the Hidden Machinery path", () => {
  it("creates every pillar in order with N before E and the master key last", async () => {
    await seedPath(database.db, ownerId, hiddenMachinery);
    const view = (await getPathView(database.db, ownerId, "hidden-machinery"))!;
    expect(view.pillars.map((p) => p.slug)).toEqual(hiddenMachinery.pillars.map((p) => p.slug));
    expect(view.pillars[0]).toMatchObject({ number: 1, title: "Electricity & the grid" });
    expect(view.pillars[0].slots.map((s) => [s.kind, s.book.title])).toEqual([
      ["N", "The Grid"],
      ["E", "Power System Economics"],
    ]);
    expect(view.pillars.at(-1)!.slots[0].book.title).toBe("Seeing Like a State");
    expect(view.available).toBe(0);
    expect(view.notYet).toBeGreaterThan(100);
  });

  it("is idempotent and attaches to a book already in the library", async () => {
    const [mine] = await database.db
      .insert(books)
      .values({ ownerId, title: "Chip War: The Fight for the World's Most Critical Technology", author: "Chris Miller", fileKey: "books/x.epub", fileType: "epub" })
      .returning();
    const first = await seedPath(database.db, ownerId, hiddenMachinery);
    const again = await seedPath(database.db, ownerId, hiddenMachinery);
    expect(again).toBe(first);
    const view = (await getPathView(database.db, ownerId, "hidden-machinery"))!;
    const semis = view.pillars.find((p) => p.slug === "semiconductors")!;
    expect(semis.slots[0].book).toMatchObject({ id: mine.id, available: { read: true, listen: true } });
    expect(view.available).toBe(1);
  });

  it("labels titles by an uploaded audiobook when narration is off; only a finished upload counts", async () => {
    const add = async (title: string, fileType: "epub" | "pdf") =>
      (await database.db.insert(books).values({ ownerId, title, author: "", fileKey: `books/${title}.${fileType}`, fileType }).returning())[0].id;
    const chipWar = await add("Chip War", "epub");
    const grid = await add("The Grid", "pdf");
    const stoft = await add("Power System Economics", "pdf");
    const audiobook = (bookId: string, status: "uploading" | "ready") =>
      database.db.insert(readalongImports).values({ ownerId, bookId, status, manifest: {}, report: { chapters: [], paragraphs: 0 }, audio: [] });
    await audiobook(grid, "ready");
    await audiobook(stoft, "uploading");
    await seedPath(database.db, ownerId, hiddenMachinery);

    const view = (await getPathView(database.db, ownerId, "hidden-machinery", () => null, false))!;
    const slot = (id: string) => view.pillars.flatMap((p) => p.slots).find((s) => s.book.id === id)!;
    expect(slot(grid).book.available).toEqual({ read: true, listen: true });
    expect(slot(stoft).book.available).toEqual({ read: true, listen: false });
    expect(slot(chipWar).book.available).toEqual({ read: true, listen: false });
    expect(view.available).toBe(3);

    expect((await getBook(database.db, ownerId, grid, false))!.available).toEqual({ read: true, listen: true });
    expect((await getBook(database.db, ownerId, chipWar, false))!.available).toEqual({ read: true, listen: false });
    expect((await getBook(database.db, ownerId, chipWar, true))!.available).toEqual({ read: true, listen: true });
  });

  it("counts a Path's numbered pillars and those started, for the sidebar", async () => {
    expect(await listPathsWithProgress(database.db, ownerId)).toEqual([]);
    await seedPath(database.db, ownerId, hiddenMachinery);
    const view = (await getPathView(database.db, ownerId, "hidden-machinery"))!;
    const numbered = view.pillars.filter((p) => p.number > 0);
    const [before] = await listPathsWithProgress(database.db, ownerId);
    expect(before).toMatchObject({ slug: "hidden-machinery", title: "Hidden Machinery", started: 0, total: numbered.length });

    const progress = (id: string, value: number, deleted = false) =>
      database.db
        .update(books)
        .set({ progress: value, ...(deleted ? { deletedAt: new Date() } : {}) })
        .where(eq(books.id, id));
    await progress(numbered[0].slots[0].book.id, 0.2); // pillar 1: started
    await progress(numbered[0].slots[1].book.id, 1); // the same pillar again: still one
    await progress(numbered[2].slots[0].book.id, 0.5, true); // a deleted book does not count
    const suggested = view.pillars.find((p) => p.group === "suggested")!;
    await progress(suggested.slots[0].book.id, 0.5); // not a numbered pillar
    const master = view.pillars.find((p) => p.group === "master")!;
    await progress(master.slots[0].book.id, 0.5); // the master key is not numbered either
    const [after] = await listPathsWithProgress(database.db, ownerId);
    expect(after).toMatchObject({ started: 1, total: numbered.length });

    // A second Path sharing a book counts its own pillars only.
    await seedPath(database.db, ownerId, {
      slug: "short",
      title: "Short",
      description: "",
      sourceUrl: "",
      pillars: [
        { slug: "a", title: "A", group: "main", books: [{ kind: "N", title: "The Grid", author: "Gretchen Bakke" }] },
        { slug: "b", title: "B", group: "main", books: [{ kind: "N", title: "A book nobody started", author: "" }] },
      ],
    });
    const both = await listPathsWithProgress(database.db, ownerId);
    expect(both.map((p) => [p.slug, p.started, p.total])).toEqual([
      ["hidden-machinery", 1, numbered.length],
      ["short", 1, 2],
    ]);
  });

  it("keeps each person's library separate", async () => {
    const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
    const { token } = await createInvite(database.db, admin);
    const reader = await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
    await seedPath(database.db, ownerId, hiddenMachinery);
    expect(await getPathView(database.db, reader.id, "hidden-machinery")).toBeNull();
    const view = (await getPathView(database.db, ownerId, "hidden-machinery"))!;
    const bookId = view.pillars[0].slots[0].book.id;
    expect(await getBook(database.db, reader.id, bookId)).toBeNull();
    expect((await getBook(database.db, ownerId, bookId))!.places[0]).toMatchObject({
      kind: "N",
      pillar: "Electricity & the grid",
      path: "Hidden Machinery",
    });
  });

  it("marks agent suggestions as unverified", async () => {
    await seedPath(database.db, ownerId, hiddenMachinery);
    const [row] = await database.db.select().from(books).where(eq(books.title, "The Power of Maps"));
    expect(row.unverified).toBe(true);
  });
});

describe("you are here", () => {
  const slot = (id: string, kind: SlotView["kind"], progress: number): SlotView => ({
    id,
    kind,
    book: { id, title: id, author: "", progress, unverified: false, available: { read: true, listen: false }, coverUrl: null },
  });

  it("points at the first unfinished core book in a pillar", () => {
    expect(pillarProgress([slot("n", "N", 1), slot("e", "E", 0.3)])).toEqual({ currentSlotId: "e", status: "reading" });
    expect(pillarProgress([slot("n", "N", 0), slot("e", "E", 0)])).toEqual({ currentSlotId: "n", status: "not-started" });
    expect(pillarProgress([slot("n", "N", 1), slot("e", "E", 1), slot("x", "extra", 0)])).toEqual({
      currentSlotId: null,
      status: "done",
    });
  });

  it("picks the pillar being read, else the next one to start", () => {
    const p = (id: string, status: "not-started" | "reading" | "done", group = "main") => ({ id, status, group });
    expect(choosePillar([p("a", "done"), p("b", "not-started"), p("c", "reading")])).toBe("c");
    expect(choosePillar([p("a", "done"), p("s", "not-started", "suggested"), p("b", "not-started")])).toBe("b");
    expect(choosePillar([p("a", "done")])).toBeNull();
  });
});

describe("your own Paths (M14 step 5, D10)", () => {
  const order = async (slug: string) =>
    (await getPathView(database.db, ownerId, slug, () => null, true))!.pillars.map((p) => [p.title, p.slots.map((x) => `${x.kind}:${x.book.title}`)]);

  it("makes a Path with sections of titles in order: library books and new titles", async () => {
    const [frank] = await database.db.insert(books).values({ ownerId, title: "Frankenstein", author: "Mary Shelley", fileKey: "books/f.epub", fileType: "epub" }).returning();
    const path = await createPath(database.db, ownerId, { title: "Philosophy of science", description: "How science changes." });
    expect(path.slug).toBe("philosophy-of-science");
    const first = await addSection(database.db, ownerId, path.id, "Revolutions");
    const second = await addSection(database.db, ownerId, path.id, "Fiction about science");
    await addTitle(database.db, ownerId, first.id, { title: "The Structure of Scientific Revolutions", author: "Thomas S. Kuhn", kind: "N" });
    await addTitle(database.db, ownerId, first.id, { title: "Against Method", author: "Paul Feyerabend", kind: "E" });
    const reused = await addTitle(database.db, ownerId, second.id, { bookId: frank.id, kind: "extra" });
    expect(reused.bookId).toBe(frank.id);
    expect(await order(path.slug)).toEqual([
      ["Revolutions", ["N:The Structure of Scientific Revolutions", "E:Against Method"]],
      ["Fiction about science", ["extra:Frankenstein"]],
    ]);
    const view = (await getPathView(database.db, ownerId, path.slug, () => null, true))!;
    expect([view.available, view.notYet]).toEqual([1, 2]);
    await renamePath(database.db, ownerId, path.id, { title: "Science, philosophically", description: "" });
    expect((await getPathView(database.db, ownerId, path.slug))!.title).toBe("Science, philosophically");
  });

  it("moves titles up and down, staying put at either end, and removes one", async () => {
    const path = await createPath(database.db, ownerId, { title: "Order" });
    const s = await addSection(database.db, ownerId, path.id, "One");
    const a = await addTitle(database.db, ownerId, s.id, { title: "A" });
    const b = await addTitle(database.db, ownerId, s.id, { title: "B" });
    const c = await addTitle(database.db, ownerId, s.id, { title: "C" });
    const titles = async () => (await order(path.slug))[0][1];
    await moveTitle(database.db, ownerId, a.slotId, "up"); // the first stays first
    expect(await titles()).toEqual(["extra:A", "extra:B", "extra:C"]);
    await moveTitle(database.db, ownerId, c.slotId, "up");
    expect(await titles()).toEqual(["extra:A", "extra:C", "extra:B"]);
    await moveTitle(database.db, ownerId, a.slotId, "down");
    expect(await titles()).toEqual(["extra:C", "extra:A", "extra:B"]);
    await moveTitle(database.db, ownerId, b.slotId, "down"); // the last stays last
    expect(await titles()).toEqual(["extra:C", "extra:A", "extra:B"]);
    await removeTitle(database.db, ownerId, a.slotId);
    expect(await titles()).toEqual(["extra:C", "extra:B"]);
    // The book stays in the library.
    expect((await database.db.select().from(books)).some((x) => x.id === a.bookId)).toBe(true);
  });

  it("never makes a second book for a title already in the library", async () => {
    await seedPath(database.db, ownerId, hiddenMachinery);
    const path = await createPath(database.db, ownerId, { title: "Energy" });
    const s = await addSection(database.db, ownerId, path.id, "Grids");
    const r = await addTitle(database.db, ownerId, s.id, { title: "the grid", author: "" });
    expect(r.reused).toBe(true);
    const grids = (await database.db.select().from(books)).filter((x) => normaliseTitle(x.title) === "the grid");
    expect(grids).toHaveLength(1);
  });

  it("keeps addresses unique and away from the app's own and the reading lists'", async () => {
    expect(slugify("Philosophy of Science: An Introduction")).toBe("philosophy-of-science");
    expect((await createPath(database.db, ownerId, { title: "New" })).slug).toBe("new-2");
    expect((await createPath(database.db, ownerId, { title: "Hidden Machinery" })).slug).toBe("hidden-machinery-2");
    expect((await createPath(database.db, ownerId, { title: "Energy" })).slug).toBe("energy");
    expect((await createPath(database.db, ownerId, { title: "Energy" })).slug).toBe("energy-2");
    expect((await createPath(database.db, ownerId, { title: "量子" })).slug).toBe("path");
    await expect(createPath(database.db, ownerId, { title: "   " })).rejects.toThrow("Give the path a name.");
    // The reading list still adds itself, separately.
    await seedPath(database.db, ownerId, hiddenMachinery);
    expect((await getPathView(database.db, ownerId, "hidden-machinery"))!.title).toBe("Hidden Machinery");
  });

  it("refuses to change another reader's Path, section, title or book", async () => {
    const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
    const { token } = await createInvite(database.db, admin);
    const other = await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
    const path = await createPath(database.db, ownerId, { title: "Mine" });
    const s = await addSection(database.db, ownerId, path.id, "One");
    const t = await addTitle(database.db, ownerId, s.id, { title: "A" });
    const [theirBook] = await database.db.insert(books).values({ ownerId: other.id, title: "Theirs" }).returning();
    await expect(addSection(database.db, other.id, path.id, "Sneaky")).rejects.toThrow("not found");
    await expect(addTitle(database.db, other.id, s.id, { title: "Sneaky" })).rejects.toThrow("not found");
    await expect(addTitle(database.db, ownerId, s.id, { bookId: theirBook.id })).rejects.toThrow("not found");
    await expect(moveTitle(database.db, other.id, t.slotId, "down")).rejects.toThrow("not found");
    await expect(removeTitle(database.db, other.id, t.slotId)).rejects.toThrow("not found");
    await expect(renamePath(database.db, other.id, path.id, { title: "Taken" })).rejects.toThrow("not found");
  });
});

