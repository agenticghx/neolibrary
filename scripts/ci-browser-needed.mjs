/**
 * Which browser tests a change has to run.
 *
 * The browser job is one chain that shares one database. The long part is
 * the audiobook file (Chromium, then WebKit) and whole-book narration.
 * A change that does not touch that code skips that part. The tests stay.
 * They run when their code changes, and every night on main.
 *
 * An empty file list runs every slice. A missing list must not skip tests.
 * Docs, the ledger, and Markdown run none. The workflow, the lockfile,
 * Playwright's config, and this script run every slice: the selector must
 * not skip its own check.
 *
 * Used by .github/workflows/ci.yml. The rules are written out in docs/ci-time.md.
 *
 * No top-level await. Playwright loads this file with require(), and Node
 * refuses require() on a module that awaits at the top level.
 */

import fs from "node:fs";

/** Stable order. Printed this way, and stored in CI_BROWSER_SLICES this way. */
export const BROWSER_SLICES = ["screenshots", "behavior", "readalong", "narration", "webkit"];

const VISUAL = ["desktop-light", "desktop-dark", "phone-light", "phone-dark"];

/**
 * Dependency order. Safari's highlight project hangs off `reader` and is not
 * in this line, so narration never waits on it.
 */
const CHAIN = [
  "setup",
  "flows",
  "uploads",
  "shell",
  "reader",
  "annotations",
  "ai",
  "audio",
  "notes",
  "images",
  "stats",
  "home",
  "own-paths",
  "agents",
  "offline",
  "readalong",
  "readalong-safari",
  "narration",
];

/** Playwright project name → slice. `setup` is separate. An unknown name is kept. */
const PROJECT_SLICE = {
  "desktop-light": "screenshots",
  "desktop-dark": "screenshots",
  "phone-light": "screenshots",
  "phone-dark": "screenshots",
  flows: "behavior",
  uploads: "behavior",
  shell: "behavior",
  reader: "behavior",
  annotations: "behavior",
  ai: "behavior",
  audio: "behavior",
  notes: "behavior",
  images: "behavior",
  stats: "behavior",
  home: "behavior",
  "own-paths": "behavior",
  agents: "behavior",
  offline: "behavior",
  safari: "webkit",
  readalong: "readalong",
  "readalong-safari": "readalong",
  narration: "narration",
  // M21: hangs off `stats` like `safari` off `reader`, so it is not in CHAIN (in CHAIN, `home` would wait on it).
  review: "behavior",
  // M22: a branch off `stats` too.
  covers: "behavior",
  // M26 R3: the focus session with a question; a branch off `stats` too.
  focus: "behavior",
  // M42 S1: the E-ink reading setting, as a reader of its own; a branch off `stats` too.
  eink: "behavior",
  // M34: the open shelf, as the owner and as a visitor; a branch off `stats` too.
  "open-shelf": "behavior",
  // M34 S4: bring your own key; a branch off `stats` too.
  "own-keys": "behavior",
  // M41 R3c: shared papers, as the owner and as an invited reader; a branch off `stats` too.
  "shared-papers": "behavior",
};

const NARRATION_FILES = new Set([
  "lib/library/narration.ts",
  "e2e/narration.spec.ts",
  "app/(app)/import/WholeBookNarration.tsx",
  "app/(app)/import/page.tsx",
]);

function clean(files) {
  return files.map((f) => String(f).trim()).filter(Boolean);
}

function isDocsOrNotes(f) {
  return (
    f.startsWith("docs/") ||
    f.startsWith(".claude/") ||
    f.endsWith(".md") ||
    f === "LICENSE" ||
    f.startsWith("LICENSE.") ||
    (f.startsWith(".github/") && !f.startsWith(".github/workflows/"))
  );
}

function forcesAll(f) {
  return (
    f.startsWith(".github/workflows/") ||
    f.startsWith("scripts/ci-browser-needed") ||
    f.startsWith("next.config.") ||
    f.startsWith("tsconfig.") ||
    f === "playwright.config.ts" ||
    f === "playwright.timing.config.ts" ||
    f === "package.json" ||
    f === "package-lock.json" ||
    f === "e2e/auth.setup.ts"
  );
}

function isReadalong(f) {
  return (
    f.startsWith("lib/readalong/") ||
    f.startsWith("lib/player/") ||
    f.startsWith("components/player/") ||
    f === "lib/library/audio.ts" ||
    f.endsWith("/AudiobookUpload.tsx") ||
    // A PDF page's own document: its text layer and the read-aloud highlight live there, and the dimming of M19 P2
    // changed both. Its tests are the read-along ones (a change here once skipped them and broke one, #146).
    f === "lib/reader/pdf-book.ts" ||
    /(^|\/)readalong(\/|\.)/.test(f)
  );
}

