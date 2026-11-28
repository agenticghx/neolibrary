"use client";

import type { Ref } from "react";
import type { ListenView } from "@/components/player/PlayerProvider";
import { Icon } from "@/components/shell/icons";
import { SPEEDS } from "@/lib/player/session";
import styles from "./reader.module.css";

/**
 * The floating native Listen dock in the reader (Option A): compact Voice pill
 * with live waveform, centered transport controls (prev paragraph, back 15 s,
 * Play/Pause, forward 15 s, next paragraph), speed pill, and close. Routine
 * status notes stay accessible to screen readers without cluttering the bar;
 * cost prompts and errors show visibly.
 */
export function ListenBar({ view, onClose, ref }: { view: ListenView; onClose: () => void; ref?: Ref<HTMLDivElement> }) {
  const playLabel = view.busy ? "Preparing…" : view.playing ? "Pause" : view.asking ? "Keep reading" : "Play";
  const costMatch = !view.asking && !view.hasError ? view.note.match(/\$[\d.]+/) : null;
  const showNote = view.asking || view.hasError || view.note.startsWith("Downloading");

  // data-word is written by the reader as it lights each word (Reader.tsx, recordLit), not by React: keep it out of this JSX, or two writers would fight.
  return (
    <div
      ref={ref}
      className={view.asking ? `${styles.listenBar} ${styles.listenAsking}` : styles.listenBar}
      role="region"
      aria-label="Read aloud"
      data-passage={view.passageCfi}
    >
      <p className={showNote ? styles.listenNote : "visually-hidden"} aria-live="polite">
        {view.note}
      </p>

      <div className={styles.listenLeft}>
        <span className={view.playing ? `${styles.listenWave} ${styles.listenWaveOn}` : styles.listenWave} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {view.voices.length ? (
          <select className={styles.listenSelect} aria-label="Voice" value={view.voice} onChange={(e) => view.changeVoice(e.target.value)}>
            {view.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        ) : null}
        {costMatch ? (
          <span className={styles.listenCostChip} title={view.note}>
            ~{costMatch[0]}
          </span>
        ) : null}
      </div>

      <div className={styles.listenTransport}>
        <button
          type="button"
          className={styles.listenIconBtn}
          aria-label="Previous paragraph"
          title="Previous paragraph"
          disabled={!view.canPrev}
          onClick={view.prevParagraph}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.listenIconBtn}
          aria-label="Back 15 seconds"
          title="Back 15 seconds"
          disabled={!view.canSkip}
          onClick={view.back}
        >
          <Icon name="back15" className={styles.listenSkipIcon} />
        </button>
        <button
          type="button"
          className={view.asking ? `${styles.listenPlayBtn} ${styles.listenPlayAsking}` : styles.listenPlayBtn}
          disabled={view.disabled}
          aria-label={playLabel}
          title={playLabel}
          onClick={view.toggle}
        >
          {view.asking ? (
            <span>Keep reading</span>
          ) : view.playing ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          {!view.asking ? <span className="visually-hidden">{playLabel}</span> : null}
        </button>
        <button
          type="button"
          className={styles.listenIconBtn}
          aria-label="Forward 15 seconds"
          title="Forward 15 seconds"
          disabled={!view.canSkip}
          onClick={view.forward}
        >
          <Icon name="forward15" className={styles.listenSkipIcon} />
        </button>
        <button
          type="button"
          className={styles.listenIconBtn}
          aria-label="Next paragraph"
          title="Next paragraph"
          disabled={!view.canNext}
          onClick={view.nextParagraph}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>

      <div className={styles.listenRight}>
        <select className={styles.listenSelect} aria-label="Speed" value={view.speed} onChange={(e) => view.setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <button type="button" className={styles.listenIconBtn} aria-label="Stop reading aloud" title="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
