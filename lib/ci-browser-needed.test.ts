import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BROWSER_SLICES,
  applyBrowserSlices,
  browserJobNeeded,
  browserSlices,
  gridPageNames,
  parseBrowserSlices,
  sliceForProject,
} from "../scripts/ci-browser-needed.mjs";

const ALL = [...BROWSER_SLICES];

describe("browserSlices", () => {
  it("runs nothing for docs, the ledger, and notes", () => {
    const docs = ["docs/security-leftovers.md", "PROGRESS.md", ".claude/skills/merge-train/SKILL.md", "LICENSE"];
    expect(browserSlices(docs)).toEqual([]);
    expect(browserJobNeeded(docs)).toBe(false);
    expect(browserSlices([".github/CODEOWNERS"])).toEqual([]);
  });

  it("runs every slice for an empty list, the workflow, the lockfile, and this script", () => {
    expect(browserSlices([])).toEqual(ALL);
    expect(browserJobNeeded([])).toBe(true);
    expect(browserSlices(["docs/ci-time.md", ".github/workflows/ci.yml"])).toEqual(ALL);
    expect(browserSlices(["package-lock.json"])).toEqual(ALL);
    expect(browserSlices(["playwright.config.ts"])).toEqual(ALL);
    expect(browserSlices(["scripts/ci-browser-needed.mjs"])).toEqual(ALL);
    expect(browserSlices(["scripts/ci-browser-needed.d.mts"])).toEqual(ALL);
    expect(browserSlices(["e2e/auth.setup.ts"])).toEqual(ALL);
    expect(browserJobNeeded(["docs/security-leftovers.md", "PROGRESS.md", ".github/workflows/ci.yml"])).toBe(true);
  });

  it("runs screenshots for a style, and screenshots plus behaviour for a page", () => {
    expect(browserSlices(["app/globals.css"])).toEqual(["screenshots"]);
    expect(browserSlices(["e2e/visual.spec.ts"])).toEqual(["screenshots"]);
    expect(browserSlices(["e2e/a11y.spec.ts"])).toEqual(["screenshots"]);
    expect(browserSlices(["e2e/pages.ts"])).toEqual(["screenshots"]);
    expect(browserSlices(["public/icon.png"])).toEqual(["screenshots"]);
    expect(browserSlices(["components/upload/useBookUpload.ts"])).toEqual(["screenshots", "behavior"]);
    expect(browserSlices(["app/(app)/library/page.tsx"])).toEqual(["screenshots", "behavior"]);
    expect(browserSlices(["proxy.ts"])).toEqual(["screenshots", "behavior"]);
  });

  it("runs the behaviour chain only for spending, sign-in, and other library code", () => {
    expect(browserSlices(["lib/health.ts"])).toEqual(["behavior"]);
    expect(browserSlices(["lib/auth/service.ts"])).toEqual(["behavior"]);
    expect(browserSlices(["app/api/health/route.ts"])).toEqual(["behavior"]);
    expect(browserSlices(["lib/ai/generate.ts", "docs/security-leftovers.md"])).toEqual(["behavior"]);
    expect(browserSlices(["data/paths/hidden-machinery.ts"])).toEqual(["behavior"]);
    expect(browserSlices(["lib/narrative.ts"])).toEqual(["behavior"]);
  });

  it("runs the audiobook file and WebKit when the player or the audiobook changes", () => {
    expect(browserSlices(["lib/readalong/player.ts"])).toEqual(["behavior", "readalong", "webkit"]);
    expect(browserSlices(["e2e/readalong.spec.ts"])).toEqual(["behavior", "readalong", "webkit"]);
    expect(browserSlices(["app/(app)/books/[id]/AudiobookUpload.tsx"])).toEqual([
      "screenshots",
      "behavior",
      "readalong",
      "webkit",
    ]);
    expect(browserSlices(["components/player/ListenSession.tsx"])).toEqual([
      "screenshots",
      "behavior",
      "readalong",
      "webkit",
    ]);
  });

  it("runs WebKit without the audiobook file when only Safari's highlight test changes", () => {
    expect(browserSlices(["e2e/safari.spec.ts"])).toEqual(["behavior", "webkit"]);
    expect(browserSlices(["e2e/listen.ts"])).toEqual(["behavior", "webkit"]);
  });

  it("runs narration for the whole-book path, and both tails for lib/library/audio.ts", () => {
    expect(browserSlices(["lib/library/narration.ts"])).toEqual(["behavior", "narration"]);
    expect(browserSlices(["e2e/narration.spec.ts"])).toEqual(["behavior", "narration"]);
    expect(browserSlices(["app/(app)/import/page.tsx"])).toEqual(["screenshots", "behavior", "narration"]);
    expect(browserSlices(["app/api/books/[id]/narration/route.ts"])).toEqual(["behavior", "narration"]);
    expect(browserSlices(["lib/library/audio.ts"])).toEqual(["behavior", "readalong", "narration", "webkit"]);
  });
});

