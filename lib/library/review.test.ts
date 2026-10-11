import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { createAnnotation, deleteAnnotation, restoreAnnotation, updateAnnotation } from "./annotations";
import { importBook } from "./import";
import { removeBook, restoreBook } from "./remove-book";
import { dueCount, rateCard, reviewQueue, ReviewError } from "./review";
import { getSections } from "./sections-store";

let database: Database;
let ownerId: string;
let bookId: string;
let paras: { id: string; cfi: string; text: string }[];

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const bytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "j.epub", bytes })).bookId;
  paras = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph");
});
afterEach(() => database.raw.close());

const rangeIn = (p: { cfi: string }, from: number, to: number) => p.cfi.replace(/\)$/, `,/1:${from},/1:${to})`);
const at = (iso: string) => new Date(iso);
const DAY0 = at("2026-10-11T09:00:00Z");

/** A highlight on paragraph `i`, made at `when`, with an optional note. */
const highlight = (i: number, when: Date, body = "") =>
  createAnnotation(database.db, ownerId, { kind: "highlight", bookId, cfi: rangeIn(paras[i], 0, 12), quote: { exact: paras[i].text.slice(0, 12) }, body }, when);

describe("Daily review cards", () => {
  it("highlights and notes on passages, and notes on the whole book, are cards; bookmarks and removed notes are not", async () => {
    const h = await highlight(40, at("2026-10-01T10:00:00Z"), "Utterson is the lawyer");
    const n = await createAnnotation(database.db, ownerId, { kind: "note", bookId, body: "The whole book is about a double life" }, at("2026-10-02T10:00:00Z"));
    await createAnnotation(database.db, ownerId, { kind: "bookmark", bookId, cfi: paras[41].cfi }, at("2026-10-03T10:00:00Z"));
    const gone = await highlight(42, at("2026-10-04T10:00:00Z"));
    await deleteAnnotation(database.db, ownerId, gone.id);

    const q = await reviewQueue(database.db, ownerId, DAY0);
    expect(q.cards.map((c) => c.id)).toEqual([h.id, n.id]);
    expect(q.total).toBe(2);
    expect(q.cards[0]).toMatchObject({
      kind: "highlight",
      on: "passage",
      bookId,
      bookTitle: expect.stringMatching(/^The Strange Case/),
      cfi: rangeIn(paras[40], 0, 12),
      quote: paras[40].text.slice(0, 12),
      note: "Utterson is the lawyer",
      isNew: true,
      dueAt: null,
      next: { again: 0, hard: 1, good: 1, easy: 4 },
    });
    expect(q.cards[0].chapter).not.toBe("");
    expect(q.cards[1]).toMatchObject({ kind: "note", on: "book", cfi: null, quote: "", note: "The whole book is about a double life" });

    // A removed note brought back is a card again; its latest words are shown.
    await restoreAnnotation(database.db, ownerId, gone.id);
    await updateAnnotation(database.db, ownerId, h.id, { body: "Utterson, the lawyer" });
    const again = await reviewQueue(database.db, ownerId, DAY0);
    expect(again.cards.map((c) => c.id)).toEqual([h.id, n.id, gone.id]);
    expect(again.cards[0].note).toBe("Utterson, the lawyer");
  });

  it("a book removed from the library takes its cards with it, and brings them back with it", async () => {
    await highlight(40, at("2026-10-01T10:00:00Z"));
    await removeBook(database.db, ownerId, bookId);
    expect(await reviewQueue(database.db, ownerId, DAY0)).toEqual({ cards: [], nextDueAt: null, total: 0 });
    await restoreBook(database.db, ownerId, bookId);
    expect((await reviewQueue(database.db, ownerId, DAY0)).cards).toHaveLength(1);
  });

  it("a rated card leaves today's queue until its day comes; Again keeps it today", async () => {
    const a = await highlight(40, at("2026-10-01T10:00:00Z"));
    const b = await highlight(41, at("2026-10-02T10:00:00Z"));
    expect(await dueCount(database.db, ownerId, DAY0)).toBe(2);

    const s = await rateCard(database.db, ownerId, a.id, "good", DAY0);
    expect(s).toMatchObject({ intervalDays: 1, reps: 1, dueAt: at("2026-10-12T00:00:00Z") });
    await rateCard(database.db, ownerId, b.id, "again", DAY0);
    let q = await reviewQueue(database.db, ownerId, DAY0);
    expect(q.cards.map((c) => [c.id, c.isNew])).toEqual([[b.id, false]]);
    expect(q.nextDueAt).toBe("2026-10-12T00:00:00.000Z");

    await rateCard(database.db, ownerId, b.id, "easy", at("2026-10-11T09:05:00Z"));
    q = await reviewQueue(database.db, ownerId, at("2026-10-11T09:06:00Z"));
    expect(q).toEqual({ cards: [], nextDueAt: "2026-10-12T00:00:00.000Z", total: 2 });

    // The next day, the Good card is back; the Easy one waits.
    q = await reviewQueue(database.db, ownerId, at("2026-10-12T08:00:00Z"));
    expect(q.cards.map((c) => [c.id, c.isNew, c.next.good])).toEqual([[a.id, false, 6]]);
    await rateCard(database.db, ownerId, a.id, "good", at("2026-10-12T08:00:00Z"));
    expect((await reviewQueue(database.db, ownerId, at("2026-10-12T08:01:00Z"))).nextDueAt).toBe("2026-10-15T00:00:00.000Z");
  });

  it("introduces at most 20 new cards a day, oldest first, after the cards due", async () => {
    const made = [];
    for (let i = 0; i < 23; i++) made.push(await highlight(40 + i, new Date(at("2026-10-01T00:00:00Z").getTime() + i * 60_000)));
    let q = await reviewQueue(database.db, ownerId, DAY0);
    expect(q.cards.map((c) => c.id)).toEqual(made.slice(0, 20).map((m) => m.id));
    expect(q.nextDueAt).toBe("2026-10-12T00:00:00.000Z"); // the three held back
    for (const m of made.slice(0, 5)) await rateCard(database.db, ownerId, m.id, "good", DAY0);
    q = await reviewQueue(database.db, ownerId, DAY0);
    // Five introduced today: fifteen more new ones, not twenty.
    expect(q.cards.map((c) => c.id)).toEqual(made.slice(5, 20).map((m) => m.id));
    // The next day: the five due first, then the next new ones.
    q = await reviewQueue(database.db, ownerId, at("2026-10-12T09:00:00Z"));
    expect(q.cards.slice(0, 5).map((c) => c.isNew)).toEqual([false, false, false, false, false]);
    expect(q.cards.slice(5).map((c) => c.id)).toEqual(made.slice(5, 23).map((m) => m.id));
  });

  it("refuses another reader's card, a removed note, a bookmark and an unknown rating", async () => {
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const otherId = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
    const a = await highlight(40, DAY0);
    const mark = await createAnnotation(database.db, ownerId, { kind: "bookmark", bookId, cfi: paras[41].cfi });
    await expect(rateCard(database.db, otherId, a.id, "good", DAY0)).rejects.toThrow(ReviewError);
    await expect(rateCard(database.db, ownerId, a.id, "perfect", DAY0)).rejects.toThrow("Rate it Again, Hard, Good or Easy.");
    await expect(rateCard(database.db, ownerId, "not-an-id", "good", DAY0)).rejects.toThrow("Card not found.");
    await expect(rateCard(database.db, ownerId, mark.id, "good", DAY0)).rejects.toThrow("Card not found.");
    await deleteAnnotation(database.db, ownerId, a.id);
    await expect(rateCard(database.db, ownerId, a.id, "good", DAY0)).rejects.toThrow("Card not found.");
    expect(await dueCount(database.db, otherId, DAY0)).toBe(0);
  });
});
