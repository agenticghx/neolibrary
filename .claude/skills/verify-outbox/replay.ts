// Replays the bug path of each known finding in SKILL.md on the real code:
// - lib/outbox.ts as it is, over a small in-memory IndexedDB;
// - the library's real route handlers and lib/library/annotations.ts, on the unit tests' database;
// - a fetch the replay answers, drops ("the network fails"), loses ("the library did it, the answer is lost")
//   or holds (the library did it, the answer arrives when the replay says).
// The reader's side, useNotes.ts, is a React hook, so `page()` below makes its calls to lib/outbox.ts in the
// same order (line numbers at the sync commit in SKILL.md). Each test passes while its bug is there; when a fix
// lands, the test fails, and the finding's entry in SKILL.md and check.sh must change with it.
// Run: npx vitest run --config .claude/skills/verify-outbox/replay.config.mts
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
import { addToOutbox, flushOutbox, isOffline, opOf, outboxFor, removeFromOutbox, type OutboxItem } from "@/lib/outbox";
import { MemoryStorage } from "@/lib/storage";

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
let sent: { method: string; path: string; as: string | null }[] = [];

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
  sent.push({ method: init.method ?? "GET", path: String(url), as: the.who?.id ?? null });
  const res = await library(String(url), init);
  if (way === "lose") throw new TypeError("Failed to fetch");
  if (way === "hold") return new Promise<Response>((resolve) => held.push(() => resolve(res)));
  return res;
}) as typeof fetch;

const until = async (done: () => boolean) => {
  for (let i = 0; i < 1000 && !done(); i++) await new Promise((r) => setTimeout(r, 1));
  if (!done()) throw new Error("the replay waited too long");
};
const release = () => held.shift()!();

// api() in app/(reader)/books/[id]/read/reader-helpers.ts, lines 283-287 (copied: that module loads the reader's CSS).
const api = async (url: string, method: string, body?: unknown) => {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Not saved");
  return res.status === 204 ? null : res.json();
};

/** One open reader page of `readerId` on book `bookId`: the calls useNotes.ts makes, in its order. */
function page(readerId: string, bookId: string) {
  let madeOffline = new Set<string>();
  // reload() and withOutbox(), lines 67-100: madeOffline is the creates still waiting, not refused.
  const reload = async () => {
    const waiting = await outboxFor(readerId, bookId).catch(() => [] as OutboxItem[]);
    madeOffline = new Set(waiting.filter((w) => !w.refused && opOf(w) === "create").map((w) => w.id));
  };
  // change(), lines 113-125.
  const change = async (a: { id: string }, op: "edit" | "remove" | "restore", body: Record<string, unknown> = {}) => {
    const changeId = crypto.randomUUID();
    try {
      if (op === "edit") await api(`/api/annotations/${a.id}`, "PATCH", { ...body, changeId });
      else if (op === "restore") await api(`/api/annotations/${a.id}/restore?changeId=${changeId}`, "POST");
      else await api(`/api/annotations/${a.id}?changeId=${changeId}`, "DELETE");
      return { changeId, queued: false };
    } catch (e) {
      if (!isOffline(e)) throw e;
      await addToOutbox(readerId, { id: changeId, op, annotationId: a.id, bookId, body, savedAt: new Date().toISOString() });
      return { changeId, queued: true };
    }
  };
  // waitingCreate(), lines 132-133.
  const waitingCreate = async (id: string) =>
    madeOffline.has(id) ? (await outboxFor(readerId, bookId).catch(() => [] as OutboxItem[])).find((w) => w.id === id && opOf(w) === "create") : undefined;
  return {
    reload,
    // create(), lines 140-149; every caller then reloads (Reader.tsx highlight(), addBookNote()).
    create: async (body: Record<string, unknown>) => {
      const id = crypto.randomUUID();
      try {
        await api(`/api/books/${bookId}/annotations`, "POST", { ...body, id });
      } catch (e) {
        if (!isOffline(e)) throw e;
        await addToOutbox(readerId, { id, bookId, body, savedAt: new Date().toISOString() });
      }
      await reload();
      return { id };
    },
    // saveNote(), lines 176-182.
    saveNote: async (a: { id: string }, body: string) => {
      const waiting = await waitingCreate(a.id);
      if (waiting) await addToOutbox(readerId, { ...waiting, body: { ...waiting.body, body } });
      else await change(a, "edit", { body });
      await reload();
    },
    // removeNote(), lines 195-209: returns its Undo.
    removeNote: async (a: { id: string }) => {
      let undo: () => Promise<void>;
      const waiting = await waitingCreate(a.id);
      if (waiting) {
        for (const w of await outboxFor(readerId, bookId)) if (w.id === a.id || w.annotationId === a.id) await removeFromOutbox(w.id);
        undo = () => addToOutbox(readerId, waiting);
      } else {
        const { changeId, queued } = await change(a, "remove");
        undo = async () => {
          if (queued && (await outboxFor(readerId, bookId).catch(() => [] as OutboxItem[])).some((w) => w.id === changeId)) await removeFromOutbox(changeId);
          else await change(a, "restore", { annotation: a });
        };
      }
      await reload();
      return undo;
    },
    // The sync effect, lines 157-162.
    sync: async () => {
      await flushOutbox(readerId).catch(() => ({ sent: 0 }));
      await reload();
    },
  };
}

