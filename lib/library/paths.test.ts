import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hiddenMachinery } from "@/data/paths/hidden-machinery";
import type { Database } from "@/lib/db/client";
import { books, readalongImports, slots } from "@/lib/db/schema";
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
  PathError,
  pillarProgress,
  removeTitle,
  renamePath,
  sameAuthor,
  sameBook,
  seedPath,
  slugify,
  type SlotView,
} from "./paths";
import { isReadingList, starterPath } from "./seed";

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
    expect(view.currentPillarId).toBe(view.pillars[0].id);
    expect(view.readingList).toBe(true);
  });

  it("keeps the reading list's order of reading: a finished pillar is done, and You are here stays on the first not done", async () => {
    await seedPath(database.db, ownerId, hiddenMachinery);
    const view = (await getPathView(database.db, ownerId, "hidden-machinery"))!;
    const banking = view.pillars.find((p) => p.slug === "banking")!;
    const core = banking.slots.filter((x) => x.kind === "N" || x.kind === "E").map((x) => x.book.id);
    expect(core.length).toBeGreaterThan(0);
    await database.db.update(books).set({ progress: 1 }).where(inArray(books.id, core));
    const after = (await getPathView(database.db, ownerId, "hidden-machinery"))!;
    expect(after.pillars.find((p) => p.slug === "banking")).toMatchObject({ status: "done", currentSlotId: null });
    expect(after.currentPillarId).toBe(after.pillars[0].id);
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
    expect(before).toMatchObject({ slug: "hidden-machinery", title: "Hidden Machinery", started: 0, total: numbered.length, readingList: true });

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
    expect(both.map((p) => [p.slug, p.started, p.total, p.readingList])).toEqual([
      ["hidden-machinery", 1, numbered.length, true],
      ["short", 1, 2, false],
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

  it("finds no book for an id that is not one, without asking the database", async () => {
    expect(await getBook(database.db, ownerId, "-".repeat(36))).toBeNull(); // Postgres would reject it with an error
    expect(await getBook(database.db, ownerId, "not-an-id")).toBeNull();
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

  it("counts every title in your own Path, in its order; a reading list's extras stay optional", () => {
    const plainOnly = [slot("a", "extra", 1), slot("b", "extra", 1)];
    expect(pillarProgress(plainOnly, false)).toEqual({ currentSlotId: null, status: "done" });
    expect(pillarProgress(plainOnly)).toEqual({ currentSlotId: null, status: "reading" });
    expect(pillarProgress([slot("a", "extra", 1), slot("b", "extra", 0)], false)).toEqual({ currentSlotId: "b", status: "reading" });
    const mixed = [slot("n", "N", 1), slot("e", "E", 1), slot("x", "extra", 0)];
    expect(pillarProgress(mixed, false)).toEqual({ currentSlotId: "x", status: "reading" });
    expect(pillarProgress(mixed)).toEqual({ currentSlotId: null, status: "done" });
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
    expect(first.title).toBe("Revolutions");
    const second = await addSection(database.db, ownerId, path.id, "Fiction about science");
    await addTitle(database.db, ownerId, first.id, { title: "The Structure of Scientific Revolutions", author: "Thomas S. Kuhn", kind: "N" });
    await addTitle(database.db, ownerId, first.id, { title: "Against Method", author: "Paul Feyerabend", kind: "E" });
    const reused = await addTitle(database.db, ownerId, second.id, { bookId: frank.id, kind: "extra" });
    expect(reused).toMatchObject({ bookId: frank.id, title: "Frankenstein", author: "Mary Shelley" });
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
    // Each move says where the title is now ("Moved C to 2 of 3").
    expect(await moveTitle(database.db, ownerId, a.slotId, "up")).toEqual({ title: "A", place: 1, count: 3 }); // the first stays first
    expect(await titles()).toEqual(["extra:A", "extra:B", "extra:C"]);
    expect(await moveTitle(database.db, ownerId, c.slotId, "up")).toEqual({ title: "C", place: 2, count: 3 });
    expect(await titles()).toEqual(["extra:A", "extra:C", "extra:B"]);
    expect(await moveTitle(database.db, ownerId, a.slotId, "down")).toEqual({ title: "A", place: 2, count: 3 });
    expect(await titles()).toEqual(["extra:C", "extra:A", "extra:B"]);
    expect(await moveTitle(database.db, ownerId, b.slotId, "down")).toEqual({ title: "B", place: 3, count: 3 }); // the last stays last
    expect(await titles()).toEqual(["extra:C", "extra:A", "extra:B"]);
    expect(await removeTitle(database.db, ownerId, a.slotId)).toEqual({ title: "A" });
    expect(await titles()).toEqual(["extra:C", "extra:B"]);
    // A title already gone (a second click, another tab) is a PathError, which the page's actions ignore.
    await expect(removeTitle(database.db, ownerId, a.slotId)).rejects.toBeInstanceOf(PathError);
    await expect(moveTitle(database.db, ownerId, a.slotId, "up")).rejects.toBeInstanceOf(PathError);
    // So is an id that is not one, before it reaches the database.
    await expect(removeTitle(database.db, ownerId, "-".repeat(36))).rejects.toBeInstanceOf(PathError);
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

  it("keeps titles in the order added; a kind other than Story first or Go deeper is Any order", async () => {
    const path = await createPath(database.db, ownerId, { title: "Kinds" });
    const s = await addSection(database.db, ownerId, path.id, "Mixed");
    const titles: [string, unknown][] = [
      ["Popper", "extra"],
      ["Kuhn", "N"],
      ["Feyerabend", "E"],
      ["Forged master", "master"],
      ["Forged kind", "bogus"],
      ["No kind", undefined],
    ];
    for (const [title, kind] of titles) await addTitle(database.db, ownerId, s.id, { title, kind });
    expect(await order(path.slug)).toEqual([
      ["Mixed", ["extra:Popper", "N:Kuhn", "E:Feyerabend", "extra:Forged master", "extra:Forged kind", "extra:No kind"]],
    ]);
  });

  it("moves a title only within its own section", async () => {
    const path = await createPath(database.db, ownerId, { title: "Two sections" });
    const one = await addSection(database.db, ownerId, path.id, "One");
    const two = await addSection(database.db, ownerId, path.id, "Two");
    await addTitle(database.db, ownerId, one.id, { title: "A" });
    const b = await addTitle(database.db, ownerId, one.id, { title: "B" });
    const c = await addTitle(database.db, ownerId, two.id, { title: "C" });
    const d = await addTitle(database.db, ownerId, two.id, { title: "D" });
    const rows = async () =>
      (await database.db.select({ id: slots.id, pillarId: slots.pillarId, position: slots.position }).from(slots)).sort((x, y) => x.id.localeCompare(y.id));
    const before = await rows();
    expect(await moveTitle(database.db, ownerId, b.slotId, "down")).toEqual({ title: "B", place: 2, count: 2 }); // last in One: not into Two
    expect(await moveTitle(database.db, ownerId, c.slotId, "up")).toEqual({ title: "C", place: 1, count: 2 }); // first in Two: not into One
    expect(await rows()).toEqual(before);
    await moveTitle(database.db, ownerId, d.slotId, "up");
    expect(await order(path.slug)).toEqual([
      ["One", ["extra:A", "extra:B"]],
      ["Two", ["extra:D", "extra:C"]],
    ]);
  });

  it("picks the book whose whole title was typed when others share its short title", async () => {
    const [poems] = await database.db.insert(books).values({ ownerId, title: "Poems", author: "John Keats" }).returning();
    await database.db.insert(books).values({ ownerId, title: "Poems: Selected and Annotated", author: "John Keats" });
    const path = await createPath(database.db, ownerId, { title: "Verse" });
    const s = await addSection(database.db, ownerId, path.id, "One");
    expect(await addTitle(database.db, ownerId, s.id, { title: "poems", author: "Keats" })).toMatchObject({ bookId: poems.id, reused: true });
  });

  it("lists a book once per section, but lets it sit in two sections", async () => {
    const [frank] = await database.db.insert(books).values({ ownerId, title: "Frankenstein", author: "Mary Shelley", fileKey: "books/f.epub", fileType: "epub" }).returning();
    const path = await createPath(database.db, ownerId, { title: "Monsters" });
    const one = await addSection(database.db, ownerId, path.id, "One");
    const two = await addSection(database.db, ownerId, path.id, "Two");
    await addTitle(database.db, ownerId, one.id, { bookId: frank.id });
    await expect(addTitle(database.db, ownerId, one.id, { bookId: frank.id })).rejects.toThrow("Frankenstein is already in this section.");
    await expect(addTitle(database.db, ownerId, one.id, { title: "Frankenstein", author: "Shelley" })).rejects.toThrow("already in this section");
    await addTitle(database.db, ownerId, two.id, { bookId: frank.id });
    expect(await order(path.slug)).toEqual([
      ["One", ["extra:Frankenstein"]],
      ["Two", ["extra:Frankenstein"]],
    ]);
  });

  it("checks every id before it reaches the database: 36 characters that are not one are not found", async () => {
    const path = await createPath(database.db, ownerId, { title: "Ids" });
    const s = await addSection(database.db, ownerId, path.id, "One");
    const bad = "-".repeat(36);
    await expect(renamePath(database.db, ownerId, bad, { title: "X" })).rejects.toThrow("That path was not found.");
    await expect(addSection(database.db, ownerId, bad, "X")).rejects.toThrow("That path was not found.");
    await expect(addTitle(database.db, ownerId, bad, { title: "X" })).rejects.toThrow("That section was not found.");
    await expect(addTitle(database.db, ownerId, s.id, { bookId: bad })).rejects.toThrow("That book was not found.");
    await expect(moveTitle(database.db, ownerId, bad, "up")).rejects.toThrow("That title was not found.");
  });

  it("orders titles with the same place by their id, on the Path and when moving", async () => {
    const path = await createPath(database.db, ownerId, { title: "Ties" });
    const s = await addSection(database.db, ownerId, path.id, "One");
    const a = await addTitle(database.db, ownerId, s.id, { title: "A" });
    const b = await addTitle(database.db, ownerId, s.id, { title: "B" });
    await database.db.update(slots).set({ position: 0 }).where(inArray(slots.id, [a.slotId, b.slotId])); // two adds at the same moment
    const byId = [a, b].sort((x, y) => x.slotId.localeCompare(y.slotId)).map((x) => (x === a ? "extra:A" : "extra:B"));
    expect((await order(path.slug))[0][1]).toEqual(byId);
    const second = byId[1] === "extra:A" ? a : b;
    expect(await moveTitle(database.db, ownerId, second.slotId, "up")).toMatchObject({ place: 1, count: 2 });
    expect((await order(path.slug))[0][1]).toEqual([...byId].reverse());
  });

  it("refuses to change a reading list: its name, sections and titles stay as the list has them", async () => {
    await seedPath(database.db, ownerId, hiddenMachinery);
    const view = (await getPathView(database.db, ownerId, "hidden-machinery"))!;
    const before = await order("hidden-machinery");
    const [first] = view.pillars;
    const locked = "A reading list cannot be changed.";
    await expect(renamePath(database.db, ownerId, view.id, { title: "Mine now" })).rejects.toThrow(locked);
    await expect(addSection(database.db, ownerId, view.id, "Extra")).rejects.toThrow(locked);
    await expect(addTitle(database.db, ownerId, first.id, { title: "A book of my own" })).rejects.toThrow(locked);
    await expect(moveTitle(database.db, ownerId, first.slots[0].id, "down")).rejects.toThrow(locked);
    await expect(removeTitle(database.db, ownerId, first.slots[0].id)).rejects.toThrow(locked);
    expect(await order("hidden-machinery")).toEqual(before);
    expect((await getPathView(database.db, ownerId, "hidden-machinery"))!.title).toBe("Hidden Machinery");
    expect((await database.db.select().from(books)).some((b) => b.title === "A book of my own")).toBe(false);
  });

  it("a Path named Constructor is the reader's own, not a reading list", async () => {
    expect(isReadingList("hidden-machinery")).toBe(true);
    expect(starterPath("hidden-machinery")).toBe(hiddenMachinery);
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(isReadingList(name)).toBe(false);
      expect(starterPath(name)).toBeUndefined();
    }
    const path = await createPath(database.db, ownerId, { title: "Constructor" });
    expect(path.slug).toBe("constructor");
    const s = await addSection(database.db, ownerId, path.id, "One");
    await addTitle(database.db, ownerId, s.id, { title: "A" });
    expect(await order("constructor")).toEqual([["One", ["extra:A"]]]);
    expect((await getPathView(database.db, ownerId, "constructor"))!.readingList).toBe(false);
    expect((await listPathsWithProgress(database.db, ownerId)).find((p) => p.slug === "constructor")!.readingList).toBe(false);
  });

  it("finishes a section of plain titles in your own Path; Hidden Machinery's plain-only pillars are unchanged", async () => {
    await seedPath(database.db, ownerId, hiddenMachinery);
    const path = await createPath(database.db, ownerId, { title: "Constructor" }); // not a reading list, whatever `in` says
    const first = await addSection(database.db, ownerId, path.id, "First");
    const second = await addSection(database.db, ownerId, path.id, "Second");
    const a = await addTitle(database.db, ownerId, first.id, { title: "A plain one" });
    const b = await addTitle(database.db, ownerId, first.id, { title: "Another plain one" });
    const c = await addTitle(database.db, ownerId, second.id, { title: "Not started" });
    const replies = (await getPathView(database.db, ownerId, "hidden-machinery"))!.pillars.find((p) => p.slug === "from-the-replies")!;
    await database.db
      .update(books)
      .set({ progress: 1 })
      .where(inArray(books.id, [a.bookId, b.bookId, ...replies.slots.map((x) => x.book.id)]));
    const mine = (await getPathView(database.db, ownerId, path.slug))!;
    expect(mine.readingList).toBe(false);
    expect(mine.pillars.map((p) => [p.title, p.status, p.currentSlotId])).toEqual([
      ["First", "done", null],
      ["Second", "not-started", c.slotId],
    ]);
    expect(mine.currentPillarId).toBe(second.id);
    const hm = (await getPathView(database.db, ownerId, "hidden-machinery"))!;
    expect(hm.readingList).toBe(true);
    // Hidden Machinery's rule, kept on purpose: its extras are optional, so a finished plain-only pillar stays "reading".
    expect(hm.pillars.find((p) => p.slug === "from-the-replies")).toMatchObject({ status: "reading", currentSlotId: null });
    expect(hm.currentPillarId).toBe(replies.id);
  });

  it("gives Paths and sections made at the same moment with the same name different addresses", async () => {
    const made = await Promise.all([createPath(database.db, ownerId, { title: "Twice" }), createPath(database.db, ownerId, { title: "Twice" })]);
    expect(made.map((p) => p.slug).sort()).toEqual(["twice", "twice-2"]);
    const both = await Promise.all([addSection(database.db, ownerId, made[0].id, "Same"), addSection(database.db, ownerId, made[0].id, "Same")]);
    expect(new Set(both.map((x) => x.id)).size).toBe(2);
    expect((await getPathView(database.db, ownerId, made[0].slug))!.pillars.map((p) => p.slug).sort()).toEqual(["same", "same-2"]);
  });

  it("keeps a description's line breaks and tidies the rest", async () => {
    const path = await createPath(database.db, ownerId, {
      title: "Philosophy of science",
      description: "How science changes.\r\n\r\n\r\n  Kuhn,   then\tFeyerabend.  \r\nThen fiction.",
    });
    expect((await getPathView(database.db, ownerId, path.slug))!.description).toBe("How science changes.\n\nKuhn, then Feyerabend.\nThen fiction.");
    // The cap counts a line break once (a form sends CRLF), so a full box is not cut short.
    await renamePath(database.db, ownerId, path.id, { title: "P", description: `${"a".repeat(1000)}\r\n${"b".repeat(999)}` });
    expect((await getPathView(database.db, ownerId, path.slug))!.description).toBe(`${"a".repeat(1000)}\n${"b".repeat(999)}`);
    // A lone carriage return (text from an old Mac file) is a line break too, not a space.
    await renamePath(database.db, ownerId, path.id, { title: "P", description: "One.\rTwo." });
    expect((await getPathView(database.db, ownerId, path.slug))!.description).toBe("One.\nTwo.");
  });

  it("renamePath changes, keeps or clears the description", async () => {
    const path = await createPath(database.db, ownerId, { title: "Energy", description: "Grids." });
    const description = async () => (await getPathView(database.db, ownerId, path.slug))!.description;
    await renamePath(database.db, ownerId, path.id, { title: "Energy", description: "Grids.\r\nThen money." });
    expect(await description()).toBe("Grids.\nThen money.");
    await renamePath(database.db, ownerId, path.id, { title: "Energy and money" }); // left out: kept
    expect(await description()).toBe("Grids.\nThen money.");
    await renamePath(database.db, ownerId, path.id, { title: "Energy and money", description: null }); // missing from the form: kept
    expect(await description()).toBe("Grids.\nThen money.");
    await renamePath(database.db, ownerId, path.id, { title: "Energy and money", description: "  " }); // box emptied: cleared
    expect(await description()).toBe("");
    expect((await getPathView(database.db, ownerId, path.slug))!.title).toBe("Energy and money");
  });

  it("caps every text field on the server; a cut leaves no trailing space", async () => {
    const long = "x".repeat(500);
    const path = await createPath(database.db, ownerId, { title: long, description: "y".repeat(5000) });
    const s = await addSection(database.db, ownerId, path.id, long);
    await addTitle(database.db, ownerId, s.id, { title: long, author: long });
    const v = (await getPathView(database.db, ownerId, path.slug))!;
    expect([v.title.length, v.description.length, v.pillars[0].title.length, v.pillars[0].slots[0].book.title.length, v.pillars[0].slots[0].book.author.length]).toEqual([
      120, 2000, 120, 120, 120,
    ]);
    await renamePath(database.db, ownerId, path.id, { title: `${"x".repeat(119)} y` });
    expect((await getPathView(database.db, ownerId, path.slug))!.title).toBe("x".repeat(119));
  });

  it("refuses a section, title or Path name that is empty or only spaces", async () => {
    const path = await createPath(database.db, ownerId, { title: "Blank" });
    for (const blank of ["", "   ", " \n\t ", null, undefined]) {
      await expect(addSection(database.db, ownerId, path.id, blank)).rejects.toThrow("Give the section a name.");
    }
    expect((await getPathView(database.db, ownerId, path.slug))!.pillars).toEqual([]);
    const s = await addSection(database.db, ownerId, path.id, "One");
    await expect(addTitle(database.db, ownerId, s.id, { title: "  ", author: "Someone" })).rejects.toThrow("Give the title a name.");
    await expect(renamePath(database.db, ownerId, path.id, { title: " \n " })).rejects.toThrow("Give the path a name.");
  });

  it("joins a typed title to a library book only when the authors agree", async () => {
    await seedPath(database.db, ownerId, hiddenMachinery); // "The Grid" by "Bakke"
    const [gleick] = await database.db
      .insert(books)
      .values({ ownerId, title: "Chaos: Making a New Science", author: "James Gleick", fileKey: "books/c.epub", fileType: "epub" })
      .returning();
    const [santi] = await database.db.insert(books).values({ ownerId, title: "三体" }).returning();
    const path = await createPath(database.db, ownerId, { title: "Systems" });
    let n = 0; // a section per title: a section lists a book once (tested below)
    const add = async (title: string, author: string) =>
      addTitle(database.db, ownerId, (await addSection(database.db, ownerId, path.id, `S${(n += 1)}`)).id, { title, author });
    // Another author's book is another title, even when the short titles match.
    const smith = await add("Chaos: A Very Short Introduction", "Leonard Smith");
    expect(smith.reused).toBe(false);
    expect(smith.bookId).not.toBe(gleick.id);
    // The same author written another way is the same book, which keeps its own name.
    expect(await add("chaos", "Gleick, James")).toMatchObject({ bookId: gleick.id, reused: true, title: "Chaos: Making a New Science", author: "James Gleick" });
    expect((await add("The Grid", "Gretchen Bakke")).reused).toBe(true);
    expect(await add("The Grid", "Philip Schewe")).toMatchObject({ reused: false });
    // More than one could be meant: the reader is asked, not guessed for (and not asked for an author already typed).
    await expect(add("Chaos", "")).rejects.toThrow("More than one book in your library is called Chaos. Add the author");
    await expect(add("the grid", "")).rejects.toThrow("More than one book");
    const [smith2] = await database.db.insert(books).values({ ownerId, title: "Chaos: The Science of Predictable Random Motion", author: "Leonard A. Smith" }).returning();
    await expect(add("Chaos", "Smith")).rejects.toThrow("More than one book in your library could be Chaos by Smith. Choose it from your library.");
    expect(smith2.id).not.toBe(smith.bookId);
    // The whole title typed exactly picks one of them.
    expect(await add("Chaos: A Very Short Introduction", "")).toMatchObject({ bookId: smith.bookId, reused: true });
    // Titles with no Latin letters compare whole, not as an empty short title.
    expect(await add("量子", "")).toMatchObject({ reused: false });
    expect(await add("三体", "")).toMatchObject({ bookId: santi.id, reused: true });
    const all = await database.db.select().from(books);
    expect(all.filter((b) => normaliseTitle(b.title) === "chaos").map((b) => b.author).sort()).toEqual(["James Gleick", "Leonard A. Smith", "Leonard Smith"]);
    expect(all.filter((b) => normaliseTitle(b.title) === "the grid").map((b) => b.author).sort()).toEqual(["Bakke", "Philip Schewe"]);
  });
});

describe("sameAuthor", () => {
  it("compares surnames: case, accents, punctuation, order, initials and particles do not matter; a blank author agrees with any", () => {
    expect(sameAuthor("Gleick, James", "James Gleick")).toBe(true);
    expect(sameAuthor("Thomas S. Kuhn", "KUHN")).toBe(true);
    expect(sameAuthor("Kuhn, Thomas S.", "T. S. Kuhn")).toBe(true);
    expect(sameAuthor("Leibbrandt & de Terán", "Gottfried Leibbrandt")).toBe(true);
    expect(sameAuthor("Dietrich Dörner", "Dorner")).toBe(true);
    expect(sameAuthor("Brealey, Myers & Allen", "Richard Brealey")).toBe(true);
    expect(sameAuthor("Ursula K. Le Guin", "Le Guin, Ursula")).toBe(true);
    expect(sameAuthor("Mary Wollstonecraft Shelley", "Shelley, Mary")).toBe(true);
    expect(sameAuthor("", "James Gleick")).toBe(true);
    expect(sameAuthor("James Gleick", "Leonard Smith")).toBe(false);
    expect(sameAuthor("Leibbrandt & de Terán", "Jean de Florette")).toBe(false);
    expect(sameAuthor("Wu", "Xu")).toBe(false);
  });

  it("does not take a shared given name for the same author", () => {
    expect(sameAuthor("John Donne", "John Keats")).toBe(false);
    expect(sameAuthor("Dylan Thomas", "Thomas Hardy")).toBe(false);
    expect(sameAuthor("William Butler Yeats", "William Carlos Williams")).toBe(false);
    expect(sameAuthor("Tim Wu", "Tim Harford")).toBe(false);
  });
});

describe("sameBook", () => {
  it("keeps two volumes apart: two different subtitles are two books, one without a subtitle can be either", () => {
    const v1 = { title: "The Feynman Lectures on Physics: Volume I", author: "Richard P. Feynman" };
    expect(sameBook("The Feynman Lectures on Physics: Volume II", "Richard Feynman", v1)).toBe(false);
    expect(sameBook("The Feynman Lectures on Physics: Volume I", "", v1)).toBe(true);
    expect(sameBook("The Feynman Lectures on Physics", "Feynman", v1)).toBe(true);
    expect(sameBook("chaos", "Gleick, James", { title: "Chaos: Making a New Science", author: "James Gleick" })).toBe(true);
    expect(sameBook("Chaos: A Very Short Introduction", "", { title: "Chaos: Making a New Science", author: "James Gleick" })).toBe(false);
    expect(sameBook("三体", "", { title: "三体", author: "" })).toBe(true);
    expect(sameBook("量子", "", { title: "三体", author: "" })).toBe(false);
  });
});
