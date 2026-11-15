// The offline note outbox on the real code: lib/reader/note-sender.ts (what the reader page does) and lib/outbox.ts,
// in a pretend browser (./outbox-test-kit.ts) whose requests go to the library's real note routes on the unit tests'
// database. Each test is one path the verify-outbox skill's model found (F1-F8 in
// .claude/skills/verify-outbox/SKILL.md), and checks that the reader's change ends up on the library, in order,
// under that reader.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const the = vi.hoisted(() => ({ db: undefined as unknown }));
// Who is signed in: the pretend browser's one cookie (read when asked, so the mock imports nothing).
vi.mock("@/lib/auth/session", () => ({ currentUser: async () => signedIn() }));
vi.mock("@/lib/db", () => ({ getDb: async () => the.db }));

import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { listAnnotations } from "@/lib/library/annotations";
import { importBook } from "@/lib/library/import";
import { outboxFor } from "@/lib/outbox";
import { MemoryStorage } from "@/lib/storage";
import { noteRequest, noteSender } from "./note-sender";
import { browser, page, release, resetBrowser, signedIn, until } from "./outbox-test-kit";

const { idb } = browser;

// ---- Two readers, A and B, each with a book.
let db: Database;
let A: string;
let B: string;
let bookId: string;
let bBook: string;
const onLibrary = async (id: string) => (await listAnnotations(db.db, A, bookId)).find((a) => a.id === id);
const jekyll = () => new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));

beforeEach(async () => {
  db = await testDatabase();
  the.db = db.db;
  A = (await createFirstAdmin(db.db, { email: "a@example.com", name: "A", password: "long enough pw" })).id;
  const { token } = await createInvite(db.db, { id: A, email: "a@example.com", name: "A", role: "admin" });
  B = (await acceptInvite(db.db, token, { email: "b@example.com", name: "B", password: "long enough pw" })).id;
  bookId = (await importBook(db.db, new MemoryStorage(), A, { name: "j.epub", bytes: jekyll() })).bookId;
  bBook = (await importBook(db.db, new MemoryStorage(), B, { name: "j.epub", bytes: jekyll() })).bookId;
  resetBrowser();
  browser.who = { id: A };
});
afterEach(() => db.raw.close());

describe("a note whose create may already be on the library", () => {
  it("F1: new words given to a note whose create answer was lost reach the library", async () => {
    const you = page(A, bookId);
    browser.ways = ["lose"]; // the library stores the note; its answer never arrives, so create() keeps it in the outbox
    const a = await you.create({ kind: "note", body: "First words." });
    await you.edit(a, "Second words.");
    await you.sync();
    expect((await onLibrary(a.id))?.body).toBe("Second words.");
    expect(await outboxFor(A)).toEqual([]);
  });

  it("F1: new words given while a flush is sending the note written offline reach the library", async () => {
    const you = page(A, bookId);
    browser.offline = true;
    const a = await you.create({ kind: "note", body: "First words." });
    browser.offline = false;
    browser.ways = ["hold"];
    const flushing = you.flush(); // sends the create with "First words."; its answer waits
    await until(() => browser.held.length === 1);
    await you.edit(a, "Second words.");
    release();
    await flushing;
    await you.sync();
    expect((await onLibrary(a.id))?.body).toBe("Second words.");
    expect(await outboxFor(A)).toEqual([]);
  });

  it("F2: a note removed after its create answer was lost leaves the library", async () => {
    const you = page(A, bookId);
    browser.ways = ["lose"];
    const a = await you.create({ kind: "note", body: "Remove me." });
    await you.remove(a);
    await you.sync();
    expect(await onLibrary(a.id)).toBeUndefined();
    expect(await outboxFor(A)).toEqual([]);
  });

  it("F2: a note removed while a flush is sending it leaves the library", async () => {
    const you = page(A, bookId);
    browser.offline = true;
    const a = await you.create({ kind: "note", body: "Remove me." });
    browser.offline = false;
    browser.ways = ["hold"];
    const flushing = you.flush();
    await until(() => browser.held.length === 1);
    await you.remove(a);
    release();
    await flushing;
    await you.sync();
    expect(await onLibrary(a.id)).toBeUndefined();
    expect(await outboxFor(A)).toEqual([]);
  });

  it("a note written and removed offline, then brought back with Undo, is on the library once", async () => {
    const you = page(A, bookId);
    browser.offline = true;
    const a = await you.create({ kind: "note", body: "Back again." });
    const undo = await you.remove(a);
    await undo();
    browser.offline = false;
    await you.sync();
    expect((await onLibrary(a.id))?.body).toBe("Back again.");
    expect(await outboxFor(A)).toEqual([]);
  });
});

