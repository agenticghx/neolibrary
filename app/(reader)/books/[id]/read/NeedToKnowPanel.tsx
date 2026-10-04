"use client";

import { useCallback, useEffect, useState } from "react";
import type { PrerequisitesView } from "@/lib/library/prerequisites";
import styles from "./reader.module.css";

type Data = {
  chapter: { id: string; label: string };
  versions: PrerequisitesView[];
  estimate: number | null;
  fake: boolean;
};

const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * "What do I need to know?" for the chapter being read (M6): the concepts it
 * assumes, each in two lines with a link to read more. Machine-written, so it
 * uses the machine style and says where it came from.
 */
export function NeedToKnowPanel({ bookId, cfi }: { bookId: string; cfi: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where the reader was when the panel opened; turning pages within the chapter does not reload it.
  const [at] = useState(cfi);

  const show = useCallback((res: Response, body: Data & { error?: string }) => {
    if (!res.ok) setError(body.error ?? "This chapter cannot be explained.");
    else setData(body);
  }, []);

  // The reader remounts this panel (key) when the chapter changes.
  useEffect(() => {
    let live = true;
    fetch(`/api/books/${bookId}/prerequisites?${new URLSearchParams({ cfi: at })}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (live) show(res, body);
      })
      .catch(() => live && setError("This chapter could not be loaded."));
    return () => {
      live = false;
    };
  }, [bookId, at, show]);

  const ask = async (fresh: boolean) => {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/prerequisites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterId: data.chapter.id, fresh }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "That did not work. Try again.");
      setData({ ...data, versions: [...data.versions, ...(body.reused ? [] : [body.generation])] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const latest = data?.versions.at(-1);

  return (
    <section className={styles.panel} aria-label="What do I need to know?">
      <p className={styles.panelTitle}>What do I need to know?</p>
      {!data && !error ? <p className={styles.hint}>Finding the chapter…</p> : null}
      {data ? <p className={styles.groupLabel}>{data.chapter.label}</p> : null}
      {data && !latest ? (
        <>
          <p className={styles.hint}>The ideas this chapter takes for granted, each explained in two lines, with a link to read more.</p>
          {data.estimate === null ? (
            <p className={styles.hint}>AI is not set up yet: the owner needs to add an Anthropic API key.</p>
          ) : (
            <div className={styles.noteActions}>
              <button type="button" className={styles.primaryTool} disabled={busy} onClick={() => void ask(false)}>
                {busy ? "Reading the chapter…" : `Show me (${usd(data.estimate)})`}
              </button>
            </div>
          )}
        </>
      ) : null}
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      {data && latest ? (
        <>
          <aside className={styles.machine} aria-label="Machine-written explanations" data-testid="need-to-know">
            <p className={styles.machineLabel}>Before you read · written by {data.fake ? "the test AI" : "AI"}</p>
            {latest.concepts.length ? (
              <dl className={styles.concepts}>
                {latest.concepts.map((c) => (
                  <div key={c.name} className={styles.concept}>
                    <dt>{c.name}</dt>
                    <dd>
                      {c.explanation}{" "}
                      <a href={c.readMore} target="_blank" rel="noopener noreferrer" className={styles.readMore}>
                        Read more<span className="visually-hidden"> about {c.name} (opens Wikipedia)</span>
                      </a>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>Nothing came back for this chapter. Try again.</p>
            )}
            <p className={styles.provenance}>
              {latest.provenance.model} · {when(latest.provenance.createdAt)} · $
              {latest.provenance.costUsd.toFixed(latest.provenance.costUsd < 0.01 ? 4 : 2)}
            </p>
          </aside>
          <div className={styles.versionRow}>
            <span className={styles.versionCount}>
              {data.versions.length === 1 ? "Saved answer" : `Latest of ${data.versions.length} answers`}
            </span>
            <button type="button" className={styles.tool} disabled={busy || data.estimate === null} onClick={() => void ask(true)}>
              {busy ? "Reading…" : "Try again"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
