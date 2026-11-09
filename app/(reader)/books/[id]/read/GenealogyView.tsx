"use client";

import { useEffect, useRef } from "react";
import type { GenealogyView as Data } from "@/lib/library/genealogy-view";
import { mountGenealogy, type GenealogyTop } from "./genealogy-views";
import own from "./GenealogyView.module.css";

/**
 * The Genealogy views over the whole screen (M43 S3): they need the width of the page, not the Study column.
 * Escape closes the sentence drawer first, then this. "Go to this place in the book" closes it and turns the page.
 */
export function GenealogyView({ data, view, focus, onClose, onGo }: { data: Data; view: GenealogyTop; focus?: string; onClose: () => void; onGo: (cfi: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const done = useRef(onClose);
  const go = useRef(onGo);
  useEffect(() => {
    done.current = onClose;
    go.current = onGo;
  });
  useEffect(() => {
    if (!root.current) return;
    close.current?.focus();
    return mountGenealogy(root.current, data, {
      view,
      focus,
      styles: own,
      onClose: () => done.current(),
      onGo: (cfi) => {
        go.current(cfi);
        done.current();
      },
    });
  }, [data, view, focus]);
  return (
    // Keys pressed in the views are theirs: an arrow on a chart must not turn the book's page underneath.
    <div className={own.overlay} role="dialog" aria-modal="true" aria-label="Genealogy" onKeyDown={(e) => e.stopPropagation()}>
      <div className={own.top}>
        <button ref={close} type="button" className={own.close} onClick={onClose}>
          Close
        </button>
      </div>
      <div ref={root} className={own.root} data-testid="genealogy" />
    </div>
  );
}
