"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Style } from "@/lib/library/levels";
import type { RewriteView } from "@/lib/library/rewrite";
import type { Piece } from "@/lib/library/rewritten";
import { goAhead, mustAskAgain, paidFor, soFar, usd, type AsYouTurn } from "@/lib/library/rewritten-turn";
import { STYLE_EVENT, STYLE_NAMES } from "./AiStyleSetting";
import type { RewrittenMode } from "./settings";
import styles from "./reader.module.css";

type Data = { style: Style; pieces: Piece[]; fake: boolean };

const MODES: [RewrittenMode, string][] = [
  ["original", "Original"],
  ["side", "Side by side"],
  ["rewritten", "Rewritten"],
];

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Read it rewritten (M17, docs/rewritten-view-plan.md): the paragraphs on
 * screen, rewritten in the book's AI explanations style, beside the page
 * ("side") or instead of it ("rewritten"). The book's text never changes;
 * each rewrite is a stored version, labelled as machine-written with where it
 * came from. A page is rewritten when the reader asks, at the price shown;
 * after that, each page turned to is rewritten too (R3, lib/library/rewritten-turn.ts).
 */
export function RewrittenPane(props: {
  bookId: string;
  /** The place on screen: CFIs of where it starts and ends. */
  from: string;
  to: string;
  mode: Exclude<RewrittenMode, "original">;
  onMode: (mode: RewrittenMode) => void;
  /** Rewriting as you turn: kept by the reader for this visit, so closing this view does not lose it. */
  turn: AsYouTurn;
  setTurn: Dispatch<SetStateAction<AsYouTurn>>;
}) {
  const { bookId, from, to } = props;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [reload, setReload] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const place = `${from}|${to}`;
  // For the rewriting loop, which outlives a render: the place now on screen, the latest page's
  // paragraphs, the as-you-turn state, whether a loop runs, and the loop itself.
  const placeRef = useRef(place);
  const latest = useRef<{ pieces: Piece[]; at: string } | null>(null);
  const turnRef = useRef(props.turn);
  const running = useRef(false);
  const makeRef = useRef<(pieces: Piece[], at: string, since: number) => Promise<void>>(async () => {});
  useEffect(() => {
    placeRef.current = place;
  }, [place]);
  useEffect(() => {
    turnRef.current = props.turn;
  });

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
          // Rewriting as you turn: this page too, unless it must ask first.
          const at = `${from}|${to}`;
          latest.current = { pieces: b.pieces, at };
          const t = turnRef.current;
          if (t.on && !mustAskAgain(t.sinceOk)) void makeRef.current(b.pieces, at, t.sinceOk);
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

  /**
   * Rewrites the paragraphs of a page that have none, one after another,
   * showing each as it comes. Stops when the page is turned (the rest waits
   * until the reader is back: each is paid once either way), on Stop, and
   * before paying on once $1 has been paid since the last go-ahead. One loop
   * at a time; when it ends on a turned page, the page now on screen is next.
   */
  const makeMissing = async (pieces: Piece[], at: string, since: number) => {
    if (running.current) return;
    const todo = pieces.filter((p) => !p.rewrite && p.estimate !== null).map((p) => p.id);
    if (!todo.length) return;
    running.current = true;
    let sinceOk = since;
    setError(null);
    setBusy({ done: 0, total: todo.length });
    try {
      for (const [i, sectionId] of todo.entries()) {
        if (placeRef.current !== at || !turnRef.current.on || mustAskAgain(sinceOk)) break;
        const res = await fetch(`/api/books/${bookId}/rewritten`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sectionId }),
        });
        const b = (await res.json().catch(() => ({}))) as { style?: Style; reused?: boolean; generation?: RewriteView; error?: string };
        if (!res.ok || !b.generation) throw new Error(b.error ?? "The rewrite failed. Try again.");
        const made = b.generation;
        if (!b.reused) {
          const cost = made.provenance.costUsd;
          sinceOk += cost;
          props.setTurn((t) => paidFor(t, cost));
        }
        setData((d) => (d && d.style === b.style ? { ...d, pieces: d.pieces.map((p) => (p.id === sectionId ? { ...p, rewrite: made } : p)) } : d));
        setBusy({ done: i + 1, total: todo.length });
      }
    } catch (e) {
      setError((e as Error).message);
      // A failure (the spending limit, no connection) stops rewriting as you turn: it would only fail again.
      turnRef.current = { ...turnRef.current, on: false };
      props.setTurn((t) => ({ ...t, on: false }));
    } finally {
      running.current = false;
      setBusy(null);
    }
    const now = latest.current;
    if (now && now.at !== at && now.at === placeRef.current && turnRef.current.on && !mustAskAgain(sinceOk)) {
      void makeRef.current(now.pieces, now.at, sinceOk);
    }
  };
  useEffect(() => {
    makeRef.current = makeMissing;
  });

  /** "Rewrite this page" or "Keep rewriting": the reader's go-ahead for this page and the pages turned to after it. */
  const start = () => {
    if (!data) return;
    turnRef.current = goAhead(turnRef.current);
    props.setTurn(goAhead);
    void makeMissing(data.pieces, place, 0);
  };
  const stop = () => {
    turnRef.current = { ...turnRef.current, on: false };
    props.setTurn((t) => ({ ...t, on: false }));
  };
  const asking = props.turn.on && mustAskAgain(props.turn.sinceOk) && priced.length > 0 && !busy;

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
          {data && missing.length > 0 && priced.length === 0 ? (
            <p className={styles.hint}>AI is not set up yet: the owner needs to add an Anthropic API key. Saved rewrites still show.</p>
          ) : null}
          {data && !props.turn.on && priced.length > 0 ? (
            <div className={styles.rewrittenAsk}>
              <button type="button" className={styles.primaryTool} disabled={busy !== null} onClick={start}>
                {busy ? `Writing… (${busy.done} of ${busy.total})` : `Rewrite this page in ${name}`}
              </button>
              <p className={styles.hint}>
                {`It costs ${usd(price)}, once; saved rewrites are free. Then each page you turn to is rewritten too, until you press Stop, and it asks again after every $1.${soFar(props.turn)}`}
              </p>
            </div>
          ) : null}
          {data && props.turn.on ? (
            <div className={styles.rewrittenAsk} data-testid="as-you-turn" aria-live="polite">
              {asking ? (
                <p className={styles.rewrittenQuestion}>{`Keep rewriting? This page costs ${usd(price)}.${soFar(props.turn)}`}</p>
              ) : (
                <p className={styles.hint}>
                  {busy ? `Writing… (${busy.done} of ${busy.total}).` : "Rewriting each page as you turn to it."}
                  {soFar(props.turn)}
                </p>
              )}
              <div className={styles.askRow}>
                {asking ? (
                  <button type="button" className={styles.primaryTool} onClick={start}>
                    Keep rewriting
                  </button>
                ) : null}
                <button type="button" className={styles.tool} onClick={stop}>
                  Stop
                </button>
              </div>
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
