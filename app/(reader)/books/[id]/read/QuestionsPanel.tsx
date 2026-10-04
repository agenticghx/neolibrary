"use client";

import { useCallback, useEffect, useState } from "react";
import { STYLES, type Style } from "@/lib/library/levels";
import type { QuestionsView } from "@/lib/library/questions";
import styles from "./reader.module.css";

type Data = {
  chapter: { id: string; label: string };
  versions: QuestionsView[];
  marks: Record<string, boolean>;
  style: Style;
  estimate: number | null;
  fake: boolean;
};

const TYPE_LABEL = { recall: "Recall", understanding: "Understanding", application: "Application" } as const;
const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Question bank for the chapter being read (M6): answers stay hidden until
 * asked for; the reader marks each one right or wrong.
 */
export function QuestionsPanel({ bookId, cfi, onBack }: { bookId: string; cfi: string; onBack: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [at] = useState(cfi);

  const show = useCallback((res: Response, body: Data & { error?: string }) => {
    if (!res.ok) setError(body.error ?? "This chapter has no questions.");
    else setData(body);
  }, []);

  useEffect(() => {
    let live = true;
    fetch(`/api/books/${bookId}/questions?${new URLSearchParams({ cfi: at })}`)
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
      const res = await fetch(`/api/books/${bookId}/questions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterId: data.chapter.id, fresh }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "That did not work. Try again.");
      setShown(new Set());
      setData({ ...data, versions: [...data.versions, ...(body.reused ? [] : [body.generation])] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mark = async (generationId: string, index: number, correct: boolean) => {
    if (!data) return;
    setData({ ...data, marks: { ...data.marks, [`${generationId}:${index}`]: correct } });
    const res = await fetch(`/api/books/${bookId}/questions/marks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ generationId, index, correct }),
    });
    if (res.ok) {
      const body = await res.json();
      setData((d) => (d ? { ...d, marks: body.marks } : d));
    } else setError("The mark was not saved. Try again.");
  };

  const mine = data?.versions.filter((v) => v.style === data.style) ?? [];
  const bank = mine.at(-1);
  const markOf = (i: number) => (bank && data ? data.marks[`${bank.id}:${i}`] : undefined);
  const right = bank?.questions.filter((q) => markOf(q.index) === true).length ?? 0;
  const wrong = bank?.questions.filter((q) => markOf(q.index) === false).length ?? 0;

  return (
    <section className={styles.panel} aria-label="Test yourself">
      <p className={styles.panelTitle}>Test yourself</p>
      <button type="button" className={styles.backLink} onClick={onBack}>
        ‹ What do I need to know?
      </button>
      {!data && !error ? <p className={styles.hint}>Finding the chapter…</p> : null}
      {data ? (
        <p className={styles.groupLabel}>
          {data.chapter.label} · {STYLES[data.style]}
        </p>
      ) : null}
      {data && !bank ? (
        <>
          <p className={styles.hint}>
            Nine questions on this chapter, to check you understood it: recall, understanding and application. Answers stay
            hidden until you ask.
          </p>
          {data.estimate === null ? (
            <p className={styles.hint}>AI is not set up yet: the owner needs to add an Anthropic API key.</p>
          ) : (
            <div className={styles.noteActions}>
              <button type="button" className={styles.primaryTool} disabled={busy} onClick={() => void ask(false)}>
                {busy ? "Writing questions…" : `Make questions (${usd(data.estimate)})`}
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
      {data && bank ? (
        <>
          <p className={styles.score} aria-live="polite" data-testid="question-score">
            {right} right · {wrong} wrong · {bank.questions.length - right - wrong} to go
          </p>
          <aside className={styles.machine} aria-label="Machine-written questions" data-testid="questions">
            <p className={styles.machineLabel}>Question bank · written by {data.fake ? "the test AI" : "AI"}</p>
            <ol className={styles.questions}>
              {bank.questions.map((q) => {
                const m = markOf(q.index);
                return (
                  <li key={q.index} className={styles.question}>
                    <p className={styles.questionType}>{TYPE_LABEL[q.type]}</p>
                    <p>{q.question}</p>
                    {shown.has(q.index) ? (
                      <>
                        <p className={styles.answer}>{q.answer}</p>
                        <div className={styles.markRow} role="group" aria-label="Your mark">
                          <button type="button" className={styles.markButton} aria-pressed={m === true} onClick={() => void mark(bank.id, q.index, true)}>
                            I got it right
                          </button>
                          <button type="button" className={styles.markButton} aria-pressed={m === false} onClick={() => void mark(bank.id, q.index, false)}>
                            I got it wrong
                          </button>
                        </div>
                      </>
                    ) : (
                      <button type="button" className={styles.tool} onClick={() => setShown(new Set(shown).add(q.index))}>
                        Show answer
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
            {bank.ste ? (
              <p className={styles.steBadge} title="Measured by the STE checker against full STE, whatever level was asked for">
                STE {Math.round(bank.ste.score)}% (full-STE score)
              </p>
            ) : null}
            <p className={styles.provenance}>
              {bank.provenance.model} · {when(bank.provenance.createdAt)} · ${bank.provenance.costUsd.toFixed(bank.provenance.costUsd < 0.01 ? 4 : 2)}
            </p>
          </aside>
          <div className={styles.versionRow}>
            <span className={styles.versionCount}>{mine.length === 1 ? "Saved questions" : `Latest of ${mine.length} sets`}</span>
            <button type="button" className={styles.tool} disabled={busy || data.estimate === null} onClick={() => void ask(true)}>
              {busy ? "Writing…" : "New questions"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
