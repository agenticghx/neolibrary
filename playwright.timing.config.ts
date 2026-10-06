import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * For the timing-samples workflow (.github/workflows/timing-samples.yml):
 * the owner's account (the "setup" project), then only the PDF page-break
 * read-along test in WebKit, as many times as --repeat-each says. Playwright
 * repeats only the top-level project, not its dependencies
 * (node_modules/playwright/lib/runner/loadUtils.js: the CLI repeatEach is
 * applied where type === "top-level"), so the account is made once. The same
 * server, window size, WebKit and trace setting as the full suite; one
 * worker, as GitHub's 2-CPU machines give the full suite. NL_TRACE=off turns
 * the trace off, to measure what recording it costs.
 */
const project = (name: string) => base.projects!.find((p) => p.name === name)!;

export default defineConfig({
  ...base,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: "timing/results.json" }]],
  metadata: { sha: process.env.NL_SHA ?? null, machine: process.env.NL_MACHINE ?? null, trace: process.env.NL_TRACE ?? null },
  use: { ...base.use, trace: process.env.NL_TRACE === "off" ? "off" : "retain-on-failure" },
  projects: [project("setup"), { ...project("readalong-safari"), name: "timing-safari", dependencies: ["setup"], grep: new RegExp(process.env.NL_TESTS || "on across a page break") }],
});