describe("parseBrowserSlices", () => {
  it("treats unset and unknown as every project, and none as no project", () => {
    expect(parseBrowserSlices(undefined)).toBeNull();
    expect(parseBrowserSlices("")).toBeNull();
    expect(parseBrowserSlices("screenshots,typo")).toBeNull();
    expect(parseBrowserSlices("none")).toEqual([]);
    expect(parseBrowserSlices("webkit, screenshots")).toEqual(["screenshots", "webkit"]);
  });
});

function fixture() {
  const deps: Record<string, string[] | undefined> = {
    setup: undefined,
    "desktop-light": ["setup"],
    "desktop-dark": ["setup"],
    "phone-light": ["setup"],
    "phone-dark": ["setup"],
    flows: ["desktop-light", "desktop-dark", "phone-light", "phone-dark"],
    uploads: ["flows"],
    shell: ["uploads"],
    reader: ["shell"],
    annotations: ["reader"],
    ai: ["annotations"],
    audio: ["ai"],
    notes: ["audio"],
    images: ["notes"],
    stats: ["images"],
    safari: ["reader"],
    home: ["stats"],
    "own-paths": ["home"],
    agents: ["own-paths"],
    offline: ["agents"],
    readalong: ["offline"],
    "readalong-safari": ["readalong"],
    narration: ["readalong-safari"],
  };
  const webkit = new Set(["safari", "readalong-safari"]);
  return Object.entries(deps).map(([name, dependencies]) => ({ name, dependencies, ...(webkit.has(name) ? { use: { browserName: "webkit" } } : {}) }));
}

function namesOf(projects: { name: string }[]) {
  return projects.map((project) => project.name);
}

function depsOf(projects: { name: string; dependencies?: string[] }[], name: string) {
  return projects.find((project) => project.name === name)?.dependencies;
}

