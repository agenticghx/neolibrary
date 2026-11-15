"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Style } from "@/lib/library/levels";
import type { RewriteView } from "@/lib/library/rewrite";
import { keptRuns } from "@/lib/library/kept-runs";
import type { Piece } from "@/lib/library/rewritten";
import { goAhead, mayPay, paidFor, soFar, usd, type TurnStore } from "@/lib/library/rewritten-turn";
import { STYLE_NAMES } from "@/lib/library/levels";
import { STYLE_EVENT } from "./AiStyleSetting";
import { AiNote } from "./AiNote";
import type { RewrittenMode } from "./settings";
import styles from "./reader.module.css";
import { aiFetch } from "@/lib/own-keys";

type Data = { style: Style; pieces: Piece[]; fake: boolean };

const MODES: [RewrittenMode, string][] = [
  ["original", "Original"],
  ["side", "Side by side"],
  ["rewritten", "Rewritten"],
];

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
  turns: TurnStore;
}) {
  const { bookId, from, to, turns } = props;
  const turn = useSyncExternalStore(turns.subscribe, turns.get, turns.get);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [reload, setReload] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const place = `${from}|${to}`;
  // For the rewriting loop, which outlives a render: the place now on screen, the latest page's
  // paragraphs, whether this pane is still open, and the loop itself. What has been paid, whether
  // it is on, and whether a loop runs are in `turns`, which outlives the pane.
  const placeRef = useRef(place);
  const latest = useRef<{ pieces: Piece[]; at: string } | null>(null);
  const self = useRef(true);
  const makeRef = useRef<(pieces: Piece[], at: string, justAsked: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    placeRef.current = place;
  }, [place]);
  // Closed (Original): a loop this pane started stops before its next paragraph.
  useEffect(() => {
    self.current = true;
    return () => {
      self.current = false;
    };
  }, []);
  // When a loop ends, in this pane or in one closed before it opened, this pane goes on with the page on
  // screen, unless that loop has just ended on this very page (all written, or it stopped to ask).
  useEffect(() => {
    const goOn = (ended: { by: object; at: string }) => {
      const now = latest.current;
      if (!now || now.at !== placeRef.current || !turns.get().on) return;
      if (ended.by === self && ended.at === now.at) return;
      void makeRef.current(now.pieces, now.at, false);
    };
    return turns.onEnd(goOn);
  }, [turns]);

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
      aiFetch(`/api/books/${bookId}/rewritten?${new URLSearchParams({ from, to })}`)
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
          // Rewriting as you turn: this page too (the loop asks first if the next paragraph would pass $1).
          const at = `${from}|${to}`;
          latest.current = { pieces: b.pieces, at };
          if (turns.get().on) void makeRef.current(b.pieces, at, false);
        })
        .catch(() => live && setError("The rewrite could not be loaded."));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [bookId, from, to, reload, turns]);

  // M41 R1c: equations and table cells are kept as in the book: never missing, priced or written.
  const missing = data?.pieces.filter((p) => !p.rewrite && p.form === "prose") ?? [];
  const priced = missing.filter((p) => p.estimate !== null);
  const price = priced.reduce((sum, p) => sum + (p.estimate ?? 0), 0);
  const name = data ? STYLE_NAMES[data.style] : "";

  /**
   * Rewrites the paragraphs of a page that have none, one after another,
   * showing each as it comes. Stops when the page is turned (the rest waits
   * until the reader is back: each is paid once either way), on Stop, when
   * this pane is closed, and before a paragraph whose price would take what
   * was paid since the last go-ahead past $1 (`justAsked`: the reader has just
   * pressed for this page, so its first paragraph goes ahead at the price shown).
   * One loop at a time, in any pane; when it ends, the open pane goes on (goOn).
   */
  const makeMissing = async (pieces: Piece[], at: string, justAsked: boolean) => {
    const todo = pieces.filter((p) => !p.rewrite && p.estimate !== null);
    if (!todo.length || !turns.begin()) return;
    setError(null);
    setBusy({ done: 0, total: todo.length });
    try {
      for (const [i, { id: sectionId, estimate }] of todo.entries()) {
        const t = turns.get();
        if (!self.current || placeRef.current !== at || !t.on || !mayPay(t.sinceOk, estimate ?? 0, justAsked && i === 0)) break;
        const res = await aiFetch(`/api/books/${bookId}/rewritten`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sectionId }),
        });
        const b = (await res.json().catch(() => ({}))) as { style?: Style; reused?: boolean; generation?: RewriteView; error?: string };
        if (!res.ok || !b.generation) throw new Error(b.error ?? "The rewrite failed. Try again.");
        const made = b.generation;
        if (!b.reused) {
          const cost = made.provenance.costUsd;
          turns.change((t) => paidFor(t, cost));
        }
        setData((d) => (d && d.style === b.style ? { ...d, pieces: d.pieces.map((p) => (p.id === sectionId ? { ...p, rewrite: made } : p)) } : d));
        setBusy({ done: i + 1, total: todo.length });
      }
    } catch (e) {
      setError((e as Error).message);
      // A failure (the spending limit, no connection) stops rewriting as you turn: it would only fail again.
      turns.change((t) => ({ ...t, on: false }));
    } finally {
      setBusy(null);
      turns.end({ by: self, at });
    }
  };
  useEffect(() => {
    makeRef.current = makeMissing;
  });

  /** "Rewrite this page" or "Keep rewriting": the reader's go-ahead for this page and the pages turned to after it. */
  const start = () => {
    if (!data) return;
    turns.change(goAhead);
    void makeMissing(data.pieces, place, true);
  };
  const stop = () => turns.change((t) => ({ ...t, on: false }));
  // It asks when the next paragraph to write would take what was paid since the go-ahead past $1 (mayPay).
  const next = priced[0];
  const asking = turn.on && !busy && next !== undefined && !mayPay(turn.sinceOk, next.estimate ?? 0, false);

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
            <p className={styles.hint}>No AI key for new rewrites here: add your own Anthropic key in Reading settings (Aa). Saved rewrites still show.</p>
          ) : null}
          {data && !turn.on && priced.length > 0 ? (
            <div className={styles.rewrittenAsk}>
              <button type="button" className={styles.primaryTool} disabled={busy !== null} onClick={start}>
                {busy ? `Writing… (${busy.done} of ${busy.total})` : `Rewrite this page in ${name}`}
              </button>
              <p className={styles.hint}>
                {`It costs ${usd(price)}, once; saved rewrites are free. Then each page you turn to is rewritten too, until you press Stop, and it asks again after every $1.${soFar(turn)}`}
              </p>
            </div>
          ) : null}
          {data && turn.on ? (
            <div className={styles.rewrittenAsk} data-testid="as-you-turn" aria-live="polite">
              {asking ? (
                <p className={styles.rewrittenQuestion}>{`Keep rewriting? This page costs ${usd(price)}.${soFar(turn)}`}</p>
              ) : (
                <p className={styles.hint}>
                  {busy ? `Writing… (${busy.done} of ${busy.total}).` : "Rewriting each page as you turn to it."}
                  {soFar(turn)}
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
          {data
            ? keptRuns(data.pieces).map((p) =>
                "kept" in p ? (
                  <p key={p.id} className={styles.hint} data-testid="rewritten-kept">
                    {p.kept}
                  </p>
                ) : p.rewrite ? (
              <aside key={p.id} className={`${styles.machine} ${styles.machineNoted}`} aria-label="Machine-written rewrite" data-testid="rewritten-piece">
                {p.rewrite.text.split(/\n{2,}/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
                <AiNote
                  label={`${name} · written by ${data.fake ? "the test AI" : "AI"}`}
                  ste={p.rewrite.ste}
                  readability={{ original: p.text, rewrite: p.rewrite.text }}
                  meaningChanges={p.rewrite.meaningChanges}
                  provenance={p.rewrite.provenance}
                />
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
              )
            : null}
        </div>
      </div>
    </section>
  );
}
