import type { Annotation } from "@/lib/library/annotations";
import { addToOutbox, flushOutbox, isOffline, opOf, outboxFor, removeFromOutbox, type OutboxItem } from "@/lib/outbox";

/**
 * How the reader page sends one reader's notes on one book: at once, or, with no network, through the outbox
 * (lib/outbox.ts). Moved out of useNotes.ts (a React hook) unchanged, so the order of its steps can be tested on the
 * real code with the real routes (lib/reader/note-sender.test.ts) and checked by the verify-outbox skill.
 */

/** One JSON request to the library; an error answer throws its own words ("Not saved" if it has none). */
export const noteRequest = async (url: string, method: string, body?: unknown) => {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Not saved");
  return res.status === 204 ? null : res.json();
};

export type NoteSender = ReturnType<typeof noteSender>;

/** The sender for `readerId`'s notes on `bookId`. It remembers which new notes waited at the last `waiting()`. */
export function noteSender(readerId: string, bookId: string) {
  let madeOffline = new Set<string>();

  /** Everything of the reader's on this book that waits or was refused, oldest first. */
  const waiting = async () => {
    const all = await outboxFor(readerId, bookId);
    madeOffline = new Set(all.filter((w) => !w.refused && opOf(w) === "create").map((w) => w.id));
    return all;
  };

  /** Edits, removes or brings back a note the server has; with no network the change waits in the outbox (M12). */
  const change = async (a: { id: string }, op: "edit" | "remove" | "restore", body: Record<string, unknown> = {}) => {
    const changeId = crypto.randomUUID();
    try {
      if (op === "edit") await noteRequest(`/api/annotations/${a.id}`, "PATCH", { ...body, changeId });
      else if (op === "restore") await noteRequest(`/api/annotations/${a.id}/restore?changeId=${changeId}`, "POST");
      else await noteRequest(`/api/annotations/${a.id}?changeId=${changeId}`, "DELETE");
      return { changeId, queued: false };
    } catch (e) {
      if (!isOffline(e)) throw e;
      await addToOutbox(readerId, { id: changeId, op, annotationId: a.id, bookId, body, savedAt: new Date().toISOString() });
      return { changeId, queued: true };
    }
  };

  /**
   * A note made offline and not sent yet: its waiting item, if any. Known
   * from the last `waiting()` without asking the device's database, so ordinary
   * saves go to the server at once.
   */
  const waitingCreate = async (id: string) =>
    madeOffline.has(id) ? (await outboxFor(readerId, bookId).catch(() => [] as OutboxItem[])).find((w) => w.id === id && opOf(w) === "create") : undefined;

  return {
    waiting,

    /**
     * Adds a highlight, note, sticker or bookmark with an id chosen here. With no network it waits in the outbox
     * (`annotation` is null: the page shows it from `body`); it is sent when the network returns (M12).
     */
    create: async (body: Record<string, unknown>): Promise<{ id: string; annotation: Annotation | null }> => {
      const id = crypto.randomUUID();
      try {
        return { id, annotation: await noteRequest(`/api/books/${bookId}/annotations`, "POST", { ...body, id }) };
      } catch (e) {
        if (!isOffline(e)) throw e;
        await addToOutbox(readerId, { id, bookId, body, savedAt: new Date().toISOString() });
        return { id, annotation: null };
      }
    },

    /** New words for a note. */
    edit: async (a: { id: string }, words: string) => {
      // Made offline and not sent yet: change what will be sent.
      const w = await waitingCreate(a.id);
      if (w) await addToOutbox(readerId, { ...w, body: { ...w.body, body: words } });
      else await change(a, "edit", { body: words });
    },

    /** Removes a note: if it was made offline and never sent, it (and its edits) just leave the outbox. */
    forget: async (a: { id: string }) => {
      if (await waitingCreate(a.id)) {
        for (const w of await outboxFor(readerId, bookId)) if (w.id === a.id || w.annotationId === a.id) await removeFromOutbox(w.id);
      } else await change(a, "remove");
    },

    /** Removes a note for "Note removed · Undo" (M19); returns what Undo does. */
    remove: async (a: { id: string }): Promise<() => Promise<void>> => {
      const w = await waitingCreate(a.id);
      if (w) {
        // Made offline and never sent: dropping it from the outbox removes it; Undo puts it back.
        for (const x of await outboxFor(readerId, bookId)) if (x.id === a.id || x.annotationId === a.id) await removeFromOutbox(x.id);
        return () => addToOutbox(readerId, w);
      }
      const { changeId, queued } = await change(a, "remove");
      return async () => {
        // The removal is still waiting to be sent: taking it back is enough. Otherwise the server brings the note back.
        if (queued && (await outboxFor(readerId, bookId).catch(() => [] as OutboxItem[])).some((x) => x.id === changeId)) await removeFromOutbox(changeId);
        else await change(a, "restore", { annotation: a });
      };
    },

    /** Sends what waits (when the page opens, when the network returns, and every 30 s while any wait). */
    flush: () => flushOutbox(readerId),
  };
}