describe("applyBrowserSlices", () => {
  it("returns the same projects when the slice list is unset or complete", () => {
    const projects = fixture();
    expect(applyBrowserSlices(projects, null)).toBe(projects);
    expect(applyBrowserSlices(projects, ALL)).toBe(projects);
  });

  it("drops the tail for a behaviour-only change and points flows at setup", () => {
    const projects = applyBrowserSlices([...fixture(), { name: "extra", dependencies: ["narration"] }], ["behavior"]);
    expect(namesOf(projects)).toEqual([
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
      "extra",
    ]);
    expect(depsOf(projects, "flows")).toEqual(["setup"]);
    expect(depsOf(projects, "offline")).toEqual(["agents"]);
    expect(depsOf(projects, "extra")).toEqual(["setup"]);
    expect(namesOf(projects)).not.toContain("readalong");
    expect(namesOf(projects)).not.toContain("readalong-safari");
    expect(namesOf(projects)).not.toContain("safari");
    expect(namesOf(projects)).not.toContain("narration");
  });

  it("keeps the screenshot projects in front of the behaviour chain", () => {
    const projects = applyBrowserSlices(fixture(), ["screenshots", "behavior"]);
    expect(depsOf(projects, "flows")).toEqual(["desktop-light", "desktop-dark", "phone-light", "phone-dark"]);
    expect(namesOf(projects)).not.toContain("narration");
  });

  it("runs screenshots alone as setup plus the four looks", () => {
    const projects = applyBrowserSlices(fixture(), ["screenshots"]);
    expect(namesOf(projects)).toEqual(["setup", "desktop-light", "desktop-dark", "phone-light", "phone-dark"]);
    expect(depsOf(projects, "phone-dark")).toEqual(["setup"]);
  });

  it("runs WebKit's highlight test without the audiobook file", () => {
    const projects = applyBrowserSlices(fixture(), ["webkit"]);
    expect(namesOf(projects)).toContain("safari");
    expect(namesOf(projects)).toContain("reader");
    expect(namesOf(projects)).not.toContain("readalong");
    expect(namesOf(projects)).not.toContain("readalong-safari");
    expect(depsOf(projects, "safari")).toEqual(["reader"]);
  });

  it("points narration at offline when the audiobook projects are off", () => {
    const projects = applyBrowserSlices(fixture(), ["narration"]);
    expect(namesOf(projects)).toContain("narration");
    expect(namesOf(projects)).not.toContain("readalong-safari");
    expect(namesOf(projects)).not.toContain("safari");
    expect(depsOf(projects, "narration")).toEqual(["offline"]);
  });

  it("keeps both audiobook projects, and Safari's highlight test, when read-along is on", () => {
    const projects = applyBrowserSlices(fixture(), ["readalong"]);
    expect(namesOf(projects)).toContain("readalong");
    expect(namesOf(projects)).toContain("readalong-safari");
    expect(namesOf(projects)).toContain("safari");
    expect(namesOf(projects)).not.toContain("narration");
    expect(depsOf(projects, "readalong-safari")).toEqual(["readalong"]);
    expect(depsOf(projects, "safari")).toEqual(["reader"]);
  });

  it("runs no project when the slice list is none", () => {
    expect(applyBrowserSlices(fixture(), [])).toEqual([]);
  });

  // Samuel (2026-10-09): pull requests skip Safari's engine; main and the night run keep it.
  it("skipWebkit drops every WebKit project, and narration waits on the Chromium audiobook pass", () => {
    for (const slices of [null, ALL]) {
      const projects = applyBrowserSlices(fixture(), slices, { skipWebkit: true });
      expect(namesOf(projects)).not.toContain("safari");
      expect(namesOf(projects)).not.toContain("readalong-safari");
      expect(namesOf(projects)).toContain("readalong");
      expect(depsOf(projects, "narration")).toEqual(["readalong"]);
      expect(projects).toHaveLength(fixture().length - 2);
    }
  });

  it("skipWebkit with read-along on keeps the Chromium audiobook pass only", () => {
    const projects = applyBrowserSlices(fixture(), ["readalong"], { skipWebkit: true });
    expect(namesOf(projects)).toContain("readalong");
    expect(namesOf(projects)).not.toContain("readalong-safari");
    expect(namesOf(projects)).not.toContain("safari");
    expect(depsOf(projects, "readalong")).toEqual(["offline"]);
  });

  it("without skipWebkit, the WebKit projects stay (main and the night run)", () => {
    expect(applyBrowserSlices(fixture(), null, { skipWebkit: false })).toEqual(fixture());
    expect(namesOf(applyBrowserSlices(fixture(), ["readalong"], {}))).toContain("readalong-safari");
  });
});

describe("gridPageNames", () => {
  const pages = readFileSync("e2e/pages.ts", "utf8");

  it("requires a spec's screenshots only when that spec's project runs", () => {
    const shots = gridPageNames(pages, ["screenshots"]);
    expect(shots).toContain("sign-in");
    expect(shots).not.toContain("path-own");
    expect(shots).not.toContain("miniplayer");
    const withBehavior = gridPageNames(pages, ["screenshots", "behavior"]);
    expect(withBehavior).toContain("path-own");
    expect(withBehavior).toContain("path-edit");
    expect(withBehavior).not.toContain("miniplayer");
    expect(gridPageNames(pages, ALL)).toContain("miniplayer");
    expect(gridPageNames(pages, ["behavior"])).toEqual([]);
  });
});

describe("playwright.config.ts", () => {
  it("classifies every project the config names", () => {
    const text = readFileSync("playwright.config.ts", "utf8");
    const names = [...text.matchAll(/name: "([^"]+)"/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) expect(sliceForProject(name)).not.toBeNull();
  });

  it("keeps today's dependency chain when CI_BROWSER_SLICES is unset", async () => {
    delete process.env.CI_BROWSER_SLICES;
    const { default: config } = await import("../playwright.config");
    const narration = config.projects?.find((project) => project.name === "narration");
    const flows = config.projects?.find((project) => project.name === "flows");
    expect(narration?.dependencies).toEqual(["readalong-safari"]);
    expect(flows?.dependencies).toEqual(["desktop-light", "desktop-dark", "phone-light", "phone-dark"]);
    expect(config.projects?.map((project) => project.name)).toContain("safari");
  });
});