function isNarration(f) {
  // The path segment `narration`, not the word "narrative" (a Path's book kind).
  return NARRATION_FILES.has(f) || f.includes("/narration/") || f === "lib/library/audio.ts";
}

function isWebkit(f) {
  return (
    f === "e2e/safari.spec.ts" ||
    f === "e2e/listen.ts" ||
    f.startsWith("lib/player/") ||
    f.startsWith("components/player/") ||
    f === "lib/library/audio.ts" ||
    isReadalong(f)
  );
}

function isAppView(f) {
  return f.startsWith("app/") && !f.startsWith("app/api/") && (f.endsWith(".tsx") || f.endsWith(".jsx"));
}

function isUi(f) {
  return f.startsWith("components/") || isAppView(f) || f === "proxy.ts";
}

function isShots(f) {
  return (
    f.endsWith(".css") ||
    f.startsWith("postcss.config.") ||
    /(^|\/)(visual|a11y)\.spec\.ts$/.test(f) ||
    f === "e2e/pages.ts" ||
    f.startsWith("public/") ||
    f.startsWith("e2e/__screenshots__/") ||
    isUi(f)
  );
}

function collect(f) {
  const slices = new Set();
  if (isShots(f)) slices.add("screenshots");
  if (isUi(f)) slices.add("behavior");
  if (isReadalong(f)) slices.add("readalong");
  if (isNarration(f)) slices.add("narration");
  if (isWebkit(f)) slices.add("webkit");
  if (slices.size === 0) slices.add("behavior");
  return slices;
}

function expand(slices) {
  const on = new Set(slices);
  if (on.has("readalong")) on.add("webkit");
  if (on.has("readalong") || on.has("narration") || on.has("webkit")) on.add("behavior");
  return on;
}

function inOrder(on) {
  return BROWSER_SLICES.filter((slice) => on.has(slice));
}

/** @returns {string[]} slice names in BROWSER_SLICES order. Empty means run nothing. */
export function browserSlices(files) {
  const names = clean(files);
  if (!names.length) return BROWSER_SLICES.slice();
  if (names.some(forcesAll)) return BROWSER_SLICES.slice();
  if (names.every(isDocsOrNotes)) return [];
  const on = new Set();
  for (const file of names) {
    if (isDocsOrNotes(file)) continue;
    for (const slice of collect(file)) on.add(slice);
  }
  return inOrder(expand(on));
}

export function browserJobNeeded(files) {
  return browserSlices(files).length > 0;
}

/**
 * `CI_BROWSER_SLICES` unset or blank: null, meaning every project, unchanged.
 * `none`: run no project. A token this file does not know: null (fail open).
 * @param {string | undefined | null} value
 * @returns {string[] | null}
 */
export function parseBrowserSlices(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw === "none") return [];
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  if (parts.some((part) => !BROWSER_SLICES.includes(part))) return null;
  return inOrder(new Set(parts));
}

/** @param {string} name @returns {"setup" | string | null} */
export function sliceForProject(name) {
  if (name === "setup") return "setup";
  return Object.prototype.hasOwnProperty.call(PROJECT_SLICE, name) ? PROJECT_SLICE[name] : null;
}

