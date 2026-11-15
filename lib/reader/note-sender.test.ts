// The offline note outbox on the real code: lib/reader/note-sender.ts (what the reader page does) and lib/outbox.ts,
// over a small in-memory IndexedDB, sending to the library's real note routes on the unit tests' database. The fetch
// is the test's: it answers, fails ("no network"), loses the answer (the library acted, the page never hears) or holds
// the answer until the test releases it. Each test is one path the verify-outbox skill's model found (F1-F7 in
// .claude/skills/verify-outbox/SKILL.md), and checks that the reader's change ends up on the library, in order,
// under that reader.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const the = vi.hoisted(() => ({ who: null as { id: string } | null, db: undefined as unknown }));
vi.mock("@/lib/auth/session", () => ({ currentUser: async () => the.who }));
vi.mock("@/lib/db", () => ({ getDb: async () => the.db }));

import * as noteRoute from "@/app/api/annotations/[id]/route";
import * as restoreRoute from "@/app/api/annotations/[id]/restore/route";
import * as bookNotesRoute from "@/app/api/books/[id]/annotations/route";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { listAnnotations } from "@/lib/library/annotations";
import { importBook } from "@/lib/library/import";
import { outboxFor, type OutboxItem } from "@/lib/outbox";
import { MemoryStorage } from "@/lib/storage";
import { noteRequest, noteSender } from "./note-sender";

// ---- IndexedDB: one "outbox" store, keyPath "id"; each request finishes on a later turn, as in a browser.
const idb = new Map<string, OutboxItem>();
const later = (f: () => void) => setTimeout(f, 0);
function request<T>(work: () => T) {
  const req = { result: undefined as T | undefined, error: null as unknown, onsuccess: null as null | (() => void), onerror: null as null | (() => void) };
  later(() => {
    try {
      req.result = work();
      req.onsuccess?.();
    } catch (e) {
      req.error = e;
      req.onerror?.();
    }
  });
  return req;
}
const store = {
  put: (v: OutboxItem) => request(() => (idb.set(v.id, structuredClone(v)), v.id)),
  delete: (k: string) => request(() => void idb.delete(k)),
  get: (k: string) => request(() => (idb.has(k) ? structuredClone(idb.get(k)!) : undefined)),
  getAll: () => request(() => [...idb.keys()].sort().map((k) => structuredClone(idb.get(k)!))),
};
const database = { createObjectStore: () => store, transaction: () => ({ objectStore: () => store }), close: () => {} };
globalThis.indexedDB = {
  open: () => {
    const req = { result: database, error: null, onupgradeneeded: null, onsuccess: null as null | (() => void), onerror: null };
    later(() => req.onsuccess?.());
    return req;
  },
} as unknown as IDBFactory;

// ---- The network and the library.
type Way = "answer" | "offline" | "lose" | "hold";
let ways: Way[] = []; // how the next requests go, in order; after that, "answer" (or "offline" while offline)
let offline = false;
let held: (() => void)[] = [];
let sent: { method: string; path: string; as: string | null; status: number }[] = [];

async function library(url: string, init: RequestInit): Promise<Response> {
  const u = new URL(url, "http://library.test");
  const req = new Request(u, init);
  const at = (id: string) => ({ params: Promise.resolve({ id }) });
  let m: RegExpMatchArray | null;
  if ((m = u.pathname.match(/^\/api\/books\/([^/]+)\/annotations$/))) return bookNotesRoute.POST(req, at(m[1]));
  if ((m = u.pathname.match(/^\/api\/annotations\/([^/]+)\/restore$/))) return restoreRoute.POST(req, at(m[1]));
  if ((m = u.pathname.match(/^\/api\/annotations\/([^/]+)$/))) return init.method === "PATCH" ? noteRoute.PATCH(req, at(m[1])) : noteRoute.DELETE(req, at(m[1]));
  throw new Error(`no route for ${init.method} ${url}`);
}

globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
  const way = ways.shift() ?? (offline ? "offline" : "answer");
  if (way === "offline") throw new TypeError("Failed to fetch");
  const res = await library(String(url), init);
  sent.push({ method: init.method ?? "GET", path: String(url), as: the.who?.id ?? null, status: res.status });
  if (way === "lose") throw new TypeError("Failed to fetch");
  if (way === "hold") return new Promise<Response>((resolve) => held.push(() => resolve(res)));
  return res;
}) as typeof fetch;

const until = async (done: () => boolean) => {
  for (let i = 0; i < 1000 && !done(); i++) await new Promise((r) => setTimeout(r, 1));
  if (!done()) throw new Error("the test waited too long");
};
const release = () => held.shift()!();

