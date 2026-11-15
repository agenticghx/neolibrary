// A pretend browser for testing the offline note outbox on the real code (lib/reader/note-sender.test.ts and the
// verify-outbox skill's replay.ts): a small in-memory IndexedDB, and a fetch that hands each request to the
// library's real note routes. Not a test itself (vitest runs only *.test.ts); the test that uses it mocks
// "@/lib/auth/session" (currentUser: `signedIn()`, which reads `browser.who`) and "@/lib/db".
// The fetch answers, fails ("no network"), loses the answer (the library acted, the page never hears), holds the
// answer until `release()`, or holds the request before it reaches the library ("slow", until `release()`).
import * as noteRoute from "@/app/api/annotations/[id]/route";
import * as restoreRoute from "@/app/api/annotations/[id]/restore/route";
import * as bookNotesRoute from "@/app/api/books/[id]/annotations/route";
import type { OutboxItem } from "@/lib/outbox";
import { noteSender } from "./note-sender";

export type Way = "answer" | "offline" | "lose" | "hold" | "slow";

export const browser = {
  /** The outbox store, by item id. */
  idb: new Map<string, OutboxItem>(),
  /** Who the browser is signed in as (the one cookie of every tab). */
  who: null as { id: string } | null,
  /** How the next requests go, in order; after that, "answer" (or "offline" while `offline`). */
  ways: [] as Way[],
  offline: false,
  held: [] as (() => void)[],
  /** Every request that reached the library: as whom, and its answer's status. */
  sent: [] as { method: string; path: string; as: string | null; status: number }[],
};

/** For the test's mock of currentUser(): the reader the browser is signed in as. */
export const signedIn = () => browser.who;

export function resetBrowser() {
  browser.idb.clear();
  browser.who = null;
  browser.ways = [];
  browser.offline = false;
  browser.held = [];
  browser.sent = [];
}

// ---- IndexedDB: one "outbox" store, keyPath "id"; each request finishes on a later turn, as in a browser.
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
const { idb } = browser;
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
  const way = browser.ways.shift() ?? (browser.offline ? "offline" : "answer");
  if (way === "offline") throw new TypeError("Failed to fetch");
  if (way === "slow") await new Promise<void>((resolve) => browser.held.push(resolve));
  const res = await library(String(url), init);
  browser.sent.push({ method: init.method ?? "GET", path: String(url), as: browser.who?.id ?? null, status: res.status });
  if (way === "lose") throw new TypeError("Failed to fetch");
  if (way === "hold") return new Promise<Response>((resolve) => browser.held.push(() => resolve(res)));
  return res;
}) as typeof fetch;

/** Waits until `done()` (each IndexedDB step takes a turn). */
export const until = async (done: () => boolean) => {
  for (let i = 0; i < 1000 && !done(); i++) await new Promise((r) => setTimeout(r, 1));
  if (!done()) throw new Error("the test waited too long");
};
/** Lets the oldest held request or answer go on. */
export const release = () => browser.held.shift()!();

/** One open reader page of `readerId` on `bookId`, as useNotes.ts drives the sender. */
export function page(readerId: string, bookId: string) {
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