describe("Undo of a removal the library may already have", () => {
  it("F3: Undo after the removal's answer was lost brings the note back", async () => {
    const you = page(A, bookId);
    const a = await you.create({ kind: "note", body: "Bring me back." });
    browser.ways = ["lose"]; // the library removes it; the answer is lost, so the removal waits
    const undo = await you.remove(a);
    await undo();
    await you.sync();
    expect((await onLibrary(a.id))?.body).toBe("Bring me back.");
    expect(await outboxFor(A)).toEqual([]);
  });

  it("F3: Undo while a flush is sending the removal made offline brings the note back", async () => {
    const you = page(A, bookId);
    const a = await you.create({ kind: "note", body: "Bring me back." });
    browser.offline = true;
    const undo = await you.remove(a);
    browser.offline = false;
    browser.ways = ["hold"];
    const flushing = you.flush(); // the library removes the note; the answer is on its way
    await until(() => browser.held.length === 1);
    await undo();
    release();
    await flushing;
    await you.sync();
    expect((await onLibrary(a.id))?.body).toBe("Bring me back.");
    expect(await outboxFor(A)).toEqual([]);
  });
});

describe("the order of changes", () => {
  it("F4: an older edit waiting offline does not replace a newer edit made once the network is back", async () => {
    const you = page(A, bookId);
    const a = await you.create({ kind: "note", body: "Words one." });
    browser.offline = true;
    await you.edit(a, "Words two, offline.");
    browser.offline = false; // the browser did not notice: no "online" event, so nothing has flushed yet
    await you.edit(a, "Words three.");
    await you.sync(); // the 30 s timer
    expect((await onLibrary(a.id))?.body).toBe("Words three.");
    expect(await outboxFor(A)).toEqual([]);
  });
});

describe("two readers on one browser", () => {
  it("F5: a page of A's left open after B signs in keeps A's note waiting, then sends it once A is back", async () => {
    const you = page(A, bookId);
    browser.offline = true;
    const a = await you.create({ kind: "note", body: "Written on the train." });
    browser.offline = false;
    browser.who = null; // A signs out in another tab (signOutAction): the open page is not told
    browser.who = { id: B }; // B signs in on the same browser
    await you.sync(); // A's page flushes (the 30 s timer)
    // Nothing of A's is stored or refused under B's sign-in.
    expect(browser.sent.filter((s) => s.as === B).every((s) => s.status === 401)).toBe(true);
    const [item] = await outboxFor(A);
    expect(item).toMatchObject({ id: a.id, owner: A });
    expect(item.refused).toBeUndefined();
    browser.who = { id: A }; // A signs in again
    await you.sync();
    expect((await onLibrary(a.id))?.body).toBe("Written on the train.");
    expect(await outboxFor(A)).toEqual([]);
  });

  it("F5: a change made on A's page while B is signed in is not stored under B", async () => {
    const you = page(A, bookId);
    const a = await you.create({ kind: "note", body: "Mine." });
    browser.who = { id: B };
    await expect(you.edit(a, "Still mine.")).rejects.toThrow();
    expect(browser.sent.at(-1)).toMatchObject({ as: B, status: 401 });
    browser.who = { id: A };
    expect((await onLibrary(a.id))?.body).toBe("Mine.");
  });

  it("F6: an item of A's saved before owners were recorded is left alone by B's page and sent by A's", async () => {
    const you = page(A, bookId);
    const a = await you.create({ kind: "note", body: "Saved." });
    // An edit A queued before owners were recorded (before 2026-11-10): no owner.
    const old = "0f0f0f0f-0000-4000-8000-000000000001";
    idb.set(old, { id: old, op: "edit", annotationId: a.id, bookId, body: { body: "Old offline words." }, savedAt: "2026-11-01T10:00:00.000Z" });
    browser.who = { id: B };
    await page(B, bBook).sync(); // B's page, on B's own book
    expect(browser.sent.filter((s) => s.method === "PATCH")).toEqual([]);
    expect(idb.get(old)?.owner).toBeUndefined();
    expect(idb.get(old)?.refused).toBeUndefined();
    expect(await outboxFor(B, bBook)).toEqual([]); // B's page does not show it
    browser.who = { id: A };
    await you.sync(); // A's page of that book sends it
    expect((await onLibrary(a.id))?.body).toBe("Old offline words.");
    expect(idb.size).toBe(0);
  });
});

describe("two tabs of one reader", () => {
  it("F7: a tab whose list was read before another tab's refusal does not send the refused change again", async () => {
    const you = page(A, bookId);
    const kept = await you.create({ kind: "note", body: "Kept." });
    const gone = await you.create({ kind: "note", body: "Gone." });
    browser.offline = true;
    await you.edit(kept, "Kept, edited offline.");
    await you.edit(gone, "Gone, edited offline.");
    browser.offline = false;
    await noteRequest(A, `/api/annotations/${gone.id}?changeId=${crypto.randomUUID()}`, "DELETE"); // removed elsewhere: its edit will be refused
    const goneEdit = (await outboxFor(A)).find((w) => w.annotationId === gone.id)!;
    browser.ways = ["hold"];
    const secondTab = noteSender(A, bookId).flush(); // reads both edits; its first request waits for its answer
    await until(() => browser.held.length === 1);
    await you.flush(); // the first tab sends both: the edit of the removed note is refused and kept
    expect((await outboxFor(A)).find((w) => w.id === goneEdit.id)?.refused?.status).toBe(404);
    const before = browser.sent.filter((s) => s.path.includes(gone.id)).length;
    release();
    await secondTab;
    expect(browser.sent.filter((s) => s.path.includes(gone.id)).length).toBe(before);
    expect((await outboxFor(A)).find((w) => w.id === goneEdit.id)?.refused?.status).toBe(404); // still kept and shown
  });
});
