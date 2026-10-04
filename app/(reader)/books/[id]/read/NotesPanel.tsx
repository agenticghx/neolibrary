"use client";

import { useState } from "react";
import { NotesExport } from "@/components/NotesExport";
import type { Annotation } from "@/lib/library/annotations";
import { ShareMenu } from "./ShareMenu";
import { StickerIcon } from "@/components/StickerIcon";
import { DrawingPreview } from "./DrawingPad";
import { PictureView } from "./PictureCard";
import { STICKERS } from "@/lib/library/stickers";
import styles from "./reader.module.css";

/** Everything you marked in this book, in reading order. */
export function NotesPanel({
  bookId,
  title,
  author,
  themeEl,
  items,
  activeId,
  onGo,
  onSave,
  onDelete,
  onAddBookNote,
}: {
  bookId: string;
  title: string;
  author: string;
  themeEl: () => Element | null;
  items: (Annotation & { audioUrl?: string; pictureUrl?: string })[];
  activeId: string | null;
  onGo: (a: Annotation) => void;
  onSave: (a: Annotation, body: string) => Promise<void>;
  onDelete: (a: Annotation) => Promise<void>;
  onAddBookNote: (body: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [bookNote, setBookNote] = useState("");

  return (
    <nav className={styles.panel} aria-label="Notes">
      <p className={styles.panelTitle}>Notes</p>
      <form
        className={styles.noteForm}
        onSubmit={async (e) => {
          e.preventDefault();
          await onAddBookNote(bookNote);
          setBookNote("");
        }}
      >
        <label htmlFor="book-note" className={styles.groupLabel}>
          A note about this book
        </label>
        <textarea
          id="book-note"
          className={styles.noteInput}
          rows={2}
          value={bookNote}
          onChange={(e) => setBookNote(e.target.value)}
          placeholder="Why you are reading it, what to compare it with…"
        />
        <div className={styles.noteActions}>
          <button type="submit" className={styles.primaryTool} disabled={!bookNote.trim()}>
            Add note
          </button>
        </div>
      </form>
      {items.length === 0 ? (
        <p className={styles.hint}>Select text in the book to highlight it or add a note. Bookmarks are in the top bar.</p>
      ) : (
        <ol className={styles.notes} data-testid="notes">
          {items.map((a) => (
            <li key={a.id} className={`${styles.noteItem} ${a.id === activeId ? styles.noteActive : ""}`}>
              <p className={styles.noteKind}>
                {a.kind === "highlight" ? (
                  <span className={`${styles.dot} ${styles[`mark_${a.color ?? "sage"}`]}`} aria-hidden="true" />
                ) : null}
                {a.sticker ? (
                  <span className={`${styles.stickerBadge} ${styles[`mark_${STICKERS[a.sticker].color}`]}`}>
                    <StickerIcon sticker={a.sticker} size={14} />
                  </span>
                ) : null}
                {a.kind === "bookmark"
                  ? "Bookmark"
                  : a.sticker
                    ? `Sticker · ${STICKERS[a.sticker].label}`
                    : a.drawing
                      ? "Handwritten note"
                      : a.picture
                        ? "Pinned picture"
                  : a.kind === "voice"
                    ? "Voice note"
                    : a.kind === "note"
                      ? "Note on the book"
                      : a.body
                        ? "Highlight and note"
                        : "Highlight"}
              </p>
              {a.quote.exact ? <blockquote className={styles.noteQuote}>{a.quote.exact}</blockquote> : null}
              {a.drawing ? <DrawingPreview strokes={a.drawing.strokes} /> : null}
              {a.picture ? <PictureView picture={a.picture} url={a.pictureUrl} /> : null}
              {a.voice ? (
                <div className={styles.voiceNote}>
                  {a.audioUrl ? <audio controls preload="none" src={a.audioUrl} className={styles.voicePlayer} aria-label="Play the voice note" /> : null}
                  <p className={styles.transcript}>
                    <span className={styles.machineLabel}>Transcript · machine-made</span>
                    {a.voice.transcript || "No transcript (it could not be made). The recording is kept."}
                  </p>
                </div>
              ) : null}
              {editing === a.id ? (
                <form
                  className={styles.noteForm}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await onSave(a, draft);
                    setEditing(null);
                  }}
                >
                  <label htmlFor={`edit-${a.id}`} className="visually-hidden">
                    Edit note
                  </label>
                  <textarea id={`edit-${a.id}`} className={styles.noteInput} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                  <div className={styles.noteActions}>
                    <button type="button" className={styles.tool} onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                    <button type="submit" className={styles.primaryTool}>
                      Save
                    </button>
                  </div>
                </form>
              ) : a.body ? (
                <p className={styles.noteBody}>{a.body}</p>
              ) : null}
              <div className={styles.noteActions}>
                {a.cfi ? (
                  <button type="button" className={styles.tool} onClick={() => onGo(a)}>
                    Go to
                  </button>
                ) : null}
                {editing !== a.id && a.kind !== "bookmark" ? (
                  <button
                    type="button"
                    className={styles.tool}
                    onClick={() => {
                      setDraft(a.body);
                      setEditing(a.id);
                    }}
                  >
                    {a.body ? "Edit note" : "Add note"}
                  </button>
                ) : null}
                {a.kind === "highlight" && a.cfi ? (
                  <ShareMenu bookId={bookId} cfi={a.cfi} quote={a.quote.exact} title={title} author={author} themeEl={themeEl} />
                ) : null}
                <button type="button" className={styles.tool} onClick={() => void onDelete(a)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {items.length ? (
        <div className={styles.panelFoot}>
          <p className={styles.groupLabel}>Take your notes elsewhere</p>
          <NotesExport bookId={bookId} title={title} />
        </div>
      ) : null}
    </nav>
  );
}
