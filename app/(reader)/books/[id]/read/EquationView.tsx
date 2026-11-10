"use client";

import { useEffect, useRef, useState } from "react";
import { aiFetch } from "@/lib/own-keys";
import styles from "./reader.module.css";

/** The equation a tap opened: its place (a CFI), its LaTeX and number. */
export type EquationAsk = { cfi: string; latex: string; number: string | null };

type Version = { id: string; output: string; provenance: { model: string; createdAt: string; costUsd: number } };
type Data = { versions: Version[]; estimate: number | null; fake: boolean };

const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The element that has the keyboard, looking inside the book viewer (its frames sit in shadow roots). */
function deepActive(): HTMLElement | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

/**
 * Explain an equation (M41 R4b): a tap on a displayed equation opens this. It shows the equation's LaTeX, the stored
 * explanation if there is one (free), or what asking costs; "Explain it" asks AI (paid, under the spending caps), and
 * "Ask again" asks once more on purpose. Every answer says it was written by AI, by which model, when, and its cost.
 */
export function EquationView({ bookId, equation, onClose }: { bookId: string; equation: EquationAsk | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLElement | null>(null);
  // What was fetched, and for which equation: a newly tapped one shows nothing until its own answer arrives.
  const [loaded, setLoaded] = useState<{ for: EquationAsk; data: Data | null; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const current = loaded && loaded.for === equation ? loaded : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  const setData = (f: (d: Data | null) => Data | null) => setLoaded((l) => (l && equation ? { ...l, data: f(l.data) } : l));
  const setError = (e: string | null) => setLoaded((l) => (equation ? { for: equation, data: l?.for === equation ? l.data : null, error: e } : l));

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (equation && !d.open) {
      back.current = deepActive();
      d.showModal();
      close.current?.focus();
    } else if (!equation && d.open) {
      d.close();
      const to = back.current;
      back.current = null;
      if (to?.isConnected) to.focus({ preventScroll: true });
    }
  }, [equation]);

  // What is stored for this equation, and what asking costs.
  useEffect(() => {
    if (!equation) return;
    let live = true;
    void (async () => {
      const res = await aiFetch(`/api/books/${bookId}/explain-math`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cfi: equation.cfi, latex: equation.latex }),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (!live) return;
      if (!res?.ok) setLoaded({ for: equation, data: null, error: (body as { error?: string }).error ?? "The library could not be reached. Try again." });
      else setLoaded({ for: equation, data: body as Data, error: null });
    })();
    return () => {
      live = false;
    };
  }, [bookId, equation]);

  async function ask(fresh: boolean) {
    if (!equation) return;
    setBusy(true);
    setError(null);
    try {
      const res = await aiFetch(`/api/books/${bookId}/explain-math`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cfi: equation.cfi, latex: equation.latex, ask: true, fresh }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; generation?: Version };
      if (!res.ok || !body.generation) {
        setError(body.error ?? "That did not work. Try again.");
        return;
      }
      const g = body.generation;
      setData((d) => (d ? { ...d, versions: [...d.versions.filter((v) => v.id !== g.id), g] } : d));
    } catch {
      setError("The library could not be reached. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const latest = data?.versions.at(-1);
  const title = equation?.number ? `Equation (${equation.number})` : "This equation";
  return (
    <dialog
      ref={dialog}
      className={styles.shortcuts}
      aria-modal="true"
      aria-labelledby="equation-title"
      data-testid="equation-view"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className={styles.shortcutsHead}>
        <h2 id="equation-title" className={styles.panelTitle}>
          {title}
        </h2>
        <button ref={close} type="button" className={styles.tool} onClick={onClose}>
          Close
        </button>
      </div>
      {equation ? (
        <>
          <pre className={styles.equationTex} aria-label="The equation, as LaTeX">
            {equation.latex}
          </pre>
          {latest ? (
            <>
              <p className={styles.machineLabel}>Explained by {data?.fake ? "the test AI" : "AI"}</p>
              <div className={styles.equationAnswer} data-testid="equation-answer">
                {latest.output
                  .split(/\n+/)
                  .filter((l) => l.trim())
                  .map((l, i) => (
                    <p key={i}>{l}</p>
                  ))}
              </div>
              <p className={styles.provenance}>
                {latest.provenance.model} · {when(latest.provenance.createdAt)} · ${latest.provenance.costUsd.toFixed(latest.provenance.costUsd < 0.01 ? 4 : 2)}
              </p>
              <button type="button" className={styles.tool} onClick={() => ask(true)} disabled={busy}>
                {busy ? "Asking…" : `Ask again${data?.estimate != null ? ` (${usd(data.estimate)})` : ""}`}
              </button>
            </>
          ) : data ? (
            data.estimate == null ? (
              <p className={styles.equationNote}>AI is not set up on this library, so equations cannot be explained yet.</p>
            ) : (
              <>
                <p className={styles.equationNote}>AI reads the equation with the paragraphs around it and says what it means, symbol by symbol.</p>
                <button type="button" className={styles.tool} onClick={() => ask(false)} disabled={busy}>
                  {busy ? "Reading the equation…" : `Explain it (${data.fake ? "test AI, free" : usd(data.estimate)})`}
                </button>
              </>
            )
          ) : !error ? (
            <p className={styles.equationNote}>Looking…</p>
          ) : null}
          {error ? (
            <p role="alert" className={styles.equationNote}>
              {error}
            </p>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
