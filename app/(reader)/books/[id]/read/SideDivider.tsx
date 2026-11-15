"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { clampSide, sideForKey } from "./side-width";
import styles from "./reader.module.css";

type Columns = { stageWidth: number; book: number; side: number };

/** The reading area's columns as laid out now: [turn, book, turn, rewrite, …]. */
function columns(stage: HTMLElement): Columns | null {
  const cols = getComputedStyle(stage).gridTemplateColumns.split(" ").map(parseFloat);
  if (cols.length < 4 || cols.some((c) => !Number.isFinite(c))) return null;
  return { stageWidth: stage.getBoundingClientRect().width, book: cols[1], side: cols[3] };
}

/** Lays the rewrite out `side` px wide, as a share of the reading area; the share, or null if the layout is unknown. */
function applyTrack(el: HTMLElement, side: number): number | null {
  const c = columns(el);
  if (!c) return null;
  const percent = (side / c.stageWidth) * 100;
  el.style.setProperty("--side-track", `${percent}%`);
  return percent;
}

/** While dragging, the book's frame must not take the pointer (reader.module.css, .stage[data-resizing]). */
function markResizing(el: HTMLElement | null, on: boolean) {
  if (!el) return;
  if (on) el.dataset.resizing = "";
  else delete el.dataset.resizing;
}

/**
 * The line between the book and its rewrite (Side by side), dragged to give either more room (Samuel, 2026-11-15).
 * A mouse, a finger or a pen drags it; with the keyboard, Left and Right move it and Home and End go to either
 * limit; a double click puts the layout's own split back. Neither side gets narrower than 20rem. The width is
 * set on the reading area as --side-track while dragging (no React render per move), and handed to `onChange`
 * when let go, as a share of the reading area's width. On a phone the rewrite is under the page and there is no line.
 */
export function SideDivider(props: { stage: RefObject<HTMLDivElement | null>; onChange: (percent: number | null) => void }) {
  const { stage, onChange } = props;
  const drag = useRef<{ x: number; side: number; pair: number; percent: number } | null>(null);
  const frame = useRef(0);
  const [now, setNow] = useState<{ side: number; pair: number } | null>(null);

  // What a screen reader announces: the rewrite's share of the two columns, kept up to date as the layout changes.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const read = () => {
      const c = columns(el);
      if (c) setNow({ side: c.side, pair: c.book + c.side });
    };
    read();
    const sizes = new ResizeObserver(read);
    sizes.observe(el);
    return () => sizes.disconnect();
  }, [stage]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const show = (side: number) => (stage.current ? applyTrack(stage.current, side) : null);

  const percentNow = now && now.pair > 0 ? Math.round((now.side / now.pair) * 100) : 50;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Width of the rewrite"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentNow}
      aria-valuetext={`The rewrite takes ${percentNow}% of the width`}
      tabIndex={0}
      className={styles.sideDivider}
      data-testid="side-divider"
      onPointerDown={(e) => {
        const el = stage.current;
        const c = el && columns(el);
        if (!el || !c || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, side: c.side, pair: c.book + c.side, percent: (c.side / c.stageWidth) * 100 };
        markResizing(el, true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const side = clampSide(d.side - (e.clientX - d.x), d.pair);
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          const percent = show(side);
          if (percent !== null && drag.current) drag.current.percent = percent;
        });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        cancelAnimationFrame(frame.current);
        const side = clampSide(d.side - (e.clientX - d.x), d.pair);
        const percent = show(side) ?? d.percent;
        markResizing(stage.current, false);
        // A click without a move keeps the layout as it was.
        if (Math.abs(e.clientX - d.x) >= 1) onChange(percent);
      }}
      onPointerCancel={() => {
        drag.current = null;
        markResizing(stage.current, false);
      }}
      onDoubleClick={() => onChange(null)}
      onKeyDown={(e) => {
        const el = stage.current;
        const c = el && columns(el);
        if (!c) return;
        const side = sideForKey(e.key, c.side, c.book + c.side);
        if (side === null) return;
        e.preventDefault();
        const percent = show(side);
        if (percent !== null) onChange(percent);
      }}
    />
  );
}
