"use client";

import Link from "next/link";
import { useState } from "react";
import type { BookStats, GroupStats, KindStats, PillarStats } from "@/lib/library/reading-stats";
import { ReadingBalanceChart } from "./StatsCharts";
import own from "./page.module.css";

type Tab = "books" | "sections" | "style";

const time = (seconds: number) => {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const words = (n: number) => n.toLocaleString("en-GB");

const KIND_LABEL: Record<KindStats["kind"], string> = {
  N: "Story first (N)",
  E: "Go deeper (E)",
  master: "Master key",
  extra: "Any order",
};

function Numbers({ g, maxSec, testId }: { g: Pick<GroupStats, "activeSeconds" | "words" | "wpm">; maxSec: number; testId?: string }) {
  const uncounted = g.words === 0 && g.activeSeconds > 0;
  const pct = maxSec > 0 ? Math.max(2, Math.round((g.activeSeconds / maxSec) * 100)) : 0;
  return (
    <>
      <td>
        <span className={own.timeCell}>
          <span className={own.timeValue}>{time(g.activeSeconds)}</span>
          <span className={own.barTrack} aria-hidden="true">
            <svg className={own.bar} viewBox="0 0 100 6" preserveAspectRatio="none">
              <rect width={pct} height="6" rx="3" />
            </svg>
          </span>
        </span>
      </td>
      <td>{uncounted ? "–" : words(g.words)}</td>
      <td data-testid={testId}>{uncounted || !g.wpm ? "–" : g.wpm}</td>
    </>
  );
}

function Head({ first }: { first: string }) {
  return (
    <thead>
      <tr>
        <th scope="col">{first}</th>
        <th scope="col">Time</th>
        <th scope="col">Words</th>
        <th scope="col">WPM</th>
      </tr>
    </thead>
  );
}

/**
 * Unified tabbed breakdown (Option B): replaces three stacked full-width tables
 * (By book, By section, By how to read it) with one clean visual switcher.
 */
export function StatsBreakdown({
  books,
  pillars,
  kinds,
}: {
  books: BookStats[];
  pillars: PillarStats[];
  kinds: KindStats[];
}) {
  const [tab, setTab] = useState<Tab>("books");
  const maxBookSec = Math.max(1, ...books.map((b) => b.activeSeconds));
  const maxPillarSec = Math.max(1, ...pillars.map((p) => p.activeSeconds));
  const maxKindSec = Math.max(1, ...kinds.map((k) => k.activeSeconds));

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "books", label: "By book", count: books.length },
    { id: "sections", label: "By section", count: pillars.length },
    ...(kinds.length > 0 ? [{ id: "style" as const, label: "By how to read it", count: kinds.length }] : []),
  ];

  return (
    <section aria-label="Reading breakdown" className={own.chartCard}>
      <div className={own.breakdownHead}>
        <div className={own.pillRow} role="tablist" aria-label="Breakdown views">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? `${own.pill} ${own.pillActive}` : own.pill}
              onClick={() => setTab(t.id)}
            >
              <span>{t.label}</span>
              <span className={own.pillCount}>{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === "books" ? (
        <table className={own.table} data-testid="stats-books">
          <Head first="Book" />
          <tbody>
            {books.map((b) => (
              <tr key={b.bookId}>
                <th scope="row">
                  <Link href={`/books/${b.bookId}`}>{b.title}</Link>
                </th>
                <Numbers g={b} maxSec={maxBookSec} testId={`wpm-${b.bookId}`} />
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {tab === "sections" ? (
        pillars.length === 0 ? (
          <p className={own.emptyCompact}>None of the books you have read sit on a Path yet.</p>
        ) : (
          <table className={own.table} data-testid="stats-pillars">
            <Head first="Section" />
            <tbody>
              {pillars.map((p) => (
                <tr key={p.pillarId}>
                  <th scope="row">
                    {p.title}
                    <span className={own.sub}>{p.path}</span>
                  </th>
                  <Numbers g={p} maxSec={maxPillarSec} />
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      {tab === "style" && kinds.length > 0 ? (
        <div className={own.stylePanel}>
          {kinds.length >= 2 ? <ReadingBalanceChart kinds={kinds} /> : null}
          <table className={own.table} data-testid="stats-kinds">
            <Head first="How to read it" />
            <tbody>
              {kinds.map((k) => (
                <tr key={k.kind}>
                  <th scope="row">{KIND_LABEL[k.kind]}</th>
                  <Numbers g={k} maxSec={maxKindSec} testId={`wpm-kind-${k.kind}`} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
