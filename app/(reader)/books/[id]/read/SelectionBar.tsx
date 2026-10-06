"use client";

import { useState } from "react";
import type { Color } from "@/lib/library/annotations";
import { ShareMenu } from "./ShareMenu";
import { VoiceRecorder } from "@/components/notes/VoiceRecorder";
import { DrawingPad } from "./DrawingPad";
import { StickerIcon } from "@/components/StickerIcon";
import { STICKERS, type Sticker } from "@/lib/library/stickers";
import styles from "./reader.module.css";

export type PendingSelection = { cfi: string; exact: string; prefix: string; suffix: string };

const COLORS: { value: Color; label: string }[] = [
  { value: "sage", label: "Sage" },
  { value: "amber", label: "Amber" },
  { value: "rose", label: "Rose" },
  { value: "sky", label: "Sky" },
];

/** Appears while text is selected in the book: highlight, add a note, rewrite the paragraph, copy or share. */
export function SelectionBar({
  bookId,
  selection,
  title,
  author,
  themeEl,
  onHighlight,
  onRewrite,
  onVoiceNote,
  onSticker,
  onDrawing,
  onImages,
  onClose,
}: {
  bookId: string;
  selection: PendingSelection;
  title: string;
  author: string;
  themeEl: () => Element | null;
  onHighlight: (color: Color, body: string) => Promise<void>;
  onRewrite: () => void;
  onVoiceNote: (audio: Blob, durationMs: number) => Promise<void>;
  onSticker: (sticker: Sticker) => Promise<void>;
  onDrawing: (strokes: number[][]) => Promise<void>;
  onImages: () => void;
  onClose: () => void;
}) {
  const [noting, setNoting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [picking, setPicking] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);
  const preview = selection.exact.length > 90 ? `${selection.exact.slice(0, 90)}…` : selection.exact;

  return (
    <div className={styles.selectionBar} role="toolbar" aria-label="Selected text">
      <p className={styles.selectionQuote}>“{preview}”</p>
      {drawing ? (
        <DrawingPad onSave={onDrawing} onBack={() => setDrawing(false)} />
      ) : recording ? (
        <VoiceRecorder onSave={onVoiceNote} onBack={() => setRecording(false)} />
      ) : picking ? (
        <div className={styles.selectionActions} role="group" aria-label="Stickers">
          {(Object.keys(STICKERS) as Sticker[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`${styles.stickerButton} ${styles[`mark_${STICKERS[k].color}`]}`}
              aria-label={`Sticker: ${STICKERS[k].label}`}
              title={STICKERS[k].label}
              onClick={() => void onSticker(k)}
            >
              <StickerIcon sticker={k} />
            </button>
          ))}
          <button type="button" className={styles.tool} onClick={() => setPicking(false)}>
            Back
          </button>
        </div>
      ) : noting ? (
        <form
          className={styles.noteForm}
          onSubmit={async (e) => {
            e.preventDefault();
            await onHighlight("sage", body);
          }}
        >
          <label htmlFor="note-body" className="visually-hidden">
            Your note
          </label>
          <textarea
            id="note-body"
            className={styles.noteInput}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What are you thinking?"
            rows={3}
            autoFocus
          />
          <div className={styles.noteActions}>
            <button type="button" className={styles.tool} onClick={() => setNoting(false)}>
              Back
            </button>
            <button type="submit" className={styles.primaryTool} disabled={!body.trim()}>
              Save note
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.selectionActions}>
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`${styles.swatch} ${styles[`mark_${c.value}`]}`}
              aria-label={`Highlight in ${c.label}`}
              onClick={() => void onHighlight(c.value, "")}
            />
          ))}
          <button type="button" className={styles.tool} onClick={() => setNoting(true)}>
            Add note
          </button>
          <button type="button" className={styles.tool} onClick={() => setRecording(true)}>
            Voice note
          </button>
          <button type="button" className={styles.tool} onClick={() => setPicking(true)}>
            Sticker
          </button>
          <button type="button" className={styles.tool} onClick={() => setDrawing(true)}>
            Draw
          </button>
          <button type="button" className={styles.tool} onClick={onImages}>
            See it
          </button>
          <button type="button" className={styles.tool} onClick={onRewrite}>
            Rewrite
          </button>
          <button
            type="button"
            className={styles.tool}
            onClick={async () => {
              await navigator.clipboard?.writeText(`“${selection.exact}”\n— ${title}${author ? `, ${author}` : ""}`).catch(() => {});
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <ShareMenu bookId={bookId} cfi={selection.cfi} quote={selection.exact} title={title} author={author} themeEl={themeEl} />
          <button type="button" className={styles.tool} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
