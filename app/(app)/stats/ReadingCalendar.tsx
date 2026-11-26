import { HEAT_STEPS, type ReadingCalendar as Calendar } from "@/lib/library/reading-stats";
import styles from "../admin/invites/page.module.css";
import own from "./page.module.css";

/*
 * The reading calendar and streaks (M21): one square per day for the last 26
 * weeks, GitHub-style, weeks as columns (Monday at the top), shaded by minutes
 * read. It is a real table: screen readers move through it by week and weekday,
 * and every square says its day and minutes ("Wednesday 7 October: 23 minutes").
 * Days are UTC days, like the weekly table (see lib/library/reading-stats.ts).
 */

const STEP_CLASS = [own.step0, own.step1, own.step2, own.step3, own.step4];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** Rows with a visible weekday label; the others are named for screen readers only. */
const LABELLED_DAYS = new Set([0, 2, 4]);

const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const format = (date: string, options: Intl.DateTimeFormatOptions) =>
  utc(date).toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });

/** "Wednesday 7 October" */
const dayName = (date: string) => format(date, { weekday: "long", day: "numeric", month: "long" });

/** Whole minutes, never rounded up: a square is shaded only for a full minute. */
function minutesText(seconds: number) {
  const m = Math.floor(seconds / 60);
  if (seconds === 0) return "no reading";
  if (m === 0) return "under a minute";
  return m === 1 ? "1 minute" : `${m} minutes`;
}

/** "45 min", "3 h 5 min": the page's way of writing time, in whole minutes. */
function shortTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** The shades' meanings, from the steps in lib/library/reading-stats.ts: no reading, 1 to 14 minutes, …, an hour or more. */
const LEGEND = [
  "No reading",
  ...HEAT_STEPS.map((from, i) => (i + 1 < HEAT_STEPS.length ? `${from} to ${HEAT_STEPS[i + 1] - 1} minutes` : `${from} minutes or more`)),
];

export function ReadingCalendar({ calendar }: { calendar: Calendar }) {
  const { weeks, current, longest, best, daysRead } = calendar;
  const todayRead = weeks.flat().some((d) => d?.today && d.step > 0);
  const mondays = weeks.map((w) => w[0]!.date);
  const months = mondays.map((d) => utc(d).getUTCMonth());
  /** A month's name above the first week that starts in it; not above a first week too narrow to hold it. */
  const monthShown = (i: number) => (i === 0 ? months[1] === months[0] && months[2] === months[0] : months[i] !== months[i - 1]);
  return (
    <section aria-labelledby="calendar" className={styles.list} data-testid="stats-calendar">
      <h2 id="calendar" className={styles.listTitle}>
        Reading calendar
      </h2>

      <dl className={own.streaks}>
        <div className={own.streak}>
          <dt className={own.streakLabel}>
            <svg className={own.kpiIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2c.5 4-3 6-3 10a5 5 0 0 0 10 0c0-3-2-5-3-7-1 2-2 2.5-4 1 1-1.5 1-3 0-4z" />
            </svg>
            Current streak
          </dt>
          <dd>
            <span className={own.streakValue} data-testid="streak-current">
              {days(current)}
            </span>
            <span className={own.streakSub}>
              {current === 0 ? "Read today to start one" : todayRead ? "Including today" : "Read today to keep it going"}
            </span>
          </dd>
        </div>
        <div className={own.streak}>
          <dt className={own.streakLabel}>
            <svg className={own.kpiIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9H4a2 2 0 0 1-2-2V5h4M18 9h2a2 2 0 0 0 2-2V5h-4M6 4h12v6a6 6 0 0 1-12 0V4zM12 16v4M8 20h8" />
            </svg>
            Longest streak
          </dt>
          <dd>
            <span className={own.streakValue} data-testid="streak-longest">
              {days(longest)}
            </span>
            <span className={own.streakSub}>Ever</span>
          </dd>
        </div>
        <div className={own.streak}>
          <dt className={own.streakLabel}>
            <svg className={own.kpiIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Best day
          </dt>
          <dd>
            <span className={own.streakValue} data-testid="streak-best">
              {best ? shortTime(best.seconds) : "None yet"}
            </span>
            <span className={own.streakSub} data-testid="streak-best-date">
              {best
                ? format(best.date, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "Read a minute to have one"}
            </span>
          </dd>
        </div>
        <div className={own.streak}>
          <dt className={own.streakLabel}>
            <svg className={own.kpiIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            Days read
          </dt>
          <dd>
            <span className={own.streakValue} data-testid="streak-days">
              {daysRead}
            </span>
            <span className={own.streakSub}>In the last 26 weeks</span>
          </dd>
        </div>
      </dl>

      {/* Scrolls sideways inside its own box when the screen is too narrow, starting at today (the right end). */}
      <div className={own.calendarScroll} tabIndex={0} role="region" aria-label="Reading calendar, the last 26 weeks">
        <div className={own.calendarInner}>
          <table className={own.calendar} data-testid="calendar-grid">
            <caption className="visually-hidden">
              Minutes read each day for the last 26 weeks. Each column is a week from Monday to Sunday, the oldest first.
            </caption>
            <thead>
              <tr>
                <td />
                {mondays.map((monday, i) => (
                  <th key={monday} scope="col" className={own.week}>
                    <span className="visually-hidden">Week of {format(monday, { day: "numeric", month: "long" })}</span>
                    {monthShown(i) ? (
                      <span aria-hidden="true" className={i >= mondays.length - 2 ? `${own.month} ${own.monthEnd}` : own.month}>
                        {format(monday, { month: "short" })}
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((weekday, row) => (
                <tr key={weekday}>
                  <th scope="row" className={own.weekday}>
                    <span className="visually-hidden">{weekday}</span>
                    {LABELLED_DAYS.has(row) ? <span aria-hidden="true">{weekday.slice(0, 3)}</span> : null}
                  </th>
                  {weeks.map((week, w) => {
                    const day = week[row];
                    if (!day) return <td key={`future-${w}`} className={own.future} />;
                    const dayTitle = `${dayName(day.date)}${day.today ? ", today" : ""}: ${minutesText(day.seconds)}`;
                    return (
                      <td
                        key={day.date}
                        className={`${own.day} ${STEP_CLASS[day.step]}${day.today ? ` ${own.today}` : ""}`}
                        data-step={day.step}
                        title={dayTitle}
                      >
                        <span className="visually-hidden">{dayTitle}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className={own.legend} data-testid="calendar-legend">
            <span aria-hidden="true">Less</span>
            <ul className={own.legendList} aria-label="Shades, from less reading to more">
              {LEGEND.map((text, step) => (
                <li key={text} className={`${own.day} ${STEP_CLASS[step]}`} title={text}>
                  <span className="visually-hidden">{text}</span>
                </li>
              ))}
            </ul>
            <span aria-hidden="true">More</span>
          </div>
        </div>
      </div>
    </section>
  );
}
