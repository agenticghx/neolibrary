"use client";

import { useRef, useState } from "react";
import { addTargetNoteAction } from "@/app/(app)/actions";
import styles from "./PathView.module.css";

/**
 * The box that adds a note to a pillar or a whole Path. It sends the note itself (not as a plain page form), for two
 * reasons seen on 2026-11-11: a save the library refused replaced the whole page with "This page couldn't load" and the
 * words typed were gone; and a second press before the first was saved made the note twice. Now a refused save says so
 * and leaves the words in the box, and the button waits while a save is on its way.
 */
export function TargetNoteForm({ targetType, targetId, label }: { targetType: "pillar" | "path"; targetId: string; label: string }) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  return (
    <form
      className={styles.noteForm}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy.current || !body.trim()) return;
        busy.current = true;
        setSaving(true);
        try {
          const data = new FormData();
          data.set("targetType", targetType);
          data.set("targetId", targetId);
          data.set("body", body);
          await addTargetNoteAction(data);
          setBody("");
          setFailed(false);
        } catch {
          setFailed(true);
        } finally {
          busy.current = false;
          setSaving(false);
        }
      }}
    >
      {failed ? (
        <p className={styles.noteError} role="alert">
          Not saved: the library could not be reached or refused the note. Your words are still in the box.
        </p>
      ) : null}
      <label className="visually-hidden" htmlFor={`note-${targetId}`}>
        {label}
      </label>
      <textarea
        id={`note-${targetId}`}
        name="body"
        rows={2}
        className={styles.noteInput}
        placeholder="A thought, a pairing, a question…"
        required
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button type="submit" className={styles.noteSave} disabled={saving}>
        Save note
      </button>
    </form>
  );
}
