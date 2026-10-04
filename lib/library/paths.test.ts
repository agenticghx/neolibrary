import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hiddenMachinery } from "@/data/paths/hidden-machinery";
import type { Database } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { createFirstAdmin, createInvite, acceptInvite } from "@/lib/auth/service";
import { choosePillar, getBook, getPathView, normaliseTitle, pillarProgress, seedPath, type SlotView } from "./paths";

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
    expect(view.owned).toBe(0);
    expect(view.wanted).toBeGreaterThan(100);
  });

  it("is idempotent and attaches to a book the user already owns", async () => {
    const [mine] = await database.db
      .insert(books)
      .values({ ownerId, title: "Chip War: The Fight for the World's Most Critical Technology", author: "Chris Miller", fileKey: "books/x.epub", fileType: "epub" })
      .returning();
    const first = await seedPath(database.db, ownerId, hiddenMachinery);
    const again = await seedPath(database.db, ownerId, hiddenMachinery);
    expect(again).toBe(first);
    const view = (await getPathView(database.db, ownerId, "hidden-machinery"))!;
    const semis = view.pillars.find((p) => p.slug === "semiconductors")!;
    expect(semis.slots[0].book).toMatchObject({ id: mine.id, owned: true });
    expect(view.owned).toBe(1);
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
    book: { id, title: id, author: "", progress, unverified: false, owned: true },
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
