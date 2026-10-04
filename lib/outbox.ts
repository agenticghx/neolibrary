/**
 * The outbox for notes made offline (M12), in the browser's own database
 * (IndexedDB). A highlight, note, sticker or bookmark that cannot reach the
 * server waits here with the id the browser gave it, and is sent when the
 * network returns. Annotations are only ever added (ground rule 9) and the
 * server stores an id once, so sending one twice is harmless.
 */
export type OutboxItem = { id: string; bookId: string; body: Record<string, unknown>; savedAt: string };

const DB = "neolibrary-offline";
const STORE = "outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = work(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const addToOutbox = (item: OutboxItem) => run("readwrite", (s) => s.put(item)).then(() => undefined);
export const removeFromOutbox = (id: string) => run("readwrite", (s) => s.delete(id)).then(() => undefined);

export async function outboxFor(bookId?: string): Promise<OutboxItem[]> {
  const all = await run<OutboxItem[]>("readonly", (s) => s.getAll());
  return all.filter((i) => !bookId || i.bookId === bookId).sort((a, b) => a.savedAt.localeCompare(b.savedAt));
}

/** True when a fetch failed because there was no network (not because the server said no). */
export const isOffline = (e: unknown) => e instanceof TypeError;

/**
 * Sends everything waiting, oldest first. A note the server accepts (201) or
 * already has (200) leaves the outbox; one it refuses (4xx) leaves too, since
 * sending it again cannot help; on a network failure it stops and keeps the rest.
 * Returns how many were sent.
 */
export async function flushOutbox(): Promise<{ sent: number; refused: number }> {
  let sent = 0;
  let refused = 0;
  for (const item of await outboxFor()) {
    let res: Response;
    try {
      res = await fetch(`/api/books/${item.bookId}/annotations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...item.body, id: item.id }),
      });
    } catch {
      break;
    }
    if (res.ok) sent += 1;
    else if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429) refused += 1;
    else break;
    await removeFromOutbox(item.id);
  }
  return { sent, refused };
}
