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
  } else {
    const path = process.argv[2];
    const text = path ? fs.readFileSync(path, "utf8") : "";
    const slices = browserSlices(text.split("\n"));
    console.log(slices.length ? `slices=${slices.join(",")}` : "slices=none");
  }
}
