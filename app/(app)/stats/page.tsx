import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  bookFocuses,
  chapterStatsByBook,
  focusSessions,
  readingCalendar,
  statsByBook,
  statsByPathSlot,
  statsByWeek,
  suggestionsFrom,
} from "@/lib/library/reading-stats";
import { answerFromNote, endedLabel } from "@/lib/reader/focus-session";
import styles from "../admin/invites/page.module.css";
import own from "./page.module.css";
import { ReadingCalendar } from "./ReadingCalendar";
import { StatsBreakdown } from "./StatsBreakdown";
import { WeeklyRhythmChart } from "./StatsCharts";
import { StatsPaceDips } from "./StatsPaceDips";

export const metadata: Metadata = { title: "Reading stats" };
export const dynamic = "force-dynamic";

const time = (seconds: number) => {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const words = (n: number) => n.toLocaleString("en-GB");
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const weekLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Your own reading, visual-first (Option B, Samuel 2026-11-26): concise charts, tabbed breakdowns, rules tucked in "?". */
export default async function StatsPage() {
  const user = await requireUser();
  const db = await getDb();
  const books = await statsByBook(db, user.id);
  const [weeks, { pillars, kinds }, chapterBooks, calendar, focus, wholeBooks] = await Promise.all([
    statsByWeek(db, user.id),
    statsByPathSlot(db, user.id, books),
    chapterStatsByBook(db, user.id),
    readingCalendar(db, user.id),
    focusSessions(db, user.id),
    bookFocuses(db, user.id),
  ]);
  const suggestions = suggestionsFrom(chapterBooks);
  const longest = Math.max(1, ...weeks.map((w) => w.activeSeconds));
  const totalSeconds = books.reduce((sum, b) => sum + b.activeSeconds, 0);
  const measuredBooks = books.filter((b) => b.words > 0 && b.wpm);
  const weightedWpm = measuredBooks.length
    ? Math.round(
        measuredBooks.reduce((sum, b) => sum + b.words, 0) /
          Math.max(1 / 60, measuredBooks.reduce((sum, b) => sum + b.activeSeconds, 0) / 60),
      )
    : null;

  return (
    <main className={styles.main}>
      <header className={own.pageHead}>
        <div>
          <p className={styles.eyebrow}>Your reading</p>
          <h1 className={styles.title}>Reading stats</h1>
        </div>
        <div className={own.headRight}>
          {totalSeconds > 0 ? (
            <span className={own.summaryChip}>
              {time(totalSeconds)}
              {weightedWpm ? ` · ${weightedWpm} wpm avg` : ""}
            </span>
          ) : null}
          <details className={own.helpPopover} data-testid="stats-compare">
            <summary className={own.helpSummary}>
              <svg className={own.kpiIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
              </svg>
              How it&apos;s measured
            </summary>
            <div className={own.helpBody}>
              <p>
                Only active reading counts: the clock pauses when the tab is hidden, after two minutes idle, and while listening.
                Days and weeks are counted in UTC; a streak day needs at least one full minute.
              </p>
              <p>
                Pace dips flag chapters read under 60% of your median speed in books with three or more measured chapters.
              </p>
              <p>
                <strong>Published average:</strong> 238 words per minute for non-fiction (most adults 175–300) and 260 for fiction (200–320).{" "}
                <span className={own.cite}>
                  Brysbaert (2019), <em>Journal of Memory and Language</em> 109, 104047 ·{" "}
                  <a href="https://doi.org/10.1016/j.jml.2019.104047" target="_blank" rel="noopener noreferrer">
                    doi:10.1016/j.jml.2019.104047
                  </a>
                </span>
              </p>
            </div>
          </details>
        </div>
      </header>

      {books.length === 0 ? (
        <p className={styles.empty}>Nothing yet. Read a book for a minute or more and your numbers appear here.</p>
      ) : (
        <>
          <ReadingCalendar calendar={calendar} />

          <div className={own.visualGrid}>
            <section aria-labelledby="by-week" className={own.visualCol}>
              <h2 id="by-week" className="visually-hidden">
                Week by week
              </h2>
              <WeeklyRhythmChart weeks={weeks} />
              <details className={own.tableToggle}>
                <summary className={own.tableToggleSummary}>
                  Show weekly table ({weeks.length} {weeks.length === 1 ? "week" : "weeks"})
                </summary>
                <table className={own.table} data-testid="stats-weeks">
                  <thead>
                    <tr>
                      <th scope="col">Week of</th>
                      <th scope="col">Time</th>
                      <th scope="col">Words</th>
                      <th scope="col">WPM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.map((w) => (
                      <tr key={w.weekStart}>
                        <th scope="row">{weekLabel(w.weekStart)}</th>
                        <td>
                          <span className={own.timeCell}>
                            <span className={own.timeValue}>{time(w.activeSeconds)}</span>
                            <span className={own.barTrack} aria-hidden="true">
                              <svg className={own.bar} viewBox="0 0 100 6" preserveAspectRatio="none">
                                <rect width={(w.activeSeconds / longest) * 100} height="6" rx="3" />
                              </svg>
                            </span>
                          </span>
                        </td>
                        <td>{w.words === 0 && w.activeSeconds > 0 ? "–" : words(w.words)}</td>
                        <td>{w.words === 0 && w.activeSeconds > 0 ? "–" : (w.wpm ?? "–")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </section>

            <section aria-labelledby="suggestions" className={own.visualCol} data-testid="stats-suggestions">
              <h2 id="suggestions" className="visually-hidden">
                Suggestions
              </h2>
              <StatsPaceDips books={chapterBooks} suggestions={suggestions} />
            </section>
          </div>

          <StatsBreakdown books={books} pillars={pillars} kinds={kinds} />

          {wholeBooks.length > 0 ? (
            <section aria-labelledby="book-focus" className={styles.list}>
              <h2 id="book-focus" className={styles.listTitle}>
                Whole-book focus
              </h2>
              <ol className={own.focusList} data-testid="stats-book-focus">
                {wholeBooks.map((f) => (
                  <li key={f.focusId} className={own.focusItem}>
                    <p className={own.focusMeta}>
                      <Link href={`/books/${f.bookId}`}>{f.title}</Link> · {dayLabel(f.startedAt)} to {f.endedAt ? dayLabel(f.endedAt) : `${dayLabel(f.endsAt)} (running)`}
                      {endedLabel(f.endedHow) ? <span data-testid="stats-book-focus-ended"> · {endedLabel(f.endedHow)}</span> : null}
                    </p>
                    <p className={own.focusMeta} data-testid="stats-book-focus-reading">
                      {f.days} {f.days === 1 ? "day" : "days"} read · {time(f.activeSeconds)} · {f.sittings} {f.sittings === 1 ? "sitting" : "sittings"}
                    </p>
                    <p className={own.focusQuestion}>{f.question}</p>
                    {f.answer ? <p className={own.focusAnswer}>{answerFromNote(f.answer)}</p> : <p className={own.focusNone}>{f.endedAt ? "No answer saved." : "Not answered yet."}</p>}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section aria-labelledby="focus-sessions" className={styles.list}>
            <h2 id="focus-sessions" className={styles.listTitle}>
              Focus sessions
            </h2>
            {focus.length === 0 ? (
              <p className={styles.empty}>None yet. Start one with the clock button in the reader.</p>
            ) : (
              <ol className={own.focusList} data-testid="stats-focus">
                {focus.map((f) => (
                  <li key={f.focusId} className={own.focusItem}>
                    <p className={own.focusMeta}>
                      <Link href={`/books/${f.bookId}`}>{f.title}</Link> · {dayLabel(f.startedAt)} · {time(f.activeSeconds)}
                      {endedLabel(f.endedHow) ? <span data-testid="stats-focus-ended"> · {endedLabel(f.endedHow)}</span> : null}
                    </p>
                    <p className={own.focusQuestion}>{f.question}</p>
                    {f.answer ? <p className={own.focusAnswer}>{answerFromNote(f.answer)}</p> : <p className={own.focusNone}>No answer saved.</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </main>
  );
}
