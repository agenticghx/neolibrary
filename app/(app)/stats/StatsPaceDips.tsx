"use client";

import Link from "next/link";
import { useState } from "react";
import type { ChapterStats, Suggestion } from "@/lib/library/reading-stats";
import { CHAPTERS_NEEDED } from "@/lib/library/reading-stats";
import { chapterGeometry } from "./StatsCharts";
import own from "./page.module.css";

const shortTime = (seconds: number) => {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/**
 * Interactive Pace dips card (Option B): pick a book with 3+ measured chapters to inspect
 * its sparkline and compact list of slow chapters (< 60% of usual speed) without repeating
 * 30-word template prose.
 */
export function StatsPaceDips({
  books,
  suggestions,
}: {
  books: { bookId: string; title: string; chapters: ChapterStats[] }[];
  suggestions: Suggestion[];
}) {
  const profiles = books.filter((b) => b.chapters.length >= CHAPTERS_NEEDED && b.chapters.some((c) => c.wpm > 0));
  const defaultIdx = Math.max(
    0,
    profiles.findIndex((b) => suggestions.some((s) => s.bookId === b.bookId)),
  );
  const [selected, setSelected] = useState(defaultIdx);

  if (!profiles.length) {
    return (
      <div className={own.chartCard}>
        <div className={own.chartHead}>
          <span className={own.chartTitle}>Pace dips</span>
        </div>
        <p className={own.emptyCompact}>Appears once a book has three chapters with two minutes or more of reading each.</p>
      </div>
    );
  }

  const active = profiles[Math.min(selected, profiles.length - 1)]!;
  const g = chapterGeometry(active.chapters);
  const bookDips = suggestions.filter((s) => s.bookId === active.bookId);
  const dipKeys = new Set(bookDips.map((s) => s.chapterKey));

  return (
    <div className={own.chartCard}>
      <div className={own.chartHead}>
        <span className={own.chartTitle}>Pace dips</span>
        <span className={own.chartMeta}>
          Usual: {g.usual} wpm · {active.chapters.length} chapters
        </span>
      </div>

      {profiles.length > 1 ? (
        <div className={own.pillRow} role="tablist" aria-label="Books with chapter pace">
          {profiles.map((b, i) => {
            const count = suggestions.filter((s) => s.bookId === b.bookId).length;
            return (
              <button
                key={b.bookId}
                type="button"
                role="tab"
                aria-selected={i === Math.min(selected, profiles.length - 1)}
                className={i === Math.min(selected, profiles.length - 1) ? `${own.pill} ${own.pillActive}` : own.pill}
                onClick={() => setSelected(i)}
              >
                <span className={own.pillText}>{b.title}</span>
                {count > 0 ? <span className={own.pillCount}>{count}</span> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <p className={own.paceSingleTitle}>{active.title}</p>
      )}

      <svg
        className={own.paceSvg}
        viewBox="0 0 360 88"
        role="img"
        aria-label={`Chapter pace for ${active.title}, usual speed ${g.usual} words per minute`}
      >
        <rect x={g.padL} y={g.bandTop} width={g.plotW} height={g.bandHeight} className={own.paceBand} />
        <line x1={g.padL} y1={g.thresholdY} x2={g.padL + g.plotW} y2={g.thresholdY} className={own.thresholdLine} />
        <line x1={g.padL} y1={g.plotYEnd} x2={g.padL + g.plotW} y2={g.plotYEnd} className={own.baseLine} />
        <polyline points={g.polyline} className={own.paceLine} />
        {g.points.map((p) => {
          const isDip = dipKeys.has(p.chapter.key);
          return (
            <circle key={p.chapter.key} cx={p.x} cy={p.y} r={isDip ? "4.5" : "3"} className={isDip ? own.paceDipDot : own.paceDot}>
              <title>{`${p.chapter.label}: ${p.chapter.wpm} wpm (${shortTime(p.chapter.activeSeconds)})`}</title>
            </circle>
          );
        })}
      </svg>

      {bookDips.length > 0 ? (
        <ul className={own.dipList}>
          {bookDips.map((x) => (
            <li key={`${x.bookId}-${x.chapterKey}`} className={own.dipRow}>
              <div className={own.dipInfo}>
                <Link href={`/books/${x.bookId}/read`} className={own.dipBook}>
                  {x.title}
                </Link>
                <span className={own.dipChapter}>{x.chapter}</span>
              </div>
              <span className={own.dipSpeed}>
                <strong>{x.chapterWpm}</strong> vs {x.usualWpm} wpm
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={own.emptyCompact}>Steady pace across every chapter in {active.title}.</p>
      )}
    </div>
  );
}
