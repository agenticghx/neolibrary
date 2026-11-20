"use client";

import { useEffect, useRef } from "react";
import type { GenealogyView as Data } from "@/lib/library/genealogy-view";
import { mountGenealogy, type GenealogyAlso, type GenealogyTop } from "./genealogy-views";
import own from "./GenealogyView.module.css";

/**
 * The Genealogy views over the whole screen (M43 S3): they need the width of the page, not the Study column.
 * Escape closes the sentence drawer first, then this. "Go to this place in the book" closes it and turns the page.
 */
export function GenealogyView({
  data,
  view,
  focus,
  onClose,
  onGo,
  also,
}: {
  data: Data;
  view: GenealogyTop;
  focus?: string;
  onClose: () => void;
  onGo: (cfi: string) => void;
  /** "Also in <book>": the same name in the reader's other books. */
  also?: (name: string, kind: "person" | "organisation", view: GenealogyTop) => Promise<GenealogyAlso[]>;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const done = useRef(onClose);
  const go = useRef(onGo);
  const elsewhere = useRef(also);
  useEffect(() => {
    done.current = onClose;
    go.current = onGo;
    elsewhere.current = also;
  });
  useEffect(() => {
    if (!root.current) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    // Keep reader shortcuts (page turns, fullscreen, ?) from reaching the book behind the modal even if focus lands on
    // document.body after a chart re-renders, and keep Tab focus inside the modal.
    const trap = (e: KeyboardEvent) => {
      if (e.key === "Tab" && overlay.current) {
        const focusables = [...overlay.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href], summary, [tabindex='0']")].filter(
          (n) => !n.closest("[hidden]") && n.getClientRects().length > 0,
        );
        if (focusables.length) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const active = document.activeElement as HTMLElement | null;
          if (e.shiftKey && (!active || !overlay.current.contains(active) || active === first)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && (!active || !overlay.current.contains(active) || active === last)) {
            e.preventDefault();
            first.focus();
          }
        }
        e.stopPropagation();
        return;
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", " ", "f", "F", "?"].includes(e.key)) {
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", trap);
    const unmount = mountGenealogy(root.current, data, {
      view,
      focus,
      styles: own,
      also: (name, kind, v) => elsewhere.current?.(name, kind, v) ?? Promise.resolve([]),
      onClose: () => done.current(),
      onGo: (cfi) => {
        go.current(cfi);
        done.current();
      },
    });
    return () => {
      window.removeEventListener("keydown", trap);
      unmount();
      if (prev?.isConnected) prev.focus();
    };
  }, [data, view, focus]);
  return (
    // Keys pressed in the views are theirs: an arrow on a chart must not turn the book's page underneath.
    <div ref={overlay} className={own.overlay} role="dialog" aria-modal="true" aria-label="Genealogy" onKeyDown={(e) => e.stopPropagation()}>
      <div className={own.top}>
        <button ref={close} type="button" className={own.close} onClick={onClose}>
          Close
        </button>
      </div>
      <div ref={root} className={own.root} data-testid="genealogy" />
    </div>
  );
}