function sameDeps(current, next) {
  const left = current ?? [];
  const right = next ?? [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

function nearestBefore(name, names) {
  const index = CHAIN.indexOf(name);
  for (let i = index - 1; i >= 0; i--) if (names.has(CHAIN[i])) return CHAIN[i];
  return null;
}

function nearestAtOrBefore(name, names) {
  const index = CHAIN.indexOf(name);
  for (let i = index; i >= 0; i--) if (names.has(CHAIN[i])) return CHAIN[i];
  return null;
}

function dependenciesFor(project, names) {
  const name = project.name ?? "";
  if (name === "setup") return project.dependencies ?? [];
  if (VISUAL.includes(name)) return names.has("setup") ? ["setup"] : [];
  if (name === "flows") {
    const visuals = VISUAL.filter((visual) => names.has(visual));
    if (visuals.length) return visuals;
    return names.has("setup") ? ["setup"] : [];
  }
  if (name === "safari") {
    const anchor = nearestAtOrBefore("reader", names);
    return anchor ? [anchor] : [];
  }
  if (CHAIN.includes(name)) {
    const anchor = nearestBefore(name, names);
    return anchor ? [anchor] : [];
  }
  const left = (project.dependencies ?? []).filter((dep) => names.has(dep));
  if (left.length) return left;
  return names.has("setup") ? ["setup"] : [];
}

/**
 * `slices === null`: every project (local runs, and the timing config).
 * Otherwise drop projects whose slice is off. `setup` stays when any slice is on.
 * An unknown project name stays. `skipWebkit` (pull requests, Samuel 2026-10-09:
 * Safari's engine is the slow part) also drops every project that runs in
 * WebKit; they run after the merge, on `main`, and in the night run.
 * Each remaining project then depends on the nearest project that still runs,
 * so Playwright is not pointed at a dropped name.
 * @param {readonly {name: string, dependencies?: string[], use?: {browserName?: string}}[]} projects
 * @param {readonly string[] | null} slices
 * @param {{skipWebkit?: boolean}} [opts]
 */
export function applyBrowserSlices(projects, slices, opts = {}) {
  if (slices == null && !opts.skipWebkit) return projects;
  const on = slices == null ? null : expand(slices);
  if (on && on.size === 0) return [];
  const kept = [];
  for (const project of projects) {
    if (opts.skipWebkit && project.use?.browserName === "webkit") continue;
    const slice = sliceForProject(project.name);
    if (on == null || slice === "setup" || slice == null || on.has(slice)) kept.push(project);
  }
  const names = new Set(kept.map((project) => project.name));
  let changed = kept.length !== projects.length;
  const next = kept.map((project) => {
    const deps = dependenciesFor(project, names);
    if (sameDeps(project.dependencies, deps)) return project;
    changed = true;
    if (!deps.length) {
      const copy = { ...project };
      delete copy.dependencies;
      return copy;
    }
    return { ...project, dependencies: deps };
  });
  if (!changed && next.every((project, index) => project === projects[index])) return projects;
  return next;
}

/**
 * Groups of projects that CI runs at the same time, each on its own machine with its own
 * fresh database (2026-11-05, when CI moved to GitHub's free machines). A project in no
 * group would never run in CI, so every project the config names is in exactly one group's
 * `targets` (a unit test checks this). `support` projects run in a group only to make the
 * data its targets use (the owner account, Grace, the uploaded books); a group whose
 * targets are all off for this change does not run at all.
 *
 * - behavior: the long chain from flows to images, then home. Chromium only. Each of these needs
 *   what the ones before it made (tried on 2026-11-11, one cut at a time): audio and images use
 *   the links between books that the AI tests make, notes use audio the audio tests saved, and
 *   home's Continue card shows what the chain read last.
 * - behavior-2: the screenshots (before any test adds data), then, after flows, uploads and
 *   reader have made the account, the books and the opened PDF: stats, own-paths, agents,
 *   offline, and open-shelf off stats. Split from behavior on 2026-11-11 so that no machine
 *   runs more than about eight minutes of tests (one machine took 12.7). Open-shelf once
 *   needed the whole chain (alone after uploads, a visitor's new rewrite was not refused,
 *   2026-11-05); tried again on 2026-11-11 it passes alone after flows and uploads, and here.
 * - branches: the projects that hang off stats but make readers and books of their own;
 *   here they wait on uploads only.
 * - readalong: the audiobook file in Chromium, then whole-book narration. It needs the PDF
 *   "Discourse on the Method", which reader.spec.ts uploads, so reader runs here too.
 * - webkit: everything in Safari's engine, on one machine (main and the night run only):
 *   Safari's highlight test and the audiobook file, after reader. (Tried on 2026-11-05 as a
 *   fix for the design screenshot's 2 px wobble on main; it was not the cause, see
 *   docs/ci-flakes.md. The split stays: the behavior machine is Chromium only.)
 */
export const BROWSER_GROUPS = {
  behavior: {
    support: [],
    targets: ["flows", "uploads", "shell", "reader", "annotations", "ai", "audio", "notes", "images", "home"],
  },
  "behavior-2": {
    support: ["flows", "uploads", "reader"],
    targets: [...VISUAL, "stats", "own-paths", "agents", "offline", "open-shelf"],
  },
  branches: {
    support: ["flows", "uploads"],
    targets: ["review", "covers", "own-keys", "eink", "focus", "shared-papers"],
  },
  readalong: {
    support: ["flows", "uploads", "reader"],
    targets: ["readalong", "narration"],
  },
  webkit: {
    support: ["flows", "uploads", "reader"],
    targets: ["safari", "readalong-safari"],
  },
};

/** Projects that run in Safari's engine (WebKit). playwright.config.ts sets browserName "webkit" on these. */
export const WEBKIT_PROJECTS = ["safari", "readalong-safari"];

/**
 * Keeps one group's projects (after `applyBrowserSlices`), plus `setup`, and points each at
 * the nearest project it still has. A project whose own dependencies all left the group
 * waits on the nearest chain project at or before them (a branch off stats waits on uploads).
 * Returns [] when none of the group's targets is left: that machine has nothing to run.
 * An unknown group name returns the projects unchanged (fail open: run everything).
 * @template {{name: string, dependencies?: string[]}} T
 * @param {readonly T[]} projects
 * @param {string | undefined | null} group
 * @returns {T[]}
 */
export function applyBrowserGroup(projects, group) {
  const raw = group == null ? "" : String(group).trim();
  if (!raw || !Object.prototype.hasOwnProperty.call(BROWSER_GROUPS, raw)) return projects.slice();
  const { support, targets } = BROWSER_GROUPS[raw];
  if (!projects.some((project) => targets.includes(project.name))) return [];
  const kept = projects.filter((project) => project.name === "setup" || support.includes(project.name) || targets.includes(project.name));
  const names = new Set(kept.map((project) => project.name));
  return kept.map((project) => {
    let deps = dependenciesFor(project, names);
    if (!CHAIN.includes(project.name) && !VISUAL.includes(project.name) && project.name !== "safari") {
      const own = project.dependencies ?? [];
      if (own.length && !own.some((dep) => names.has(dep))) {
        const anchors = own.map((dep) => (CHAIN.includes(dep) ? nearestAtOrBefore(dep, names) : null)).filter(Boolean);
        if (anchors.length) deps = [...new Set(anchors)];
      }
    }
    if (sameDeps(project.dependencies, deps)) return project;
    if (!deps.length) {
      const copy = { ...project };
      delete copy.dependencies;
      return copy;
    }
    return { ...project, dependencies: deps };
  });
}

/**
 * The groups CI starts for this slice list: one machine each. A group runs when at least
 * one of its targets is on (and, with skipWebkit, is not a WebKit project).
 * @param {readonly string[]} slices from browserSlices or parseBrowserSlices
 * @param {{skipWebkit?: boolean}} [opts]
 * @returns {{group: string, webkit: boolean}[]}
 */
export function browserGroupsToRun(slices, opts = {}) {
  const on = expand(slices);
  const runs = (name) =>
    (on.has(sliceForProject(name)) || sliceForProject(name) == null) && !(opts.skipWebkit && WEBKIT_PROJECTS.includes(name));
  const out = [];
  for (const [group, { targets }] of Object.entries(BROWSER_GROUPS)) {
    const live = targets.filter(runs);
    if (live.length) out.push({ group, webkit: live.some((name) => WEBKIT_PROJECTS.includes(name)) });
  }
  return out;
}

/**
 * Page names the screenshot grid must find for this slice list.
 * Pages with no `spec` are photographed by the screenshot projects.
 * `own-paths.spec.ts` runs with the behaviour slice. `readalong.spec.ts`
 * (the mini-player) runs with the audiobook slice. Requiring those images
 * when that project did not run would fail a shorter job.
 * @param {string} pageSource text of e2e/pages.ts
 * @param {readonly string[] | string} slices
 */
export function gridPageNames(pageSource, slices) {
  const on = new Set(Array.isArray(slices) ? slices : String(slices).split(",").map((part) => part.trim()).filter(Boolean));
  if (!on.has("screenshots")) return [];
  const specSlice = {
    "own-paths.spec.ts": "behavior",
    "readalong.spec.ts": "readalong",
    "review.spec.ts": "behavior",
    "covers.spec.ts": "behavior",
  };
  const names = [];
  for (const line of String(pageSource).split("\n")) {
    const name = line.match(/\{\s*name: "([a-z0-9-]+)"/);
    if (!name) continue;
    const spec = line.match(/spec: "([^"]+)"/);
    if (!spec) {
      names.push(name[1]);
      continue;
    }
    const slice = specSlice[spec[1]];
    if (slice == null || on.has(slice)) names.push(name[1]);
  }
  return names;
}

const isMain = process.argv[1] && process.argv[1].endsWith("ci-browser-needed.mjs");
if (isMain) {
  if (process.argv[2] === "--grid") {
    const text = fs.readFileSync(process.argv[3], "utf8");
    for (const name of gridPageNames(text, process.argv[4] ?? "")) console.log(name);
  } else if (process.argv[2] === "--groups") {
    // ci.yml: `--groups <slices> <1 to skip WebKit>` prints the machines to start, as JSON for a matrix.
    const slices = parseBrowserSlices(process.argv[3]) ?? BROWSER_SLICES.slice();
    console.log(JSON.stringify(browserGroupsToRun(slices, { skipWebkit: process.argv[4] === "1" })));
  } else {
    const path = process.argv[2];
    const text = path ? fs.readFileSync(path, "utf8") : "";
    const slices = browserSlices(text.split("\n"));
    console.log(slices.length ? `slices=${slices.join(",")}` : "slices=none");
  }
}
