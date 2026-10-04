"use client";

import { useCallback, useEffect, useState } from "react";
import { STRICTNESS, strictnessFrom, type Strictness } from "@/lib/library/levels";
import type { RewriteView } from "@/lib/library/rewrite";
import styles from "./reader.module.css";

type Data = {
  paragraph: { id: string; text: string; cfi: string; chapter: string };
  versions: RewriteView[];
  estimates: Record<string, number> | null;
  levels: Record<string, string>;
  fake: boolean;
};

const STRICT_SHORT: Record<Strictness, string> = { light: "Light", standard: "Standard", strict: "Strict" };

const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Rewrites of one paragraph (M6). The book's text stays as it is; each
 * rewrite is a stored version, styled as machine-written, with where it came
 * from (model, date, cost) underneath.
 */
export function RewritePanel({ bookId, cfi }: { bookId: string; cfi: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strictness, setStrictness] = useState<Strictness>("standard");
  const [percent, setPercent] = useState("");

  const show = useCallback((res: Response, body: Data & { error?: string }, pick?: string) => {
    if (!res.ok) {
      setError(body.error ?? "This paragraph cannot be rewritten.");
      return;
    }
    setData(body);
    const at = pick ? body.versions.findIndex((v) => v.id === pick) : -1;
    setIndex(at >= 0 ? at : Math.max(0, body.versions.length - 1));
  }, []);

  const load = async (query: string, pick?: string) => {
    const res = await fetch(`/api/books/${bookId}/rewrites?${query}`);
    show(res, await res.json().catch(() => ({})), pick);
  };

  // The reader remounts this panel (key) for each new paragraph.
  useEffect(() => {
    let live = true;
    fetch(`/api/books/${bookId}/rewrites?${new URLSearchParams({ cfi })}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (live) show(res, body);
      })
      .catch(() => live && setError("This paragraph could not be loaded."));
    return () => {
      live = false;
    };
  }, [bookId, cfi, show]);

  const ask = async (level: string, fresh = false, strict: Strictness = strictness) => {
    if (!data) return;
    setBusy(fresh ? "again" : level);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/rewrites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sectionId: data.paragraph.id, level, fresh, ...(level === "ste" ? { strictness: strict } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The rewrite failed. Try again.");
      await load(new URLSearchParams({ section: data.paragraph.id }).toString(), body.generation.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const current = data?.versions[index];
  const levelOf = (g: RewriteView) =>
    g.options.level === "ste"
      ? `STE, ${STRICT_SHORT[g.options.strictness as Strictness] ?? g.options.strictness}`
      : (data?.levels[g.options.level] ?? g.options.level);
  // Changing the dial while an STE rewrite is showing asks for that strictness.
  const pickStrictness = (next: Strictness) => {
    setStrictness(next);
    if (current?.options.level === "ste" && current.options.strictness !== next) void ask("ste", false, next);
  };
  const estimate = data?.estimates ? Math.max(...Object.values(data.estimates)) : null;

  return (
    <section className={styles.panel} aria-label="Rewrite">
      <p className={styles.panelTitle}>Rewrite</p>
      {!data && !error ? <p className={styles.hint}>Finding the paragraph…</p> : null}
      {data ? (
        <>
          <div className={styles.original}>
            <p className={styles.groupLabel}>{data.paragraph.chapter || "The book’s text"}</p>
            <p className={styles.originalText}>{data.paragraph.text}</p>
          </div>
          <fieldset className={styles.group}>
            <legend>Rewrite as</legend>
            <div className={styles.levels}>
              {Object.entries(data.levels).map(([level, label]) => (
                <button
                  key={level}
                  type="button"
                  className={styles.segmentButton}
                  aria-pressed={current?.options.level === level && (level !== "ste" || current.options.strictness === strictness)}
                  disabled={busy !== null}
                  onClick={() => void ask(level)}
                >
                  {busy === level ? "Writing…" : label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.group}>
            <legend>STE strictness</legend>
            <div className={styles.strictRow}>
              <div className={styles.segment}>
                {(Object.keys(STRICTNESS) as Strictness[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={styles.segmentButton}
                    aria-pressed={strictness === k}
                    title={STRICTNESS[k]}
                    disabled={busy !== null}
                    onClick={() => {
                      setPercent("");
                      pickStrictness(k);
                    }}
                  >
                    {STRICT_SHORT[k]}
                  </button>
                ))}
              </div>
              <label>
                <span className="visually-hidden">or a percentage</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  inputMode="numeric"
                  placeholder="%"
                  className={styles.percentInput}
                  value={percent}
                  onChange={(e) => {
                    setPercent(e.target.value);
                    const next = strictnessFrom(e.target.value);
                    if (next) pickStrictness(next);
                  }}
                />
              </label>
            </div>
          </fieldset>
          <p className={styles.hint}>
            {estimate === null
              ? "AI is not set up yet: the owner needs to add an Anthropic API key. Saved rewrites still show."
              : `A new rewrite costs ${usd(estimate)}. Saved rewrites are free.`}
          </p>
        </>
      ) : null}
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      {data && current ? (
        <>
          <aside className={styles.machine} aria-label="Machine-written rewrite" data-testid="rewrite">
            <p className={styles.machineLabel}>
              Rewrite · {levelOf(current)} · written by {data.fake ? "the test AI" : "AI"}
            </p>
            {current.text.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
            {current.ste ? (
              <p className={styles.steBadge} title="Measured by the STE checker against full STE, whatever level was asked for">
                STE {Math.round(current.ste.score)}% (full-STE score)
              </p>
            ) : null}
            {current.meaningChanges.length ? (
              <div className={styles.meaning}>
                <p className={styles.machineLabel}>Meaning changes</p>
                <ul>
                  {current.meaningChanges.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className={styles.provenance}>
              {current.provenance.model} · {when(current.provenance.createdAt)} · $
              {current.provenance.costUsd.toFixed(current.provenance.costUsd < 0.01 ? 4 : 2)}
            </p>
          </aside>
          <div className={styles.versionRow}>
            <button
              type="button"
              className={styles.step}
              aria-label="Earlier version"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              ‹
            </button>
            <span className={styles.versionCount} aria-live="polite">
              Version {index + 1} of {data.versions.length}
            </span>
            <button
              type="button"
              className={styles.step}
              aria-label="Later version"
              disabled={index === data.versions.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              ›
            </button>
            <button
              type="button"
              className={styles.tool}
              disabled={busy !== null || estimate === null}
              onClick={() => void ask(current.options.level, true, (current.options.strictness as Strictness) ?? strictness)}
            >
              {busy === "again" ? "Writing…" : "Try again"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
