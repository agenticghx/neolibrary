"use client";

import type { Ref } from "react";
import type { ListenView } from "@/components/player/PlayerProvider";
import { SPEEDS } from "@/lib/player/session";
import styles from "./reader.module.css";

/**
 * The Read aloud bar in the reader: Play or Pause, the voice, the speed, a
 * line saying what is happening, and close. What it shows and does comes
 * from the app's read-aloud player (components/player/ListenSession.tsx),
 * which draws it here while the reader is open and goes on playing when the
 * reader is left (M14 step 6a).
 */
export function ListenBar({ view, onClose, ref }: { view: ListenView; onClose: () => void; ref?: Ref<HTMLDivElement> }) {
  // data-word is written by the reader as it lights each word (Reader.tsx, recordLit), not by React: keep it out of this JSX, or two writers would fight.
  return (
    <div ref={ref} className={styles.listenBar} role="region" aria-label="Read aloud" data-passage={view.passageCfi}>
      <button type="button" className={styles.primaryTool} disabled={view.disabled} onClick={view.toggle}>
        {view.busy ? "Preparing…" : view.playing ? "Pause" : view.asking ? "Keep reading" : "Play"}
      </button>
      {view.voices.length ? (
        <label className={styles.listenField}>
          <span>Voice</span>
          <select value={view.voice} onChange={(e) => view.changeVoice(e.target.value)}>
            {view.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className={styles.listenField}>
        <span>Speed</span>
        <select value={view.speed} onChange={(e) => view.setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
      <p className={styles.listenNote} aria-live="polite">
        {view.note}
      </p>
      <button type="button" className={`${styles.tool} ${styles.listenClose}`} aria-label="Stop reading aloud" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
