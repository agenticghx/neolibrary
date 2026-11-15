"use client";

import { ReadabilityBadge } from "./ReadabilityBadge";
import styles from "./AiNote.module.css";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * One small mark on a block of machine-written text, with everything about how it was made behind it (Samuel,
 * 2026-11-15: the score, grade, meaning-choice and model lines under every rewritten paragraph distracted from
 * comparing it with the book). Closed, it is a sparkle in the block's top corner, with a dot when the AI had to
 * choose a meaning: those are worth a look. A tap, a click or Enter opens it under the text: who wrote it, the
 * full-STE score, the reading level, the meaning choices, and the model, date and cost (ground rule 5: the
 * provenance is kept and shown on request; the tinted block with its dashed edge still marks the text as
 * machine-written).
 */
export function AiNote(props: {
  /** What wrote it, e.g. "STE light · written by AI"; left out where the block's own heading says so. */
  label?: string;
  ste?: { score: number } | null;
  /** The book's paragraph and the rewrite, for the reading level. */
  readability?: { original: string; rewrite: string };
  meaningChanges?: string[];
  provenance: { model: string; createdAt: string; costUsd: number };
}) {
  const meaning = props.meaningChanges ?? [];
  const choices = meaning.length === 1 ? "1 meaning choice" : `${meaning.length} meaning choices`;
  const cost = props.provenance.costUsd;
  return (
    <details className={styles.note} data-testid="ai-note" data-meaning={meaning.length ? "" : undefined}>
      <summary className={styles.mark} title="About this text">
        <svg className={styles.sparkle} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M8 1.5 9.5 6.5 14.5 8 9.5 9.5 8 14.5 6.5 9.5 1.5 8 6.5 6.5Z" />
        </svg>
        {meaning.length ? <span className={styles.dot} aria-hidden="true" data-testid="ai-note-dot" /> : null}
        <span className="visually-hidden">{`About this text: written by AI${meaning.length ? `, ${choices}` : ""}`}</span>
      </summary>
      <div className={styles.body}>
        {props.label ? <p className={styles.label}>{props.label}</p> : null}
        {props.ste ? (
          <p className={styles.badge} title="Measured by the STE checker against full STE, whatever level was asked for">
            STE {Math.round(props.ste.score)}% (full-STE score)
          </p>
        ) : null}
        {props.readability ? <ReadabilityBadge original={props.readability.original} rewrite={props.readability.rewrite} /> : null}
        {meaning.length ? (
          <div className={styles.meaning}>
            <p className={styles.label}>{choices}</p>
            <ul>
              {meaning.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className={styles.provenance}>
          {props.provenance.model} · {when(props.provenance.createdAt)} · ${cost.toFixed(cost < 0.01 ? 4 : 2)}
        </p>
      </div>
    </details>
  );
}
