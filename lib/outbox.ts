/**
 * The outbox for notes made offline (M12), in the browser's own database
 * (IndexedDB). A new highlight, note, sticker or bookmark, or an edit or
 * removal, that cannot reach the server waits here with the id the browser
 * gave it, and is sent when the network returns, in the order it was made. Annotations are only ever added (ground rule 9) and the
 * server stores an id once, so sending one twice is harmless.
 *
 * Every item belongs to the reader who made it (`owner`, their account id).
 * Two people can use one browser; without the owner, the second person's
 * session would send the first person's waiting notes, the library would
 * refuse them (not their book), and they would never be sent again. So every
 * function here takes the reader's id and only sees their items. Signing out
 * does not empty the outbox: the notes wait for their owner. Every request
 * names its reader (READER_HEADER): sent while another reader is signed in
 * (a page left open in a second tab), it is turned away and waits.
 */
import { READER_HEADER } from "./reader-header";

/**
 * - create: a new annotation; `id` is its id, `body` what to POST.
 * - edit: a change to `annotationId` (`body` = { body?, color? }); `id` is the change's id.
 * - remove: hides `annotationId`; `id` is the change's id.
 * - restore: brings back a removed `annotationId` (M19, Undo); `id` is the change's id, `body.annotation` the note
 *   as it was, so the reader can show it while it waits.
 * Items saved before edits existed have no `op` and are creates.
 */
export type OutboxItem = {
  id: string;
  /** The account id of the reader who made it. Items saved before 2026-11-10 have none: see `mine`. */
  owner?: string;
  op?: "create" | "edit" | "remove" | "restore";
  annotationId?: string;
  bookId: string;
  body: Record<string, unknown>;
  savedAt: string;
  /**
   * The server refused it (M20): kept on the device so the reader sees what
   * was not saved, with the server's reason, and never sent again.
   */
  refused?: { status: number; reason: string; at: string };
};

export const opOf = (i: OutboxItem) => i.op ?? "create";

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

/**
 * The items that are `owner`'s. One with no owner was saved before owners
 * were recorded; it counts as `owner`'s only on the page of its own book,
 * `ownBook`: a reader page opens only the reader's own books, and every note
 * on a book is its owner's. So another reader on the same browser never sends
 * it, never has it refused under their name, and never sees it (verify-outbox
 * F6); it waits until its writer opens that book.
 */
export const mine = (items: OutboxItem[], owner: string, ownBook?: string) =>
  items.filter((i) => i.owner === owner || (i.owner === undefined && ownBook !== undefined && i.bookId === ownBook));

/** The headers of a note request sent for `reader`. */
export const noteHeaders = (reader: string, json = true): Record<string, string> => ({
  ...(json ? { "content-type": "application/json" } : {}),
  ...(reader ? { [READER_HEADER]: reader } : {}),
});

export const addToOutbox = (owner: string, item: OutboxItem) => run("readwrite", (s) => s.put({ ...item, owner })).then(() => undefined);
export const removeFromOutbox = (id: string) => run("readwrite", (s) => s.delete(id)).then(() => undefined);

/** `owner`'s items, oldest first; with `bookId` (a book of the reader's own), only that book's, owner-less ones included. */
export async function outboxFor(owner: string, bookId?: string): Promise<OutboxItem[]> {
  const all = mine(await run<OutboxItem[]>("readonly", (s) => s.getAll()), owner, bookId);
  return all.filter((i) => !bookId || i.bookId === bookId).sort((a, b) => a.savedAt.localeCompare(b.savedAt));
}

/** True when a fetch failed because there was no network (not because the server said no). */
export const isOffline = (e: unknown) => e instanceof TypeError;

/**
 * Sends everything of `owner`'s that is waiting, oldest first. A change the server accepts (or
 * already has) leaves the outbox. One it refuses (4xx) stays, marked with
 * the server's reason, so the reader can see it and copy what they wrote;
 * it is not sent again, since that cannot help (until M20 it was dropped
 * with no word). On a network failure it stops and keeps the rest; so it does
 * when the library says another reader is signed in (401).
 * `ownBook`: the book whose page sends it, a book of the reader's own; its
 * items saved before owners were recorded are sent too (see `mine`).
 * Returns how many were sent and refused.
 */
export async function flushOutbox(owner: string, ownBook?: string): Promise<{ sent: number; refused: number }> {
  let sent = 0;
  let refused = 0;
  const all = mine(await run<OutboxItem[]>("readonly", (s) => s.getAll()), owner, ownBook);
  for (const item of all.sort((a, b) => a.savedAt.localeCompare(b.savedAt)).filter((i) => !i.refused)) {
    let res: Response;
    try {
      const op = opOf(item);
      res =
        op === "create"
          ? await fetch(`/api/books/${item.bookId}/annotations`, {
              method: "POST",
              headers: noteHeaders(owner),
              body: JSON.stringify({ ...item.body, id: item.id }),
            })
          : op === "edit"
            ? await fetch(`/api/annotations/${item.annotationId}`, {
                method: "PATCH",
                headers: noteHeaders(owner),
                body: JSON.stringify({ ...item.body, changeId: item.id }),
              })
            : op === "restore"
              ? await fetch(`/api/annotations/${item.annotationId}/restore?changeId=${item.id}`, { method: "POST", headers: noteHeaders(owner, false) })
              : await fetch(`/api/annotations/${item.annotationId}?changeId=${item.id}`, { method: "DELETE", headers: noteHeaders(owner, false) });
    } catch {
      break;
    }
    if (res.ok) {
      sent += 1;
      await removeFromOutbox(item.id);
    } else if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429) {
      refused += 1;
      const said = (await res.json().catch(() => ({}))) as { error?: unknown };
      const reason = typeof said.error === "string" ? said.error : "";
      await addToOutbox(owner, { ...item, refused: { status: res.status, reason, at: new Date().toISOString() } });
    } else break;
  }
  return { sent, refused };
}

/** A refused item, in words for the Notes panel's "Could not be saved" list (M20). */
export type NotSaved = { id: string; what: string; quote: string; text: string; reason: string };

const NEW_KIND: Record<string, string> = {
  highlight: "A new highlight",
  note: "A new note",
  sticker: "A new sticker",
  bookmark: "A new bookmark",
};

/**
 * Describes a refused item: what it was, the passage, what the reader wrote
 * (so they can copy it) and the server's reason. `notes` gives the passage of
 * the note an edit or removal was for.
 */
export function describeRefused(item: OutboxItem, notes: { id: string; quote: { exact: string }; body: string }[]): NotSaved {
  const op = opOf(item);
  const b = item.body as { kind?: string; quote?: { exact?: string }; body?: string; annotation?: { quote?: { exact?: string }; body?: string } };
  const target = notes.find((a) => a.id === item.annotationId) ?? b.annotation;
  const what =
    op === "create"
      ? b.kind === "highlight" && b.body
        ? "A new highlight and note"
        : (NEW_KIND[b.kind ?? ""] ?? "A new note")
      : op === "edit"
        ? "A change to a note"
        : op === "remove"
          ? "Removing a note"
          : "Bringing back a note";
  return {
    id: item.id,
    what,
    quote: (op === "create" ? b.quote?.exact : target?.quote?.exact) ?? "",
    text: (op === "create" || op === "edit" ? b.body : target?.body) ?? "",
    reason: item.refused?.reason || `The library did not accept it (error ${item.refused?.status ?? "unknown"}).`,
  };
}
