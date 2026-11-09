"use client";

import { useEffect, useState } from "react";
import type { GenealogyView } from "@/lib/library/genealogy-view";
import type { GenealogyTop } from "./genealogy-views";
import { StudyTabs, type StudyTab } from "./StudyTabs";
import styles from "./reader.module.css";
import own from "./GenealogyPanel.module.css";

type Loaded = GenealogyView | { none: true };

async function fetchGenealogy(bookId: string, at: string): Promise<Loaded> {
  const res = await fetch(`/api/books/${bookId}/genealogy?${new URLSearchParams({ cfi: at })}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "The genealogy could not be loaded.");
  return body as Loaded;
}

/**
 * Genealogy (M43 S3): who founded, led, bought or came out of what, as the book tells it. The three questions open
 * their views over the whole screen (GenealogyView); this tab says what there is and opens them. The links are
 * read on the laptop with Claude (the genealogy-on-subscription skill) and sent here; a book without them says so.
 */
export function GenealogyPanel({ bookId, cfi, onTab, onOpen }: { bookId: string; cfi: string; onTab: (tab: StudyTab) => void; onOpen: (data: GenealogyView, view: GenealogyTop, focus?: string) => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Where the reader was when the tab opened: the views' "read up to" starts there. Turning pages does not reload
  // it (a book's genealogy can be half a megabyte); opening a view from a new place does.
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetchGenealogy(bookId, cfi)
      .then((body) => {
        if (!live) return;
        setLoadedAt(cfi);
        setData(body);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loaded once per book; `open` reloads for a new place
  }, [bookId]);

  const open = async (view: GenealogyTop, focus?: string) => {
    let d = data;
    if (cfi !== loadedAt) {
      setBusy(true);
      d = await fetchGenealogy(bookId, cfi).catch(() => data);
      if (d) {
        setLoadedAt(cfi);
        setData(d);
      }
      setBusy(false);
    }
    if (d && !("none" in d)) onOpen(d, view, focus);
  };

  const has = data && !("none" in data) ? data : null;
  const names = has ? Object.keys(has.nodes).length : 0;
  const lives = has ? Object.keys(has.lives).length : 0;
  const QUESTIONS: [GenealogyTop, string, string][] = [
    ["tree", "Family tree", "Which company came out of which, who bought whom."],
    ["org", "Inside a company", "Who founded, led and worked there; money and parts in and out; who was there when."],
    ["person", "One person", "A life in the order it happened, against where the book tells it."],
  ];
  return (
    <section className={styles.panel} aria-label="Genealogy">
      <p className={styles.panelTitle}>Genealogy</p>
      <StudyTabs current="genealogy" onPick={onTab} />
      {!data && !error ? <p className={styles.hint}>Reading the book’s genealogy…</p> : null}
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      {data && "none" in data ? (
        <p className={styles.hint} data-testid="genealogy-none">
          No genealogy for this book yet. It is read on the laptop with Claude, on the owner’s subscription (the genealogy-on-subscription skill), and
          sent here.
        </p>
      ) : null}
      {has ? (
        <>
          <p className={own.summary} data-testid="genealogy-summary">
            {has.links.length} links between {names} people and organisations{lives ? `, ${lives} ${lives === 1 ? "life" : "lives"} put in order` : ""}. Each rests on a sentence of the
            book.
          </p>
          <div className={own.questions}>
            {QUESTIONS.map(([view, title, what]) => (
              <button key={view} type="button" className={own.question} disabled={busy} onClick={() => void open(view)}>
                <span className={own.questionTitle}>{title}</span>
                <span className={own.questionWhat}>{what}</span>
              </button>
            ))}
          </div>
          {has.top.org.length || has.top.person.length ? (
            <div className={own.most}>
              <p className={own.mostLabel}>Most linked</p>
              <div className={own.chips}>
                {has.top.org.slice(0, 4).map((n) => (
                  <button key={n} type="button" className={`${own.chip} ${own.org}`} onClick={() => void open("org", n)}>
                    {n}
                  </button>
                ))}
                {has.top.person.slice(0, 4).map((n) => (
                  <button key={n} type="button" className={`${own.chip} ${own.person}`} onClick={() => void open("person", n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <p className={styles.hint}>
            You are in chapter {has.at} of {has.n}: the views show what the book has said up to here, and a slider shows more. Read by Claude ({has.model}),{" "}
            {new Date(has.sentAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.
          </p>
        </>
      ) : null}
    </section>
  );
}