/** One open reader page of `readerId` on `bookId`, as useNotes.ts drives the sender. */
function page(readerId: string, bookId: string) {
  const s = noteSender(readerId, bookId);
  return {
    ...s,
    // Every caller of create() reloads after it (Reader.tsx highlight(), addBookNote()).
    create: async (body: Record<string, unknown>) => {
      const { id } = await s.create(body);
      await s.waiting();
      return { id };
    },
    edit: async (a: { id: string }, words: string) => {
      await s.edit(a, words);
      await s.waiting();
    },
    remove: async (a: { id: string }) => {
      const undo = await s.remove(a);
      await s.waiting();
      return undo;
    },
    // The sync effect: flush, then reload.
    sync: async () => {
      await s.flush().catch(() => ({ sent: 0 }));
      await s.waiting();
    },
  };
}

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
  the.who = { id: A };
  idb.clear();
  ways = [];
  offline = false;
  held = [];
  sent = [];
});
afterEach(() => db.raw.close());

describe("a note whose create may already be on the library", () => {
  it("F1: new words given to a note whose create answer was lost reach the library", async () => {
    const you = page(A, bookId);
    ways = ["lose"]; // the library stores the note; its answer never arrives, so create() keeps it in the outbox
    const a = await you.create({ kind: "note", body: "First words." });
    await you.edit(a, "Second words.");
    await you.sync();
    expect((await onLibrary(a.id))?.body).toBe("Second words.");
    expect(await outboxFor(A)).toEqual([]);
  });

  it("F1: new words given while a flush is sending the note written offline reach the library", async () => {
    const you = page(A, bookId);
    offline = true;
    const a = await you.create({ kind: "note", body: "First words." });
    offline = false;
    ways = ["hold"];
    const flushing = you.flush(); // sends the create with "First words."; its answer waits
    await until(() => held.length === 1);
    await you.edit(a, "Second words.");
    release();
    await flushing;
    await you.sync();
    expect((await onLibrary(a.id))?.body).toBe("Second words.");
    expect(await outboxFor(A)).toEqual([]);
  });

  it("F2: a note removed after its create answer was lost leaves the library", async () => {
    const you = page(A, bookId);
    ways = ["lose"];
    const a = await you.create({ kind: "note", body: "Remove me." });
    await you.remove(a);
    await you.sync();
    expect(await onLibrary(a.id)).toBeUndefined();
    expect(await outboxFor(A)).toEqual([]);
  });

  it("F2: a note removed while a flush is sending it leaves the library", async () => {
    const you = page(A, bookId);
    offline = true;
    const a = await you.create({ kind: "note", body: "Remove me." });
    offline = false;
    ways = ["hold"];
    const flushing = you.flush();
    await until(() => held.length === 1);
    await you.remove(a);
    release();
    await flushing;
    await you.sync();
    expect(await onLibrary(a.id)).toBeUndefined();
    expect(await outboxFor(A)).toEqual([]);
  });

  it("a note written and removed offline, then brought back with Undo, is on the library once", async () => {
    const you = page(A, bookId);
    offline = true;
    const a = await you.create({ kind: "note", body: "Back again." });
    const undo = await you.remove(a);
    await undo();
    offline = false;
    await you.sync();
    expect((await onLibrary(a.id))?.body).toBe("Back again.");
    expect(await outboxFor(A)).toEqual([]);
  });
});

describe("Undo of a removal the library may already have", () => {
  it("F3: Undo after the removal's answer was lost brings the note back", async () => {
    const you = page(A, bookId);
    const a = await you.create({ kind: "note", body: "Bring me back." });
    ways = ["lose"]; // the library removes it; the answer is lost, so the removal waits
    const undo = await you.remove(a);
    await undo();
    await you.sync();
    expect((await onLibrary(a.id))?.body).toBe("Bring me back.");
    expect(await outboxFor(A)).toEqual([]);
  });

  it("F3: Undo while a flush is sending the removal made offline brings the note back", async () => {
    const you = page(A, bookId);
    const a = await you.create({ kind: "note", body: "Bring me back." });
    offline = true;
    const undo = await you.remove(a);
    offline = false;
    ways = ["hold"];
    const flushing = you.flush(); // the library removes the note; the answer is on its way
    await until(() => held.length === 1);
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
    offline = true;
    await you.edit(a, "Words two, offline.");
    offline = false; // the browser did not notice: no "online" event, so nothing has flushed yet
    await you.edit(a, "Words three.");
    await you.sync(); // the 30 s timer
    expect((await onLibrary(a.id))?.body).toBe("Words three.");
    expect(await outboxFor(A)).toEqual([]);
  });
});
