"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import type { Annotation, Color, Kind } from "@/lib/library/annotations";
import { type Sticker } from "@/lib/library/stickers";
import { addToOutbox, flushOutbox, isOffline, opOf, outboxFor, removeFromOutbox, type OutboxItem } from "@/lib/outbox";
import { withCrossed } from "@/lib/reader/crossed-notes";
import { SYNC_EVENT, api, type FoliateView } from "./reader-helpers";

/**
 * The reader's notes on one book (highlights, notes, stickers, bookmarks, drawings, pictures) and the offline queue
 * behind them: the list on screen, loading it, adding, editing and removing with "Undo", and sending what was made
 * with no network when the network returns (M12, M19, M20). Moved out of Reader.tsx as it was (the version 2 split);
 * what needs the selection on the page (highlighting, stickers, drawings, voice notes) stays there and calls this.
 */
/** The kinds of note that are drawn on the page, at their passage. */
const DRAWN_KINDS: string[] = ["highlight", "sticker", "drawing", "image"];

export function useNotes(props: {
  bookId: string;
  /** The signed-in reader's account id ("" for a visitor): notes made offline wait on the device under it. */
  readerId: string;
  visitor?: boolean;
  /** The open book's view, for drawing and removing a highlight's mark. */
  view: RefObject<FoliateView | null>;
  /** The other version's notes found on this one: their places here, by note id. */
  crossedAt: RefObject<Map<string, string>>;
  /** Places the other version's notes on the pages already shown. */
  placeShown: RefObject<() => void>;
}) {
  const { view, crossedAt, placeShown } = props;
  const [notes, setNotes] = useState<Annotation[]>([]);
  const notesRef = useRef<Annotation[]>([]);

  const setAll = (list: Annotation[]) => {
    notesRef.current = list;
    setNotes(list);
  };

  /** How a note made offline looks until the server has it (M12). */
  const localAnnotation = (id: string, body: Record<string, unknown>, savedAt = new Date().toISOString()): Annotation => {
    const q = (body.quote ?? {}) as { exact?: string; prefix?: string; suffix?: string };
    return {
      id,
      version: 1,
      kind: body.kind as Kind,
      targetType: body.cfi ? "passage" : "book",
      bookId: props.bookId,
      targetId: null,
      sectionId: null,
      cfi: (body.cfi as string | undefined) ?? null,
      quote: { exact: q.exact ?? "", prefix: q.prefix ?? "", suffix: q.suffix ?? "" },
      color: body.kind === "highlight" ? ((body.color as Color | undefined) ?? "sage") : null,
      body: String(body.body ?? ""),
      voice: null,
      sticker: (body.sticker as Sticker | undefined) ?? null,
      drawing: null,
      picture: null,
      agent: null,
      createdAt: savedAt,
      updatedAt: savedAt,
      pending: true,
    };
  };

  /** The book's notes from the server (or the offline copy), plus any still waiting in the outbox. */
  const reload = async () => {
    if (props.visitor) return; // a visitor has no notes on the server
    let body: Parameters<typeof withCrossed>[0] | null = null;
    try {
      body = await api(`/api/books/${props.bookId}/annotations`, "GET");
    } catch (e) {
      if (!isOffline(e)) throw e;
    }
    const waiting = await outboxFor(props.readerId, props.bookId).catch(() => []);
    // The other version's notes get their places here, after the last wait: one placed while the outbox was read
    // would otherwise come back without its place, and stay so, as placing skips a note already placed (the
    // flaky agents.spec.ts:318, 2026-10-29).
    const server = body ? withCrossed(body, crossedAt.current) : null;
    setAll(withOutbox(server ?? notesRef.current, waiting));
    setRefused(waiting.filter((w) => w.refused));
    placeShown.current();
  };

  // Changes the server refused (M20): kept on the device and listed in Notes, never sent again.
  const [refused, setRefused] = useState<OutboxItem[]>([]);
  const dismissRefused = async (id: string) => {
    await removeFromOutbox(id);
    await reload();
  };

  const madeOffline = useRef(new Set<string>());

  /** Shows what waits in the outbox on top of the server's list: new notes added, edits applied, removals hidden. */
  const withOutbox = (base: Annotation[], all: OutboxItem[]) => {
    // A refused change is not waiting any more: the server's version stands.
    const waiting = all.filter((w) => !w.refused);
    const created = waiting.filter((w) => opOf(w) === "create");
    const createdIds = new Set(created.map((w) => w.id));
    madeOffline.current = createdIds;
    let list = [...base.filter((a) => !createdIds.has(a.id)), ...created.map((w) => localAnnotation(w.id, w.body, w.savedAt))];
    for (const w of waiting) {
      if (opOf(w) === "edit") list = list.map((a) => (a.id === w.annotationId ? { ...a, ...(w.body as Partial<Annotation>), pending: true } : a));
      if (opOf(w) === "remove") list = list.filter((a) => a.id !== w.annotationId);
      // Brought back while offline (M19): shown again at once, as it was.
      const back = opOf(w) === "restore" ? (w.body.annotation as Annotation | undefined) : undefined;
      if (back && !list.some((a) => a.id === back.id)) list = [...list, { ...back, pending: true }];
    }
    return list;
  };

  /** Edits or removes a note the server has; with no network the change waits in the outbox (M12). */
  const change = async (a: Annotation, op: "edit" | "remove" | "restore", body: Record<string, unknown> = {}) => {
    const changeId = crypto.randomUUID();
    try {
      if (op === "edit") await api(`/api/annotations/${a.id}`, "PATCH", { ...body, changeId });
      else if (op === "restore") await api(`/api/annotations/${a.id}/restore?changeId=${changeId}`, "POST");
      else await api(`/api/annotations/${a.id}?changeId=${changeId}`, "DELETE");
      return { changeId, queued: false };
    } catch (e) {
      if (!isOffline(e)) throw e;
      await addToOutbox(props.readerId, { id: changeId, op, annotationId: a.id, bookId: props.bookId, body, savedAt: new Date().toISOString() });
      return { changeId, queued: true };
    }
  };

  /**
   * A note made offline and not sent yet: its waiting item, if any. Known
   * from the last reload without asking the device's database, so ordinary
   * saves go to the server at once.
   */
  const waitingCreate = async (id: string) =>
    madeOffline.current.has(id) ? (await outboxFor(props.readerId, props.bookId).catch(() => [])).find((w) => w.id === id && opOf(w) === "create") : undefined;

  /**
   * Adds a highlight, note, sticker or bookmark with an id chosen here. With
   * no network it waits in the outbox and shows at once; it is sent when the
   * network returns (M12).
   */
  const create = async (body: Record<string, unknown>): Promise<Annotation> => {
    const id = crypto.randomUUID();
    try {
      return await api(`/api/books/${props.bookId}/annotations`, "POST", { ...body, id });
    } catch (e) {
      if (!isOffline(e)) throw e;
      await addToOutbox(props.readerId, { id, bookId: props.bookId, body, savedAt: new Date().toISOString() });
      return localAnnotation(id, body);
    }
  };

  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });

  // Send notes made offline: when the page opens, when the network returns, and every 30 s while any wait.
  useEffect(() => {
    if (props.visitor) return; // nothing of a visitor's waits to be sent
    const sync = async () => {
      await flushOutbox(props.readerId).catch(() => ({ sent: 0 }));
      await reloadRef.current().catch(() => {});
    };
    const online = () => void sync();
    window.addEventListener("online", online);
    window.addEventListener(SYNC_EVENT, online);
    const timer = setInterval(() => {
      if (notesRef.current.some((a) => a.pending)) void sync();
    }, 30_000);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener(SYNC_EVENT, online);
      clearInterval(timer);
    };
  }, [props.visitor, props.readerId]);

  const saveNote = async (a: Annotation, body: string) => {
    // Made offline and not sent yet: change what will be sent.
    const waiting = await waitingCreate(a.id);
    if (waiting) await addToOutbox(props.readerId, { ...waiting, body: { ...waiting.body, body } });
    else await change(a, "edit", { body });
    await reload();
  };

  /** Removes a note: if it was made offline and never sent, it (and its edits) just leave the outbox. */
  const forget = async (a: Annotation) => {
    if (await waitingCreate(a.id)) {
      for (const w of await outboxFor(props.readerId, props.bookId)) if (w.id === a.id || w.annotationId === a.id) await removeFromOutbox(w.id);
    } else await change(a, "remove");
  };

  // "Note removed · Undo" (M19): the last note removed, and how to bring it back, for ten seconds.
  const [removed, setRemoved] = useState<{ note: Annotation; undo: () => Promise<void> } | null>(null);
  const removedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const removeNote = async (a: Annotation) => {
    let undo: () => Promise<void>;
    const waiting = await waitingCreate(a.id);
    if (waiting) {
      // Made offline and never sent: dropping it from the outbox removes it; Undo puts it back.
      for (const w of await outboxFor(props.readerId, props.bookId)) if (w.id === a.id || w.annotationId === a.id) await removeFromOutbox(w.id);
      undo = () => addToOutbox(props.readerId, waiting);
    } else {
      const { changeId, queued } = await change(a, "remove");
      undo = async () => {
        // The removal is still waiting to be sent: taking it back is enough. Otherwise the server brings the note back.
        if (queued && (await outboxFor(props.readerId, props.bookId).catch(() => [])).some((w) => w.id === changeId)) await removeFromOutbox(changeId);
        else await change(a, "restore", { annotation: a });
      };
    }
    // Every kind that is drawn on the page loses its mark now (a sticker's, a drawing's and a picture's used to stay
    // until the page was loaded again). Marks are drawn by place: if another note sits on the same passage, its mark
    // is drawn again once the list is fresh.
    const drawn = DRAWN_KINDS.includes(a.kind) && a.cfi ? a.cfi : null;
    if (drawn) await view.current?.deleteAnnotation({ value: drawn });
    await reload();
    if (drawn && notesRef.current.some((x) => x.id !== a.id && x.cfi === drawn && DRAWN_KINDS.includes(x.kind))) await view.current?.addAnnotation({ value: drawn });
    if (removedTimer.current) clearTimeout(removedTimer.current);
    setRemoved({ note: a, undo });
    removedTimer.current = setTimeout(() => setRemoved(null), 10_000);
  };

  const undoRemove = async () => {
    const r = removed;
    if (!r) return;
    if (removedTimer.current) clearTimeout(removedTimer.current);
    // The offer goes only once the note is back: if the library refuses, Undo is still there to press again.
    await r.undo();
    setRemoved(null);
    await reload();
    if (DRAWN_KINDS.includes(r.note.kind) && r.note.cfi) {
      // Taken off first: if another note on the same passage kept the mark, adding it a second time would draw it twice.
      await view.current?.deleteAnnotation({ value: r.note.cfi });
      await view.current?.addAnnotation({ value: r.note.cfi });
    }
  };

  const addBookNote = async (body: string) => {
    await create({ kind: "note", body });
    await reload();
  };

  return { notes, setNotes, notesRef, reload, create, forget, refused, dismissRefused, saveNote, removeNote, removed, undoRemove, addBookNote };
}
