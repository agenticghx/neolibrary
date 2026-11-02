"use client";

import { useEffect, useRef, useState } from "react";
import type { Figure } from "./figure";
import styles from "./reader.module.css";

/** The element that has the keyboard, looking inside the book viewer (its frames sit in shadow roots). */
function deepActive(): HTMLElement | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

/**
 * A figure full screen (M41): the picture as large as the screen allows, its legend under it. Tap the picture (or
 * "Actual size") to see it at its own size and move around it; Escape, Close or a tap beside it shuts the view and
 * the keyboard goes back to the page. A modal dialog like the shortcuts list: the reader waits behind it.
 */
export function FigureView({ figure, onClose }: { figure: Figure | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLElement | null>(null);
  const [actual, setActual] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  // Fitted to the screen, the picture is drawn as large as the space allows, larger than its own size when it is small
  // (CSS's max-width alone never enlarges a picture): measured from the picture and the space, again when either changes.
  // Set on the element itself: the project allows no style attribute in markup.
  useEffect(() => {
    const b = box.current;
    if (!figure || !b) return;
    const measure = () => {
      const i = img.current;
      if (!i) return;
      if (actual || !i.naturalWidth || !i.naturalHeight) {
        i.style.removeProperty("width");
        i.style.removeProperty("height");
        return;
      }
      // Not laid out yet (the dialog opens just after): the observer measures again once it has a size.
      if (!b.clientWidth || !b.clientHeight) return;
      const scale = Math.min(b.clientWidth / i.naturalWidth, b.clientHeight / i.naturalHeight);
      i.style.width = `${Math.floor(i.naturalWidth * scale)}px`;
      i.style.height = `${Math.floor(i.naturalHeight * scale)}px`;
    };
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(b);
    const i = img.current;
    i?.addEventListener("load", measure);
    return () => {
      seen.disconnect();
      i?.removeEventListener("load", measure);
    };
  }, [figure, actual]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (figure && !d.open) {
      back.current = deepActive();
      setActual(false);
      d.showModal();
      close.current?.focus();
    } else if (!figure && d.open) {
      d.close();
      const to = back.current;
      back.current = null;
      if (to?.isConnected) to.focus({ preventScroll: true });
    }
  }, [figure]);

  const name = figure?.alt || figure?.legend.split(/(?<=\.)\s/)[0] || "Figure";
  return (
    <dialog
      ref={dialog}
      className={styles.figureView}
      aria-modal="true"
      aria-label={name}
      data-testid="figure-view"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        // The reader's own keys (page turns) wait while the figure is open.
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      // A tap on the dark space around the picture closes it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {figure ? (
        <>
          <div className={styles.figureBar}>
            <button type="button" className={`${styles.tool} ${styles.figureTool}`} aria-pressed={actual} onClick={() => setActual((a) => !a)}>
              {actual ? "Fit to screen" : "Actual size"}
            </button>
            <button ref={close} type="button" className={`${styles.tool} ${styles.figureTool}`} onClick={onClose}>
              Close
            </button>
          </div>
          <div
            ref={box}
            className={actual ? styles.figureActual : styles.figureFit}
            onClick={(e) => {
              if (e.target === e.currentTarget) onClose();
            }}
          >
            {/* A blob: address of the book's own picture, made by the book viewer: nothing for next/image to fetch. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={img}
              src={figure.src}
              alt={figure.alt}
              className={styles.figureImg}
              onClick={() => setActual((a) => !a)}
              data-testid="figure-view-img"
            />
          </div>
          {figure.legend ? <p className={styles.figureLegend}>{figure.legend}</p> : null}
        </>
      ) : null}
    </dialog>
  );
}
