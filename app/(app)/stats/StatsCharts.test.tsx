import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChapterPaceChart, ReadingBalanceChart, WeeklyRhythmChart, chapterGeometry, weeklyGeometry } from "./StatsCharts";

describe("StatsCharts", () => {
  it("computes chronological weekly bars and trend points", () => {
    const g = weeklyGeometry([
      { weekStart: "2026-10-12", activeSeconds: 3600, words: 12000, sessions: 3, wpm: 200 },
      { weekStart: "2026-10-05", activeSeconds: 1800, words: 7200, sessions: 2, wpm: 240 },
    ]);
    expect(g.bars.map((b) => b.week.weekStart)).toEqual(["2026-10-05", "2026-10-12"]);
    expect(g.bars[1]!.h).toBeGreaterThan(g.bars[0]!.h);
    expect(g.linePoints.split(" ")).toHaveLength(2);
  });

  it("handles zero-minute weeks without NaN coordinates", () => {
    const g = weeklyGeometry([
      { weekStart: "2026-10-05", activeSeconds: 0, words: 0, sessions: 0, wpm: null },
      { weekStart: "2026-10-12", activeSeconds: 600, words: 2000, sessions: 1, wpm: 200 },
    ]);
    expect(g.bars[0]!.h).toBe(0);
    expect(Number.isFinite(g.bars[1]!.y)).toBe(true);
  });

  it("flags sharp chapter speed drops below 60% of the book median", () => {
    const g = chapterGeometry([
      { key: "c1", label: "Chapter 1", position: 1, activeSeconds: 300, words: 1000, wpm: 200 },
      { key: "c2", label: "Chapter 2", position: 2, activeSeconds: 300, words: 1050, wpm: 210 },
      { key: "c3", label: "Chapter 3", position: 3, activeSeconds: 600, words: 1000, wpm: 100 },
    ]);
    expect(g.usual).toBe(200);
    expect(g.points[2]!.dip).toBe(true);
    expect(g.points[0]!.dip).toBe(false);
  });

  it("renders accessible SVG charts without forbidden vocabulary", () => {
    const html = renderToStaticMarkup(
      <>
        <WeeklyRhythmChart
          weeks={[
            { weekStart: "2026-10-05", activeSeconds: 1800, words: 6000, sessions: 1, wpm: 200 },
            { weekStart: "2026-10-12", activeSeconds: 3600, words: 12000, sessions: 2, wpm: 200 },
          ]}
        />
        <ChapterPaceChart
          books={[
            {
              bookId: "b1",
              title: "The Grid",
              chapters: [
                { key: "1", label: "Ch 1", position: 1, activeSeconds: 300, words: 1000, wpm: 200 },
                { key: "2", label: "Ch 2", position: 2, activeSeconds: 600, words: 1000, wpm: 100 },
              ],
            },
          ]}
          suggestions={[]}
        />
        <ReadingBalanceChart
          kinds={[
            { kind: "N", activeSeconds: 3000, words: 10000, books: 2, wpm: 200 },
            { kind: "E", activeSeconds: 1000, words: 2500, books: 1, wpm: 150 },
          ]}
        />
      </>,
    );
    expect(html).toContain('data-testid="chart-weekly-rhythm"');
    expect(html).toContain('data-testid="chart-chapter-pace"');
    expect(html).toContain('data-testid="chart-reading-balance"');
    expect(html).not.toMatch(/pillar|narrative/i);
  });
});
