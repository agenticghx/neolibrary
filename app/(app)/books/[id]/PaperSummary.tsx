"use client";

import { useEffect, useState } from "react";
import forms from "@/components/forms.module.css";
import { aiFetch } from "@/lib/own-keys";
import styles from "./page.module.css";

type Card = { question: string; method: string; finding: string; limits: string };
type Version = { id: string; card: Card | null; provenance: { model: string; createdAt: string; costUsd: number } };
type Data = { versions: Version[]; estimate: number | null; fake: boolean };

const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const ROWS: [keyof Card, string][] = [
  ["question", "The question"],
  ["method", "The method"],
  ["finding", "The main finding"],
  ["limits", "The limits"],
];

/**
 * A paper's summary card on its page (M41 R4a): the question, the method, the main finding and the limits, written by
 * AI from the paper and stored. Making one is paid (its cost shown first) and asked for on purpose; the stored card
 * shows free from then on, labelled with the model, date and cost.
 */
export function PaperSummary({ bookId }: { bookId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await aiFetch(`/api/books/${bookId}/paper-summary`).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (!live) return;
      if (res?.ok) setData(body as Data);
      else setError((body as { error?: string }).error ?? "The library could not be reached.");
    })();
    return () => {
      live = false;
    };
  }, [bookId]);

  async function make(fresh: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await aiFetch(`/api/books/${bookId}/paper-summary`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fresh }) });
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
  return (
    <section className={styles.notes} aria-labelledby="summary-card" data-testid="paper-summary">
      <h2 id="summary-card" className={styles.collectionsTitle}>
        Summary card
      </h2>
      {latest?.card ? (
        <>
          <p className={styles.machineLabel}>Written by {data?.fake ? "the test AI" : "AI"} from the paper</p>
          <dl className={styles.summaryCard}>
            {ROWS.map(([k, label]) => (
              <div key={k} className={styles.summaryRow}>
                <dt>{label}</dt>
                <dd>{latest.card![k]}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.machineLabel}>
            {latest.provenance.model} · {when(latest.provenance.createdAt)} · ${latest.provenance.costUsd.toFixed(latest.provenance.costUsd < 0.01 ? 4 : 2)}
          </p>
          <button type="button" className={styles.paperUndo} onClick={() => make(true)} disabled={busy}>
            {busy ? "Reading the paper…" : `Make it again${data?.estimate != null ? ` (${usd(data.estimate)})` : ""}`}
          </button>
        </>
      ) : data ? (
        data.estimate == null ? (
          <p className={styles.notesSummary}>AI is not set up on this library, so a summary card cannot be made yet.</p>
        ) : (
          <>
            <p className={styles.notesSummary}>The question, the method, the main finding and the limits, on one screen, written by AI from the paper.</p>
            <button type="button" className={styles.paperFind} onClick={() => make(false)} disabled={busy}>
              {busy ? "Reading the paper…" : `Make a summary card (${data.fake ? "test AI, free" : usd(data.estimate)})`}
            </button>
          </>
        )
      ) : null}
      {error ? (
        <p role="alert" className={forms.error}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
