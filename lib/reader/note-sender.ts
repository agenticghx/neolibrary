import type { Annotation } from "@/lib/library/annotations";
import { addToOutbox, flushOutbox, isOffline, noteHeaders, opOf, outboxFor, type OutboxItem } from "@/lib/outbox";

/**
 * How the reader page sends one reader's notes on one book: at once, or, with no network, through the outbox
 * (lib/outbox.ts). Moved out of useNotes.ts (a React hook) unchanged, so the order of its steps can be tested on the
 * real code with the real routes (lib/reader/note-sender.test.ts) and checked by the verify-outbox skill.
 */

/**
 * One JSON request to the library for `reader` (named in its header: sent while another reader is signed in, it is
 * turned away untouched); an error answer throws its own words ("Not saved" if it has none).
 */
export const noteRequest = async (reader: string, url: string, method: string, body?: unknown) => {
  const res = await fetch(url, { method, headers: noteHeaders(reader), body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Not saved");
  return res.status === 204 ? null : res.json();
};

/** A change of note `noteId` that still waits to be sent (its create, or an edit, removal or return); not a refused one. */
const waitsFor = (items: OutboxItem[], noteId: string) =>
  items.some((i) => !i.refused && ((i.id === noteId && opOf(i) === "create") || (opOf(i) !== "create" && i.annotationId === noteId)));

/**
 * The sender for `readerId`'s notes on `bookId`. `soon` is called when a change was put in the outbox behind an
 * earlier one while the network may be up, so the page can send what waits now rather than at the next 30 s tick.
 *
 * Items in the outbox are never rewritten or taken out by the reader's actions (only "Dismiss" on a refused one
 * does that): a waiting item may already be on the library (its answer lost, or a flush sending it), so the
 * reader's next change goes behind it as an item of its own, and the library gets the changes in the order made.
 */
export function noteSender(readerId: string, bookId: string, soon: () => void = () => {}) {
  /** Edits, removes or brings back a note: at once, or behind a change of it that still waits; with no network the change waits (M12). */
  const change = async (a: { id: string }, op: "edit" | "remove" | "restore", body: Record<string, unknown> = {}) => {
    const changeId = crypto.randomUUID();
    const waiting = await outboxFor(readerId, bookId).catch(() => [] as OutboxItem[]);
    // After every item that waits, even if the device's clock went back: the outbox is sent in savedAt order.
    const at = Math.max(Date.now(), ...waiting.map((w) => Date.parse(w.savedAt) + 1).filter(Number.isFinite));
    const item: OutboxItem = { id: changeId, op, annotationId: a.id, bookId, body, savedAt: new Date(at).toISOString() };
    if (waitsFor(waiting, a.id)) {
      await addToOutbox(readerId, item);
      soon();
      return { changeId, queued: true };
    }
    try {
      if (op === "edit") await noteRequest(readerId, `/api/annotations/${a.id}`, "PATCH", { ...body, changeId });
      else if (op === "restore") await noteRequest(readerId, `/api/annotations/${a.id}/restore?changeId=${changeId}`, "POST");
      else await noteRequest(readerId, `/api/annotations/${a.id}?changeId=${changeId}`, "DELETE");
      return { changeId, queued: false };
    } catch (e) {
      if (!isOffline(e)) throw e;
      await addToOutbox(readerId, item);
      return { changeId, queued: true };
    }
  };

  return {
    /** Everything of the reader's on this book that waits or was refused, oldest first. */
    waiting: () => outboxFor(readerId, bookId),

    /**
     * Adds a highlight, note, sticker or bookmark with an id chosen here. With no network it waits in the outbox
     * (`annotation` is null: the page shows it from `body`); it is sent when the network returns (M12).
     */
    create: async (body: Record<string, unknown>): Promise<{ id: string; annotation: Annotation | null }> => {
      const id = crypto.randomUUID();
      try {
        return { id, annotation: await noteRequest(readerId, `/api/books/${bookId}/annotations`, "POST", { ...body, id }) };
      } catch (e) {
        if (!isOffline(e)) throw e;
        await addToOutbox(readerId, { id, bookId, body, savedAt: new Date().toISOString() });
        return { id, annotation: null };
      }
    },

    /** New words for a note (one made offline included: the words go behind its create). */
    edit: (a: { id: string }, words: string) => change(a, "edit", { body: words }),

    /** Removes a note (a bookmark toggled off), with no Undo offer. */
    forget: (a: { id: string }) => change(a, "remove"),

    /**
     * Removes a note for "Note removed · Undo" (M19); returns what Undo does: bring the note back, always as a
     * change of its own (the removal may already be on the library even if it still waits here).
     */
    remove: async (a: { id: string }): Promise<() => Promise<void>> => {
      await change(a, "remove");
      return async () => {
        await change(a, "restore", { annotation: a });
      };
    },

    /** Sends what waits (when the page opens, when the network returns, and every 30 s while any wait). */
    flush: () => flushOutbox(readerId, bookId),
  };
}