// ---- Two readers, A and B; A has a book.
let db: Database;
let A: string;
let B: string;
let bookId: string;
const onLibrary = async (id: string) => (await listAnnotations(db.db, A, bookId)).find((a) => a.id === id);
const waitingFor = (reader: string) => outboxFor(reader);

beforeEach(async () => {
  db = await testDatabase();
  the.db = db.db;
  A = (await createFirstAdmin(db.db, { email: "a@example.com", name: "A", password: "long enough pw" })).id;
  const { token } = await createInvite(db.db, { id: A, email: "a@example.com", name: "A", role: "admin" });
  B = (await acceptInvite(db.db, token, { email: "b@example.com", name: "B", password: "long enough pw" })).id;
  const bytes = new Uint8Array(readFileSync(new URL("../../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(db.db, new MemoryStorage(), A, { name: "j.epub", bytes })).bookId;
  the.who = { id: A };
  idb.clear();
  ways = [];
  offline = false;
  held = [];
  sent = [];
});
afterEach(() => db.raw.close());

describe("verify-outbox findings, replayed on the real code", () => {
  it("F1: new words given to a waiting note are lost when the library already has the note (its answer was lost)", async () => {
    const you = page(A, bookId);
    ways = ["lose"]; // the library stores the note; its answer never arrives, so create() queues it
    const a = await you.create({ kind: "note", body: "First words." });
    await you.saveNote(a, "Second words."); // waitingCreate() finds the queued create: the new words go into it
    expect((await waitingFor(A))[0].body.body).toBe("Second words.");
    await you.sync(); // the library answers 200 with the stored note; flushOutbox removes the item
    expect((await onLibrary(a.id))?.body).toBe("First words.");
    expect(await waitingFor(A)).toEqual([]); // "Second words." are nowhere
  });

  it("F1: the same while a flush is sending the note written offline", async () => {
    const you = page(A, bookId);
    offline = true;
    const a = await you.create({ kind: "note", body: "First words." });
    offline = false;
    ways = ["hold"];
    const flushing = flushOutbox(A); // reads the outbox, sends the create with "First words."
    await until(() => held.length === 1);
    await you.saveNote(a, "Second words."); // the create is still in the outbox: the new words go into it
    release();
    await flushing; // res.ok: removeFromOutbox(item.id) deletes the item that now holds "Second words."
    expect((await onLibrary(a.id))?.body).toBe("First words.");
    expect(await waitingFor(A)).toEqual([]);
  });

  it("F2: a note removed while the library already has it stays on the library (its answer was lost)", async () => {
    const you = page(A, bookId);
    ways = ["lose"];
    const a = await you.create({ kind: "note", body: "Remove me." });
    await you.removeNote(a); // waitingCreate() finds it: removeNote only drops it from the outbox
    expect(await waitingFor(A)).toEqual([]);
    expect((await onLibrary(a.id))?.body).toBe("Remove me.");
  });

  it("F2: the same while a flush is sending the note written offline", async () => {
    const you = page(A, bookId);
    offline = true;
    const a = await you.create({ kind: "note", body: "Remove me." });
    offline = false;
    ways = ["hold"];
    const flushing = flushOutbox(A);
    await until(() => held.length === 1);
    await you.removeNote(a);
    release();
    await flushing;
    expect(await waitingFor(A)).toEqual([]);
    expect((await onLibrary(a.id))?.body).toBe("Remove me.");
  });

  it("F3: Undo of a removal the library already took leaves the note removed (its answer was lost)", async () => {
    const you = page(A, bookId);
    const a = await you.create({ kind: "note", body: "Bring me back." });
    ways = ["lose"]; // the library removes it; the answer is lost, so change() queues the removal
    const undo = await you.removeNote(a);
    expect((await waitingFor(A)).map((w) => w.op)).toEqual(["remove"]);
    await undo(); // "queued" and still in the outbox: Undo only takes the removal back out
    await you.sync();
    expect(await onLibrary(a.id)).toBeUndefined();
    expect(await waitingFor(A)).toEqual([]);
  });

  it("F3: the same while a flush is sending the removal made offline", async () => {
    const you = page(A, bookId);
    const a = await you.create({ kind: "note", body: "Bring me back." });
    offline = true;
    const undo = await you.removeNote(a);
    offline = false;
    ways = ["hold"];
    const flushing = flushOutbox(A); // the library removes the note; the answer is on its way
    await until(() => held.length === 1);
    await undo();
    release();
    await flushing;
    expect(await onLibrary(a.id)).toBeUndefined();
    expect(await waitingFor(A)).toEqual([]);
  });

  it("F4: an older edit waiting offline replaces a newer edit sent directly", async () => {
    const you = page(A, bookId);
    const a = await you.create({ kind: "note", body: "Words one." });
    offline = true;
    await you.saveNote(a, "Words two, offline."); // change() queues the edit
    offline = false; // the browser did not notice: no "online" event, so nothing flushes yet
    await you.saveNote(a, "Words three."); // sent directly and stored
    expect((await onLibrary(a.id))?.body).toBe("Words three.");
    await you.sync(); // the 30 s timer: the older edit goes out and becomes the newest version
    expect((await onLibrary(a.id))?.body).toBe("Words two, offline.");
  });

  it("F5: a page of A's left open sends A's notes under B's sign-in; they are kept as refused for good", async () => {
    const you = page(A, bookId);
    offline = true;
    const a = await you.create({ kind: "note", body: "Written on the train." });
    offline = false;
    the.who = null; // A signs out (signOutAction): the open page is not told
    the.who = { id: B }; // B signs in on the same browser
    await you.sync(); // A's page: flushOutbox(A) sends A's note with B's cookie
    expect(sent.at(-1)).toMatchObject({ method: "POST", as: B });
    const [item] = await waitingFor(A);
    expect(item.refused).toMatchObject({ status: 400, reason: "Book not found." });
    the.who = { id: A }; // A signs in again
    await you.sync();
    expect(sent.filter((s) => s.method === "POST")).toHaveLength(1); // never sent again
    expect(await onLibrary(a.id)).toBeUndefined();
  });

  it("F6: B's page sends an owner-less item of A's, and its refusal puts B's name on it", async () => {
    const you = page(A, bookId);
    const a = await you.create({ kind: "note", body: "Saved." });
    // An edit A queued before owners were recorded (before 2026-11-10): no owner.
    idb.set("0f0f0f0f-0000-4000-8000-000000000001", {
      id: "0f0f0f0f-0000-4000-8000-000000000001",
      op: "edit",
      annotationId: a.id,
      bookId,
      body: { body: "Old offline words." },
      savedAt: "2026-11-01T10:00:00.000Z",
    });
    the.who = { id: B };
    await flushOutbox(B); // B's page: mine() counts the owner-less item as B's
    expect(sent.at(-1)).toMatchObject({ method: "PATCH", as: B });
    expect([...idb.values()][0]).toMatchObject({ owner: B, refused: { status: 404 } });
    the.who = { id: A };
    expect(await waitingFor(A)).toEqual([]); // A never sees or sends it again
    expect((await onLibrary(a.id))?.body).toBe("Saved.");
  });

  it("F7: a second tab whose list was read before a refusal sends the refused change again", async () => {
    const you = page(A, bookId);
    const kept = await you.create({ kind: "note", body: "Kept." });
    const gone = await you.create({ kind: "note", body: "Gone." });
    offline = true;
    await you.saveNote(kept, "Kept, edited offline.");
    await you.saveNote(gone, "Gone, edited offline.");
    offline = false;
    await api(`/api/annotations/${gone.id}?changeId=${crypto.randomUUID()}`, "DELETE"); // removed elsewhere: its edit will be refused
    const goneEdit = (await waitingFor(A)).find((w) => w.annotationId === gone.id)!;
    ways = ["hold"];
    const secondTab = flushOutbox(A); // reads both edits; its first request waits for its answer
    await until(() => held.length === 1);
    await flushOutbox(A); // the first tab sends both: the edit of the removed note is refused and kept
    expect((await waitingFor(A)).find((w) => w.id === goneEdit.id)?.refused?.status).toBe(404);
    const before = sent.filter((s) => s.path.includes(gone.id)).length;
    release();
    await secondTab; // sends the refused edit again
    expect(sent.filter((s) => s.path.includes(gone.id)).length).toBe(before + 1);
  });
});
