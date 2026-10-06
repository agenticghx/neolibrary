#!/usr/bin/env node
// Summarises read-along timing samples: the lines the page-break test writes
// (e2e/listen.ts, reportTiming), one JSON object per run of the test. They
// come from the timing-samples workflow (each job's timing/samples.jsonl, next
// to Playwright's own timing/results.json, which also counts runs that ended
// before writing a line, such as a stall) or from ordinary CI logs (lines
// containing "TIMING_JSON "). Prints a Markdown table, one row per commit and
// trace setting (--all: one row for everything, for CI logs); with exactly
// two rows, how likely their difference is to be chance. --browser=chromium
// summarises the Chromium runs (a control) instead of WebKit's.
// --columns=written counts late words by the readings where the change happens
// (expectEveryWordOnTime's `timing` option) instead of the frame readings.
//
//   node scripts/timing-summary.mjs [--all] [--browser=chromium] [--columns=written] <files or folders...>
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const webkit = option("browser", "safari") !== "chromium";
const ofBrowser = (project) => project.includes("safari") === webkit;
const [barCol, litCol] = option("columns", "frame") === "written" ? ["barWritten", "litPainted"] : ["barFrame", "litFrame"];
const files = (p) => (statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => files(join(p, f))) : [p]);
const all = args.filter((a) => !a.startsWith("--")).flatMap(files);
const linesOf = (f) =>
  readFileSync(f, "utf8")
    .split("\n")
    .map((l) => l.replace(/^.*?TIMING_JSON /, ""))
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l))
    .filter((r) => r.label === "pdf-page-break" && ofBrowser(r.project));

const samples = [];
/** Runs of the test per commit in Playwright's reports: each run counts, whether or not it wrote a line. */
const outcomes = new Map();
for (const fs of Map.groupBy(all, (f) => dirname(f)).values()) {
  const mine = fs.filter((f) => !f.endsWith("results.json")).flatMap(linesOf);
  samples.push(...mine);
  for (const f of fs.filter((f) => f.endsWith("results.json"))) {
    const report = JSON.parse(readFileSync(f, "utf8"));
    const sha = report.config?.metadata?.sha ?? mine[0]?.sha ?? "?";
    const walk = (suite) => {
      for (const spec of suite.specs ?? [])
        for (const t of spec.tests ?? [])
          if (t.projectName !== "setup" && ofBrowser(t.projectName) && /page break/.test(spec.title))
            for (const r of t.results ?? []) {
              const o = outcomes.get(sha) ?? { runs: 0, failed: 0 };
              o.runs += 1;
              o.failed += r.status === "passed" ? 0 : 1;
              outcomes.set(sha, o);
            }
      for (const s of suite.suites ?? []) walk(s);
    };
    for (const s of report.suites ?? []) walk(s);
  }
}

const q = (xs, p) => {
  const s = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : "–";
};
const dist = (xs) => `${q(xs, 0.5)} / ${q(xs, 0.9)} / ${q(xs, 1)}`;
// The later of the audio's time and the page's clock (what expectEveryWordOnTime's `timing` option checks).
const later = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));
// "Late": a word at 100 ms or more in a column the check reads (the test fails); "near miss": 80 or more.
const late = (r) => r.atLeast100[barCol] + r.atLeast100[litCol] > 0;
const near = (r) => r.atLeast80[barCol] + r.atLeast80[litCol] > 0;

const groups = Map.groupBy(samples, (r) => (args.includes("--all") ? "all" : `${(r.sha ?? "?").slice(0, 7)} · trace ${r.trace ?? "as CI"}`));
console.log(`### Read-along page break in ${webkit ? "WebKit" : "Chromium"}: timing samples (late words counted by ${barCol} and ${litCol})\n`);
console.log(
  "Milliseconds after the voice starts page 2's first word, as median / 90th percentile / maximum. The check today reads *bar (frame)* and *lit (frame)*; its limit is 100 ms. *written* and *painted* read the time where it happens (the recorder measures them; no check reads them).\n",
);
console.log(
  "| commit · trace | runs | test failed | late ≥100 | near miss ≥80 | bar (frame) | lit (frame) | bar (written) | lit (painted) | font load held the page | longest frame | turn asked → text ready | text ready → bar written | bar frame − written | lit frame − painted | after-paint samples late | machines |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const [key, rs] of groups) {
  // Each run's page-2 word: its lateness by each reading and its phases, in one object.
  const m = rs.map((r) => ({ ...(r.focus ?? {}), ...(r.focus?.phases ?? {}) }));
  const o = key === "all" ? undefined : outcomes.get(rs[0].sha ?? "?");
  const between = (a, b) => m.map((x) => (x[a] != null && x[b] != null ? x[b] - x[a] : null));
  console.log(
    `| ${key} | ${o ? o.runs : rs.length} | ${o ? o.failed : "?"} | ${rs.filter(late).length} | ${rs.filter(near).length} | ${dist(m.map((x) => x.barFrame))} | ${dist(m.map((x) => x.litFrame))} | ${dist(m.map((x) => later(x.barWritten, x.barWrittenClock)))} | ${dist(m.map((x) => later(x.litPainted, x.litPaintedClock)))} | ${dist(m.map((x) => x.fontHeldMs))} | ${dist(m.map((x) => x.longestFrameMs))} | ${dist(between("turnRequest", "textlayerReady"))} | ${dist(between("textlayerReady", "barWrittenClock"))} | ${dist(rs.map((r) => r.barFrameMinusWritten))} | ${dist(rs.map((r) => r.litFrameMinusPainted))} | ${dist(rs.map((r) => r.afterLate))} | ${new Set(rs.map((r) => r.machine)).size} |`,
  );
}

// Two-sided Fisher exact test on [[a, b], [c, d]]: the chance of a split at least this
// uneven if both commits behaved the same.
function fisher(a, b, c, d) {
  const lf = (n) => {
    let s = 0;
    for (let i = 2; i <= n; i++) s += Math.log(i);
    return s;
  };
  const n = a + b + c + d;
  const r1 = a + b;
  const c1 = a + c;
  const p = (x) => Math.exp(lf(r1) + lf(n - r1) + lf(c1) + lf(n - c1) - lf(n) - lf(x) - lf(r1 - x) - lf(c1 - x) - lf(n - r1 - c1 + x));
  const p0 = p(a);
  let sum = 0;
  for (let x = Math.max(0, c1 - (n - r1)); x <= Math.min(r1, c1); x++) if (p(x) <= p0 * (1 + 1e-9)) sum += p(x);
  return Math.min(1, sum);
}
const keys = [...groups.keys()];
if (keys.length === 2) {
  const [A, B] = keys.map((k) => groups.get(k));
  for (const [label, test] of [
    ["late ≥100", late],
    ["near miss ≥80", near],
  ]) {
    const a = A.filter(test).length;
    const b = B.filter(test).length;
    console.log(`\n${label}: ${a} of ${A.length} (${keys[0]}) vs ${b} of ${B.length} (${keys[1]}); Fisher exact p = ${fisher(a, A.length - a, b, B.length - b).toPrecision(2)}`);
  }
}
