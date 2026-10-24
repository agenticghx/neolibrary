import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  bookFocuses,
  CHAPTERS_NEEDED,
  chapterStatsByBook,
  focusSessions,
  readingCalendar,
  statsByBook,
  statsByPathSlot,
  statsByWeek,
  suggestionsFrom,
  type GroupStats,
} from "@/lib/library/reading-stats";
import { answerFromNote, endedLabel } from "@/lib/reader/focus-session";
import styles from "../admin/invites/page.module.css";
import own from "./page.module.css";
import { ReadingCalendar } from "./ReadingCalendar";

export const metadata: Metadata = { title: "Reading stats" };
export const dynamic = "force-dynamic";

const time = (seconds: number) => {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const words = (n: number) => n.toLocaleString("en-GB");

/** "18 Oct 2026" for a focus session's start (UTC, as the weeks are). */
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "28 Sep" for the week starting 2026-09-28 (weeks are counted in UTC). */
const weekLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Words true for every Path (this page mixes them): your own Paths' words, with the reading list's letters (M14 step 5). */
const KIND_LABEL = { N: "Story first (N)", E: "Go deeper (E)", master: "Master key", extra: "Any order" } as const;

/** Time, words and words per minute cells shared by the group tables. */
function Numbers({ g, testId }: { g: Pick<GroupStats, "activeSeconds" | "words" | "wpm">; testId?: string }) {
  return (
    <>
      <td>{time(g.activeSeconds)}</td>
      <td>{words(g.words)}</td>
      <td data-testid={testId}>{g.wpm ?? "–"}</td>
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
        <th scope="col">Words per minute</th>
      </tr>
    </thead>
  );
}

/** Your own reading, honestly measured (M10): your trend first, a published average last and only with its source. */
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
  const measured = chapterBooks.filter((b) => b.chapters.length >= CHAPTERS_NEEDED).length;
  const longest = Math.max(1, ...weeks.map((w) => w.activeSeconds));
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Your reading</p>
      <h1 className={styles.title}>Reading stats</h1>
      <p className={styles.lede}>
        Only active reading counts: the clock stops when the tab is hidden, after two minutes with no page turn or tap, and
        while the book is read aloud to you. Words are the words on the pages you saw, each page once per sitting.
        Speed counts only sittings of a minute or more at under 1,000 words per minute, so flicking through pages adds
        to words read but not to speed.
      </p>

      {books.length === 0 ? (
        <p className={styles.empty}>Nothing yet. Read a book for a minute or more and your numbers appear here.</p>
      ) : (
        <>
          <ReadingCalendar calendar={calendar} />

          <section aria-labelledby="by-week" className={styles.list}>
            <h2 id="by-week" className={styles.listTitle}>
              Week by week
            </h2>
            <p className={own.note}>Weeks start on Monday (UTC). Weeks with no reading show as 0 min.</p>
            <table className={own.table} data-testid="stats-weeks">
              <Head first="Week of" />
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.weekStart}>
                    <th scope="row">{weekLabel(w.weekStart)}</th>
                    <td>
                      <span className={own.timeCell}>
                        <svg className={own.bar} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                          <rect width={(w.activeSeconds / longest) * 100} height="10" rx="1" />
                        </svg>
                        {time(w.activeSeconds)}
                      </span>
                    </td>
                    <td>{words(w.words)}</td>
                    <td>{w.wpm ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="suggestions" className={styles.list} data-testid="stats-suggestions">
            <h2 id="suggestions" className={styles.listTitle}>
              Suggestions
            </h2>
            {suggestions.length > 0 ? (
              <ul className={own.suggestions}>
                {suggestions.map((x) => (
                  <li key={`${x.bookId}-${x.chapterKey}`}>
                    In <Link href={`/books/${x.bookId}/read`}>{x.title}</Link>, your speed drops sharply in{" "}
                    <strong>{x.chapter}</strong>: {x.chapterWpm} words per minute, against your usual {x.usualWpm} in this
                    book. Try <em>What do I need to know?</em> in the reader for the background this chapter assumes.
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>
                {measured > 0
                  ? "None for now: your speed is steady across the chapters you have read."
                  : "None yet. They appear once a book has three chapters with two minutes or more of reading each."}
              </p>
            )}
            <p className={own.note}>
              A suggestion names a chapter you read at under 60% of your usual speed in that book (the middle value of its
              chapters), counting only chapters with two minutes or more of reading.
            </p>
          </section>

          <section aria-labelledby="by-pillar" className={styles.list}>
            <h2 id="by-pillar" className={styles.listTitle}>
              By section
            </h2>
            {pillars.length === 0 ? (
              <p className={styles.empty}>None of the books you have read sit on a Path yet.</p>
            ) : (
              <>
                <p className={own.note}>A book that sits in two sections counts in both.</p>
                <table className={own.table} data-testid="stats-pillars">
                  <Head first="Section" />
                  <tbody>
                    {pillars.map((p) => (
                      <tr key={p.pillarId}>
                        <th scope="row">
                          {p.title}
                          <span className={own.sub}>{p.path}</span>
                        </th>
                        <Numbers g={p} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          {kinds.length > 0 ? (
            <section aria-labelledby="by-kind" className={styles.list}>
              <h2 id="by-kind" className={styles.listTitle}>
                By how to read it
              </h2>
              <p className={own.note}>
                How each title is marked on its Path: Story first (N) is read first, for the story; Go deeper (E) is read
                next, to go further; Any order whenever you like.
              </p>
              <table className={own.table} data-testid="stats-kinds">
                <Head first="How to read it" />
                <tbody>
                  {kinds.map((k) => (
                    <tr key={k.kind}>
                      <th scope="row">{KIND_LABEL[k.kind]}</th>
                      <Numbers g={k} testId={`wpm-kind-${k.kind}`} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {/* M26 R5: a card for each whole-book focus, only once there is one. */}
          {wholeBooks.length > 0 ? (
            <section aria-labelledby="book-focus" className={styles.list}>
              <h2 id="book-focus" className={styles.listTitle}>
                Whole-book focus
              </h2>
              <p className={own.note}>One book only, for days (Focus session in the reader, then The whole book). Your answer is a note on the book.</p>
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
            <p className={own.note}>
              A sitting you began with a question and a timer (the clock button in the reader). Your answer is a note on the
              book, and comes back in Daily review.
            </p>
            {focus.length === 0 ? (
              <p className={styles.empty}>None yet. In the reader, press the clock, write the question you are reading to answer, and start the timer.</p>
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

          <section aria-labelledby="by-book" className={styles.list}>
            <h2 id="by-book" className={styles.listTitle}>
              By book
            </h2>
            <table className={own.table} data-testid="stats-books">
              <Head first="Book" />
              <tbody>
                {books.map((b) => (
                  <tr key={b.bookId}>
                    <th scope="row">
                      <Link href={`/books/${b.bookId}`}>{b.title}</Link>
                    </th>
                    <Numbers g={b} testId={`wpm-${b.bookId}`} />
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <aside aria-labelledby="compare" className={own.compare} data-testid="stats-compare">
        <h2 id="compare" className={own.compareTitle}>
          For comparison
        </h2>
        <p>
          A review of 190 studies with 18,573 participants found that adults reading English silently average{" "}
          <strong>238 words per minute for non-fiction</strong> (most adults between 175 and 300) and{" "}
          <strong>260 for fiction</strong> (most between 200 and 320).
        </p>
        <p>
          Those studies measured reading with comprehension checks; your number counts the words on the pages you saw
          during active time. The two are close, but not the same measurement, so treat this as a rough guide. Your own
          trend above is the better measure.
        </p>
        <p className={own.cite}>
          Source: Marc Brysbaert (2019). How many words do we read per minute? A review and meta-analysis of reading rate.{" "}
          <em>Journal of Memory and Language</em> 109, 104047.{" "}
          <a href="https://doi.org/10.1016/j.jml.2019.104047" rel="noreferrer">
            doi:10.1016/j.jml.2019.104047
          </a>
        </p>
      </aside>
    </main>
  );
}
