import { defineConfig } from "@playwright/test";
import { ADMIN_STATE, SETUP_CODE } from "./e2e/pages";

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
  ],
  webServer: {
    // A fresh in-process database (PGlite) for every run.
    command: `rm -rf .data/e2e && npm run build && npx next start -p ${port}`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { PGLITE_DIR: ".data/e2e", FILES_DIR: ".data/e2e-files", SETUP_CODE },
  },
});
