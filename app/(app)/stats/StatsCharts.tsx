import Link from "next/link";
import type { ChapterStats, KindStats, Suggestion, WeekStats } from "@/lib/library/reading-stats";
import { SHARP_DROP } from "@/lib/library/reading-stats";
import own from "./page.module.css";

const shortTime = (seconds: number) => {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const weekLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const KIND_LABEL: Record<KindStats["kind"], string> = {
  N: "Story first (N)",
  E: "Go deeper (E)",
  master: "Master key",
  extra: "Any order",
};

const KIND_CLASS: Record<KindStats["kind"], string> = {
  N: own.balN,
  E: own.balE,
  master: own.balMaster,
  extra: own.balExtra,
};

/** Pure geometry for the weekly rhythm SVG (bar heights + optional WPM trend line). */
export function weeklyGeometry(weeks: WeekStats[]) {
  const ordered = [...weeks].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const maxSec = Math.max(60, ...ordered.map((w) => w.activeSeconds));
  const wpms = ordered.map((w) => w.wpm).filter((n): n is number => n !== null && n > 0);
  const maxWpm = wpms.length ? Math.max(...wpms) : 0;
  const minWpm = wpms.length ? Math.min(...wpms) : 0;
  const spanWpm = Math.max(40, maxWpm - minWpm);
  const padL = 12;
  const padR = 12;
  const padT = 16;
  const plotW = 560 - padL - padR;
  const plotH = 120;
  const n = Math.max(1, ordered.length);
  const slot = plotW / n;
  const barW = Math.max(8, Math.min(34, slot * 0.62));

  const bars = ordered.map((w, i) => {
    const cx = padL + slot * i + slot / 2;
    const h = w.activeSeconds > 0 ? Math.max(3, (w.activeSeconds / maxSec) * plotH) : 0;
    const y = padT + plotH - h;
    const wpmY =
      w.wpm !== null && maxWpm > 0
        ? padT + plotH - ((w.wpm - Math.max(0, minWpm - 20)) / (spanWpm + 40)) * (plotH - 12) - 6
        : null;
    return { week: w, cx, x: cx - barW / 2, y, w: barW, h, wpmY };
  });

  const linePoints = bars
    .filter((b) => b.wpmY !== null)
    .map((b) => `${b.cx.toFixed(1)},${b.wpmY!.toFixed(1)}`)
    .join(" ");

  return { bars, linePoints, maxSec, plotYEnd: padT + plotH, padL, plotW, padT, plotH };
}

/**
 * Print-inspired weekly rhythm chart: vertical bars for active reading time overlaid with
 * a subtle speed trend line where speed was measured. Pure server-rendered SVG.
 */
export function WeeklyRhythmChart({ weeks }: { weeks: WeekStats[] }) {
  if (weeks.length < 2) return null;
  const g = weeklyGeometry(weeks);
  const labelStep = g.bars.length <= 8 ? 1 : Math.ceil(g.bars.length / 6);
  const peak = g.bars.reduce((best, b) => (b.week.activeSeconds > best.week.activeSeconds ? b : best), g.bars[0]!);
  return (
    <figure className={own.chartCard} data-testid="chart-weekly-rhythm">
      <div className={own.chartHead}>
        <span className={own.chartTitle}>Weekly reading rhythm</span>
        <span className={own.chartMeta}>Peak week: {shortTime(peak.week.activeSeconds)} ({weekLabel(peak.week.weekStart)})</span>
      </div>
      <svg className={own.chartSvg} viewBox="0 0 560 166" role="img" aria-label={`Weekly reading time across ${g.bars.length} weeks, peaking at ${shortTime(peak.week.activeSeconds)}`}>
        <line x1={g.padL} y1={g.padT} x2={g.padL + g.plotW} y2={g.padT} className={own.gridLine} />
        <line x1={g.padL} y1={g.padT + g.plotH / 2} x2={g.padL + g.plotW} y2={g.padT + g.plotH / 2} className={own.gridLine} />
        <line x1={g.padL} y1={g.plotYEnd} x2={g.padL + g.plotW} y2={g.plotYEnd} className={own.baseLine} />
        {g.bars.map((b, i) => (
          <g key={b.week.weekStart}>
            {b.h > 0 ? (
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx="3"
                className={b.week.activeSeconds === g.maxSec ? own.barPeak : own.barFill}
              >
                <title>
                  {`${weekLabel(b.week.weekStart)}: ${shortTime(b.week.activeSeconds)}, ${b.week.words.toLocaleString("en-GB")} words${b.week.wpm ? `, ${b.week.wpm} wpm` : ""}`}
                </title>
              </rect>
            ) : null}
            {i % labelStep === 0 || i === g.bars.length - 1 ? (
              <text x={b.cx} y={g.plotYEnd + 18} textAnchor="middle" className={own.axisLabel}>
                {weekLabel(b.week.weekStart)}
              </text>
            ) : null}
          </g>
        ))}
        {g.linePoints ? <polyline points={g.linePoints} className={own.trendLine} /> : null}
        {g.bars.map((b) =>
          b.wpmY !== null ? (
            <circle key={`pt-${b.week.weekStart}`} cx={b.cx} cy={b.wpmY} r="3.5" className={own.trendDot}>
              <title>{`${weekLabel(b.week.weekStart)}: ${b.week.wpm} words per minute`}</title>
            </circle>
          ) : null,
        )}
      </svg>
      <figcaption className={own.chartLegend}>
        <span><i className={own.swatchBar} aria-hidden="true" />Active time</span>
        {g.linePoints ? <span><i className={own.swatchLine} aria-hidden="true" />Words per minute trend</span> : null}
      </figcaption>
    </figure>
  );
}

/** Pure geometry for a single book's chapter pace profile. */
export function chapterGeometry(chapters: ChapterStats[]) {
  const sortedWpm = [...chapters.map((c) => c.wpm)].sort((a, b) => a - b);
  const mid = Math.floor(sortedWpm.length / 2);
  const usual = sortedWpm.length % 2 ? sortedWpm[mid]! : (sortedWpm[mid - 1]! + sortedWpm[mid]!) / 2;
  const maxWpm = Math.max(usual * 1.25, ...chapters.map((c) => c.wpm), 100);
  const padL = 10;
  const padR = 10;
  const padT = 10;
  const plotW = 360 - padL - padR;
  const plotH = 68;
  const yFor = (wpm: number) => padT + plotH - Math.max(0, Math.min(1, wpm / maxWpm)) * plotH;
  const step = chapters.length > 1 ? plotW / (chapters.length - 1) : 0;

  const points = chapters.map((c, i) => ({
    chapter: c,
    x: chapters.length > 1 ? padL + step * i : padL + plotW / 2,
    y: yFor(c.wpm),
    dip: c.wpm < usual * SHARP_DROP,
  }));

  return {
    usual: Math.round(usual),
    thresholdY: yFor(usual * SHARP_DROP),
    bandTop: yFor(usual * 1.15),
    bandHeight: Math.max(4, yFor(usual * 0.85) - yFor(usual * 1.15)),
    points,
    polyline: points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
    padL,
    plotW,
    plotYEnd: padT + plotH,
  };
}

/**
 * Per-book chapter pace & difficulty sparklines: shows where reading speed stays
 * inside the reader's usual band and highlights sharp slowdowns (< 60% of median).
 */
export function ChapterPaceChart({
  books,
  suggestions,
}: {
  books: { bookId: string; title: string; chapters: ChapterStats[] }[];
  suggestions: Suggestion[];
}) {
  const profiles = books.filter((b) => b.chapters.length >= 2);
  if (!profiles.length) return null;
  const dipKeys = new Set(suggestions.map((s) => `${s.bookId}:${s.chapterKey}`));
  return (
    <div className={own.paceGrid} data-testid="chart-chapter-pace">
      {profiles.map((b) => {
        const g = chapterGeometry(b.chapters);
        return (
          <figure key={b.bookId} className={own.paceCard}>
            <div className={own.chartHead}>
              <Link href={`/books/${b.bookId}/read`} className={own.paceTitle}>
                {b.title}
              </Link>
              <span className={own.chartMeta}>Usual: {g.usual} wpm · {b.chapters.length} chapters</span>
            </div>
            <svg className={own.paceSvg} viewBox="0 0 360 88" role="img" aria-label={`Chapter pace for ${b.title}, usual speed ${g.usual} words per minute`}>
              <rect x={g.padL} y={g.bandTop} width={g.plotW} height={g.bandHeight} className={own.paceBand} />
              <line x1={g.padL} y1={g.thresholdY} x2={g.padL + g.plotW} y2={g.thresholdY} className={own.thresholdLine} />
              <line x1={g.padL} y1={g.plotYEnd} x2={g.padL + g.plotW} y2={g.plotYEnd} className={own.baseLine} />
              <polyline points={g.polyline} className={own.paceLine} />
              {g.points.map((p) => {
                const isDip = p.dip || dipKeys.has(`${b.bookId}:${p.chapter.key}`);
                return (
                  <circle key={p.chapter.key} cx={p.x} cy={p.y} r={isDip ? "4.5" : "3"} className={isDip ? own.paceDipDot : own.paceDot}>
                    <title>{`${p.chapter.label}: ${p.chapter.wpm} wpm (${shortTime(p.chapter.activeSeconds)})`}</title>
                  </circle>
                );
              })}
            </svg>
          </figure>
        );
      })}
    </div>
  );
}

function balanceSegments(kinds: KindStats[], total: number) {
  let cursor = 0;
  return kinds.map((k) => {
    const share = k.activeSeconds / total;
    const x = cursor * 560;
    const width = Math.max(4, share * 560);
    cursor += share;
    return { kind: k, x, width, pct: Math.round(share * 100) };
  });
}

/** Proportional horizontal balance bar comparing reading time across how-to-read modes (N vs E vs Any order). */
export function ReadingBalanceChart({ kinds }: { kinds: KindStats[] }) {
  const total = kinds.reduce((sum, k) => sum + k.activeSeconds, 0);
  if (total <= 0) return null;
  const segments = balanceSegments(kinds, total);
  return (
    <figure className={own.chartCard} data-testid="chart-reading-balance">
      <svg className={own.balanceSvg} viewBox="0 0 560 20" role="img" aria-label="Share of reading time by reading mode">
        {segments.map((s) => (
          <rect key={s.kind.kind} x={s.x} y="2" width={s.width} height="16" rx="3" className={KIND_CLASS[s.kind.kind]}>
            <title>{`${KIND_LABEL[s.kind.kind]}: ${s.pct}% (${shortTime(s.kind.activeSeconds)})`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className={own.chartLegend}>
        {segments.map((s) => (
          <span key={s.kind.kind}>
            <i className={[own.swatchDot, KIND_CLASS[s.kind.kind]].join(" ")} aria-hidden="true" />
            {KIND_LABEL[s.kind.kind]} · {s.pct}%
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
