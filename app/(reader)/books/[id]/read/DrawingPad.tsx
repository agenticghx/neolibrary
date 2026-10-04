"use client";

import { useRef, useState } from "react";
import { PAD, strokePath } from "@/lib/library/drawings";
import styles from "./reader.module.css";

/**
 * A pad for a handwritten note (M8), for stylus, finger or mouse. Strokes are
 * kept in pad units (600 × 300), so the note redraws the same on any screen.
 */
export function DrawingPad({ onSave, onBack }: { onSave: (strokes: number[][]) => Promise<void>; onBack: () => void }) {
  const [strokes, setStrokes] = useState<number[][]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<number[] | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const point = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * PAD.width), Math.round(((e.clientY - r.top) / r.height) * PAD.height)];
  };

  return (
    <div className={styles.recorder} role="group" aria-label="Handwritten note">
      <svg
        ref={svg}
        className={styles.pad}
        viewBox={`0 0 ${PAD.width} ${PAD.height}`}
        role="img"
        aria-label={`Drawing pad, ${strokes.length} ${strokes.length === 1 ? "stroke" : "strokes"}`}
        data-testid="drawing-pad"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          current.current = point(e);
          setStrokes((s) => [...s, current.current!]);
        }}
        onPointerMove={(e) => {
          if (!current.current) return;
          current.current = [...current.current, ...point(e)];
          const stroke = current.current;
          setStrokes((s) => [...s.slice(0, -1), stroke]);
        }}
        onPointerUp={() => {
          current.current = null;
        }}
      >
        {strokes.map((s, i) => (
          <path key={i} d={strokePath(s)} className={styles.ink} />
        ))}
      </svg>
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.noteActions}>
        <button type="button" className={styles.tool} onClick={onBack} disabled={saving}>
          Back
        </button>
        <button type="button" className={styles.tool} disabled={!strokes.length || saving} onClick={() => setStrokes((s) => s.slice(0, -1))}>
          Undo
        </button>
        <button type="button" className={styles.tool} disabled={!strokes.length || saving} onClick={() => setStrokes([])}>
          Clear
        </button>
        <button
          type="button"
          className={styles.primaryTool}
          disabled={!strokes.length || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(strokes);
            } catch (e) {
              setError((e as Error).message);
              setSaving(false);
            }
          }}
        >
          Save drawing
        </button>
      </div>
    </div>
  );
}

/** A saved handwritten note, redrawn from its strokes. */
export function DrawingPreview({ strokes }: { strokes: number[][] }) {
  return (
    <svg
      className={styles.drawingPreview}
      viewBox={`0 0 ${PAD.width} ${PAD.height}`}
      role="img"
      aria-label={`Handwritten note, ${strokes.length} ${strokes.length === 1 ? "stroke" : "strokes"}`}
      data-testid="drawing-preview"
    >
      {strokes.map((s, i) => (
        <path key={i} d={strokePath(s)} className={styles.ink} />
      ))}
    </svg>
  );
}
