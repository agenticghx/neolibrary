"use client";

import { useEffect, useState } from "react";
import type { AskResult, AskView, PassageView } from "@/lib/library/ask";
import { StudyTabs, type StudyTab } from "./StudyTabs";
import own from "./AskPanel.module.css";
import styles from "./reader.module.css";

type Data = { estimate: number | null; latest: AskView | null; fake: boolean };

const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
// The phone layout: there the panel covers the page, so going to a passage closes it (the answer comes back on reopening).
const PHONE = "(width <= 48rem)";

/**
 * Ask this book (M21): the reader's own question, answered by AI only from this book's paragraphs, with each
 * citation a link to its passage. Three looks, as the design rules ask: the question in the reader's italic serif,
 * the answer machine-written (tinted, dashed rule, labelled, with model, date and cost), the passages in book serif.
 */
export function AskPanel({ bookId, onTab, onGo }: { bookId: string; onTab: (tab: StudyTab) => void; onGo: (cfi: string, close: boolean) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskView | null>(null);
  const [reused, setReused] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/books/${bookId}/ask`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) return setError(body.error ?? "Ask could not be opened.");
        setData(body);
        setAnswer(body.latest);
      })
      .catch(() => live && setError("Ask could not be opened."));
    return () => {
      live = false;
    };
  }, [bookId]);

  const ask = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setMissing(null);
    try {
      const res = await fetch(`/api/books/${bookId}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const body = (await res.json().catch(() => ({}))) as AskResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "That did not work. Try again.");
      if (!body.found) {
        setMissing(q);
        return;
      }
      setAnswer(body.answer);
      setReused(body.reused);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const go = (p: PassageView) => onGo(p.cfi, window.matchMedia(PHONE).matches);
  const passage = (n: number) => answer?.passages.find((p) => p.n === n);
  const cited = answer ? [...answer.cited].sort((a, b) => a - b).flatMap((n) => passage(n) ?? []) : [];

  return (
    <section className={styles.panel} aria-label="Ask this book">
      <p className={styles.panelTitle}>Ask this book</p>
      <StudyTabs current="ask" onPick={onTab} />
      <form
        className={own.form}
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <label htmlFor="ask-question" className={styles.groupLabel}>
          Your question
        </label>
        <textarea
          id="ask-question"
          className={own.question}
          rows={3}
          maxLength={300}
          value={question}
          placeholder="What does the book say about…"
          aria-describedby="ask-how"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
        />
        <p id="ask-how" className={styles.hint}>
          Answered by AI only from this book’s own paragraphs, with a link to each place it used.
        </p>
        {!data && !error ? <p className={styles.hint}>Opening…</p> : null}
        {data && data.estimate === null ? (
          <p className={styles.hint}>AI is not set up yet: the owner needs to add an Anthropic API key.</p>
        ) : null}
        {data && data.estimate !== null ? (
          <div className={styles.noteActions}>
            <button type="submit" className={styles.primaryTool} disabled={busy || !question.trim()}>
              {busy ? "Reading the book…" : `Ask (${usd(data.estimate)})`}
            </button>
          </div>
        ) : null}
      </form>
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      {missing ? (
        <p className={styles.hint} role="status">
          No paragraph of this book has the words of “{missing}”, so nothing was asked and nothing was spent. Try the words
          the author might use.
        </p>
      ) : null}
      {answer && !missing ? (
        <div className={own.result}>
          <p className={own.asked}>
            <span className="visually-hidden">You asked: </span>“{answer.question}”
          </p>
          <aside className={styles.machine} aria-label="Machine-written answer" data-testid="ask-answer">
            <p className={styles.machineLabel}>Answer from the book · written by {data?.fake ? "the test AI" : "AI"}</p>
            {answer.paragraphs.map((para, i) => (
              <p key={i}>
                {para.map((s, j) =>
                  "cite" in s ? (
                    <button key={j} type="button" className={own.cite} onClick={() => passage(s.cite) && go(passage(s.cite)!)}>
                      [{s.cite}]<span className="visually-hidden"> go to passage {s.cite}</span>
                    </button>
                  ) : (
                    <span key={j}>{s.text}</span>
                  ),
                )}
              </p>
            ))}
            <p className={styles.provenance}>
              {answer.provenance.model} · {when(answer.provenance.createdAt)} · $
              {answer.provenance.costUsd.toFixed(answer.provenance.costUsd < 0.01 ? 4 : 2)}
              {reused ? " · asked before, so this time free" : ""}
            </p>
          </aside>
          {cited.length ? (
            <div className={own.sources}>
              <p className={styles.groupLabel}>From the book</p>
              <ol className={own.sourceList} data-testid="ask-passages">
                {cited.map((p) => (
                  <li key={p.n}>
                    <button type="button" className={own.source} onClick={() => go(p)}>
                      <span className={own.sourceWhere}>
                        <span className={own.sourceNumber}>[{p.n}]</span> {p.chapter || "The book’s text"}
                      </span>
                      <span className={own.excerpt}>{p.excerpt}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
