"use client";

import { useEffect, useRef, useState } from "react";
import type { Style } from "@/lib/library/levels";
import type { RewriteView } from "@/lib/library/rewrite";
import type { Piece } from "@/lib/library/rewritten";
import { STYLE_EVENT, STYLE_NAMES } from "./AiStyleSetting";
import type { RewrittenMode } from "./settings";
import styles from "./reader.module.css";

type Data = { style: Style; pieces: Piece[]; fake: boolean };

const MODES: [RewrittenMode, string][] = [
  ["original", "Original"],
  ["side", "Side by side"],
  ["rewritten", "Rewritten"],
];

const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Read it rewritten (M17, docs/rewritten-view-plan.md): the paragraphs on
 * screen, rewritten in the book's AI explanations style, beside the page
 * ("side") or instead of it ("rewritten"). The book's text never changes;
 * each rewrite is a stored version, labelled as machine-written with where it
 * came from. A page is rewritten when the reader asks, at the price shown.
 */
export function RewrittenPane(props: {
  bookId: string;
  /** The place on screen: CFIs of where it starts and ends. */
  from: string;
  to: string;
  mode: Exclude<RewrittenMode, "original">;
  onMode: (mode: RewrittenMode) => void;
}) {
  const { bookId, from, to } = props;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [reload, setReload] = useState(0);
  const body = useRef<HTMLDivElement>(null);

  // The style changed under Aa: show the rewrites in the new one.
  useEffect(() => {
    const again = () => setReload((n) => n + 1);
    window.addEventListener(STYLE_EVENT, again);
    return () => window.removeEventListener(STYLE_EVENT, again);
  }, []);

  // A new place (a page turn, or a scroll): ask once the place settles.
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/books/${bookId}/rewritten?${new URLSearchParams({ from, to })}`)
        .then(async (res) => {
          const b = await res.json().catch(() => ({}));
          if (!live) return;
          if (!res.ok) {
            setError(b.error ?? "The rewrite could not be loaded.");
            return;
          }
          setError(null);
          setData(b);
          body.current?.scrollTo({ top: 0 });
        })
        .catch(() => live && setError("The rewrite could not be loaded."));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [bookId, from, to, reload]);

  const missing = data?.pieces.filter((p) => !p.rewrite) ?? [];
  const priced = missing.filter((p) => p.estimate !== null);
  const price = priced.reduce((sum, p) => sum + (p.estimate ?? 0), 0);
  const name = data ? STYLE_NAMES[data.style] : "";

  /** Rewrites the page's missing paragraphs, one after another, showing each as it comes. */
  const rewritePage = async () => {
    if (!data || busy) return;
    const todo = priced.map((p) => p.id);
    setError(null);
    setBusy({ done: 0, total: todo.length });
    try {
      for (const [i, sectionId] of todo.entries()) {
        const res = await fetch(`/api/books/${bookId}/rewritten`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sectionId }),
        });
        const b = (await res.json().catch(() => ({}))) as { style?: Style; generation?: RewriteView; error?: string };
        if (!res.ok || !b.generation) throw new Error(b.error ?? "The rewrite failed. Try again.");
        const made = b.generation;
        setData((d) => (d && d.style === b.style ? { ...d, pieces: d.pieces.map((p) => (p.id === sectionId ? { ...p, rewrite: made } : p)) } : d));
        setBusy({ done: i + 1, total: todo.length });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`${styles.rewritten} ${props.mode === "rewritten" ? styles.rewrittenOver : ""}`} aria-label="Rewritten" data-testid="rewritten">
      <div className={styles.rewrittenHead}>
        <p className={styles.rewrittenTitle}>
          Rewritten{name ? ` · ${name}` : ""}
        </p>
        <div className={`${styles.segment} ${styles.rewrittenModes}`} role="group" aria-label="Show">
          {MODES.map(([m, label]) => (
            <button
              key={m}
              type="button"
              className={styles.segmentButton}
              aria-pressed={props.mode === m}
              onClick={() => props.onMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div ref={body} className={styles.rewrittenBody}>
        <div className={styles.rewrittenColumn}>
          {!data && !error ? <p className={styles.hint}>Finding the page…</p> : null}
          {data && data.pieces.length === 0 ? <p className={styles.hint}>There is no text to rewrite on this page.</p> : null}
          {data && missing.length > 0 ? (
            <div className={styles.rewrittenAsk}>
              {priced.length > 0 ? (
                <>
                  <button type="button" className={styles.primaryTool} disabled={busy !== null} onClick={() => void rewritePage()}>
                    {busy ? `Writing… (${busy.done} of ${busy.total})` : `Rewrite this page in ${name}`}
                  </button>
                  <p className={styles.hint}>{`It costs ${usd(price)}, once. Saved rewrites are free. Change the style under Aa, AI explanations.`}</p>
                </>
              ) : (
                <p className={styles.hint}>AI is not set up yet: the owner needs to add an Anthropic API key. Saved rewrites still show.</p>
              )}
            </div>
          ) : null}
          {error ? (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          ) : null}
          {data?.pieces.map((p) =>
            p.rewrite ? (
              <aside key={p.id} className={styles.machine} aria-label="Machine-written rewrite" data-testid="rewritten-piece">
                <p className={styles.machineLabel}>
                  {name} · written by {data.fake ? "the test AI" : "AI"}
                </p>
                {p.rewrite.text.split(/\n{2,}/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
                {p.rewrite.ste ? (
                  <p className={styles.steBadge} title="Measured by the STE checker against full STE, whatever level was asked for">
                    STE {Math.round(p.rewrite.ste.score)}% (full-STE score)
                  </p>
                ) : null}
                {p.rewrite.meaningChanges.length ? (
                  <details className={styles.meaning}>
                    <summary className={styles.machineLabel}>
                      {p.rewrite.meaningChanges.length === 1 ? "1 meaning choice" : `${p.rewrite.meaningChanges.length} meaning choices`}
                    </summary>
                    <ul>
                      {p.rewrite.meaningChanges.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <p className={styles.provenance}>
                  {p.rewrite.provenance.model} · {when(p.rewrite.provenance.createdAt)} · $
                  {p.rewrite.provenance.costUsd.toFixed(p.rewrite.provenance.costUsd < 0.01 ? 4 : 2)}
                </p>
              </aside>
            ) : props.mode === "rewritten" ? (
              // Rewritten alone: the book's own words, until this paragraph is rewritten.
              <div key={p.id} className={styles.notYet} data-testid="rewritten-original">
                <p className={styles.groupLabel}>The book&rsquo;s text · not rewritten yet</p>
                {p.text.split(/\n{2,}/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            ) : (
              <p key={p.id} className={styles.hint} data-testid="rewritten-missing">
                Not rewritten yet: &ldquo;{p.text.slice(0, 60).trim()}…&rdquo;
              </p>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
