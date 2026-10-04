import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hiddenMachinery } from "./hidden-machinery";

const md = readFileSync(new URL("../../docs/reading-lists/hidden-machinery.md", import.meta.url), "utf8");
const section = (start: string, end: string) => md.slice(md.indexOf(start), md.indexOf(end, md.indexOf(start)));
const titlesIn = (text: string) => [...text.matchAll(/\*([^*|]+?)\* — /g)].map((m) => m[1].trim());

const all = hiddenMachinery.pillars.flatMap((p) => p.books.map((b) => ({ ...b, pillar: p })));
const byTitle = (t: string) => all.find((b) => b.title === t);

describe("Hidden Machinery seed matches docs/reading-lists/hidden-machinery.md", () => {
  it("has Deedy's 18 pillars, each with its N and E book", () => {
    const table = section("## Main list — Deedy", "**Master key");
    const titles = titlesIn(table);
    expect(titles).toHaveLength(36);
    for (const t of titles) expect(byTitle(t), t).toBeDefined();
    expect(hiddenMachinery.pillars.filter((p) => p.group === "main")).toHaveLength(18);
  });

  it("has the finance pillars and the nine blindspot pairs", () => {
    const finance = titlesIn(section("| Banking & credit |", "### Adjacent finance books"));
    const blind = [...section("## Blindspots — books", "### Weaker holes").matchAll(/\| \*\*[NE]\*\* \| \*([^*]+)\* — /g)].map(
      (m) => m[1],
    );
    expect(finance).toHaveLength(4);
    expect(blind).toHaveLength(18);
    for (const t of [...finance, ...blind]) expect(byTitle(t), t).toBeDefined();
  });

  it("puts N before E in every pillar, and the master key last", () => {
    for (const p of hiddenMachinery.pillars) {
      const kinds = p.books.map((b) => b.kind);
      const n = kinds.indexOf("N");
      const e = kinds.indexOf("E");
      if (n >= 0 && e >= 0) expect(n, p.slug).toBeLessThan(e);
      const firstExtra = kinds.indexOf("extra");
      if (firstExtra >= 0) expect(kinds.slice(firstExtra).every((k) => k === "extra"), p.slug).toBe(true);
    }
    const last = hiddenMachinery.pillars.at(-1)!;
    expect(last.group).toBe("master");
    expect(last.books[0]).toMatchObject({ kind: "master", title: "Seeing Like a State" });
  });

  it("labels every agent suggestion as not catalog-checked", () => {
    const agentPart = md.slice(md.indexOf("## 2026-09-29 agent"));
    const suggestedTitles = titlesIn(agentPart);
    expect(suggestedTitles.length).toBeGreaterThan(10);
    for (const t of suggestedTitles) {
      const b = byTitle(t);
      if (b) expect(b.unverified, t).toBe(true);
    }
    // And nothing from Deedy's or the curated sections is labelled unverified.
    for (const b of all.filter((x) => x.pillar.group !== "suggested")) expect(b.unverified, b.title).toBeFalsy();
  });

  it("has unique pillar slugs", () => {
    const slugs = hiddenMachinery.pillars.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
