import { defineConfig } from "@playwright/test";
import { ADMIN_STATE, SETUP_CODE, TEST_MAX_RANGE } from "./e2e/pages";

// Without this, Playwright's offline mode (context.setOffline) does not reach
// service workers: a worker's own fetches still get through, so an "offline"
// test would pass while proving nothing (checked 2026-10-04 with Playwright
// 1.56.1). With it, they fail like a real network outage.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= "1";

const port = Number(process.env.PORT ?? 3100);
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const desktop = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const looks = { testMatch: /(visual|a11y)\.spec\.ts/, dependencies: ["setup"] };

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // One reference image per page and project, shared by every machine.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}-{projectName}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      // Small allowance for anti-aliasing differences between machines.
      maxDiffPixelRatio: 0.002,
    },
  },
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium", trace: "retain-on-failure" },
  projects: [
    // 1. Create the owner account and save its session.
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...desktop } },
    // 2. Screenshots + accessibility, before any test adds data to the pages.
    { name: "desktop-light", ...looks, use: { ...desktop, colorScheme: "light", storageState: ADMIN_STATE } },
    { name: "desktop-dark", ...looks, use: { ...desktop, colorScheme: "dark", storageState: ADMIN_STATE } },
    { name: "phone-light", ...looks, use: { ...phone, colorScheme: "light", storageState: ADMIN_STATE } },
    { name: "phone-dark", ...looks, use: { ...phone, colorScheme: "dark", storageState: ADMIN_STATE } },
    // 3. Behaviour: access rules, invitations, sign-in.
    {
      name: "flows",
      testMatch: /(flows|paths)\.spec\.ts/,
      dependencies: ["desktop-light", "desktop-dark", "phone-light", "phone-dark"],
      use: { ...desktop },
    },
    // 4. Uploads change the shelf and the path, so they run last.
    { name: "uploads", testMatch: /uploads\.spec\.ts/, dependencies: ["flows"], use: { ...desktop } },
    // 5. The reader opens a book uploaded in step 4.
    { name: "reader", testMatch: /reader\.spec\.ts/, dependencies: ["uploads"], use: { ...desktop } },
    // 6. Highlights, notes and bookmarks in a book the reader tests opened.
    { name: "annotations", testMatch: /annotations\.spec\.ts/, dependencies: ["reader"], use: { ...desktop } },
    // 7. AI tools (fake AI) in the same book.
    { name: "ai", testMatch: /ai\.spec\.ts/, dependencies: ["annotations"], use: { ...desktop } },
    // 8. Reading aloud (fake voice).
    { name: "audio", testMatch: /audio\.spec\.ts/, dependencies: ["ai"], use: { ...desktop } },
    // 9. Voice notes, stickers and handwriting. Chromium's fake microphone plays a test tone.
    {
      name: "notes",
      testMatch: /notes\.spec\.ts/,
      dependencies: ["audio"],
      use: {
        ...desktop,
        permissions: ["microphone"],
        launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
      },
    },
    // 10. Pictures (fake image search).
    { name: "images", testMatch: /images\.spec\.ts/, dependencies: ["notes"], use: { ...desktop } },
    // 11. Reading statistics (controlled clock).
    { name: "stats", testMatch: /stats\.spec\.ts/, dependencies: ["images"], use: { ...desktop } },
    // The reader in Safari's engine (WebKit), after the PDF upload in reader.spec.ts.
    { name: "safari", testMatch: /safari\.spec\.ts/, dependencies: ["reader"], use: { ...desktop, browserName: "webkit" } },
    // 12. Agents: API tokens (M11).
    { name: "agents", testMatch: /agents\.spec\.ts/, dependencies: ["stats"], use: { ...desktop } },
    // 13. Offline (M12): service worker, download for offline.
    { name: "offline", testMatch: /offline\.spec\.ts/, dependencies: ["agents"], use: { ...desktop } },
    // 14. Read-along audiobooks the reader uploads (M13), last: it changes a book's read-aloud audio.
    { name: "readalong", testMatch: /readalong\.spec\.ts/, dependencies: ["offline"], use: { ...desktop } },
    // 15. The same in Safari's engine (WebKit): Samuel reads in Safari, and folder picking differs by engine.
    { name: "readalong-safari", testMatch: /readalong\.spec\.ts/, dependencies: ["readalong"], use: { ...desktop, browserName: "webkit" } },
  ],
  webServer: {
    // A fresh in-process database (PGlite) for every run. Idle connections are
    // kept 120 s (the default is 5 s): a test's requests reuse connections, and
    // one sent just as the server closed it failed with "read ECONNRESET" on CI
    // (run 37267636340, after 6 s idle).
    command: `rm -rf .data/e2e && npm run build && npx next start -p ${port} --keepAliveTimeout 120000`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { PGLITE_DIR: ".data/e2e", FILES_DIR: ".data/e2e-files", SETUP_CODE, AI_FAKE: "1", FILES_MAX_RANGE_BYTES: String(TEST_MAX_RANGE) },
  },
});
