import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M34 S4, bring your own key (docs/plan.md): the owner's keys pay only for the owner. An invited reader asks for a
// new AI answer with the Anthropic key kept in their own browser, or is told to add one; the key is never echoed.
test.use({ storageState: ADMIN_STATE });

const KEY = "sk-ant-e2e-own-key-7319";

async function newReader(page: Page, browser: Browser) {
  await page.goto("/admin/invites");
  await page.getByLabel(/Who is it for/).fill("Kofi, own keys");
  await page.getByRole("button", { name: "Make an invitation link" }).click();
  const link = await page.getByTestId("invite-link").inputValue();
  // Its own address (the app reads x-forwarded-for): joining counts against the sign-in limit of 10 per address in
  // 15 minutes (app/(public)/actions.ts), which the other projects' readers, joining from the test machine, already
  // come close to. CI run 41476467866: with this reader on the shared address, focus.spec's join got "Too many attempts".
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { "x-forwarded-for": "198.51.100.34" },
  });
  const reader = await ctx.newPage();
  await reader.goto(link);
  await reader.getByLabel("Your name").fill("Kofi Keys");
  await reader.getByLabel("Email address").fill(`keys-${Date.now()}@example.com`);
  await reader.getByLabel("Password").fill("a key of my own please");
  await reader.getByRole("button", { name: "Join the library" }).click();
  await expect(reader.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  return reader;
}

test("M34 S4: a reader's new AI answer needs their own key, kept in their browser; the owner needs none", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const reader = await newReader(page, browser);
  const upload = await reader.request.post("/api/books", {
    multipart: { files: { name: "shelley-frankenstein.epub", mimeType: "application/epub+zip", buffer: readFileSync("fixtures/books/shelley-frankenstein.epub") } },
  });
  const bookId = (await upload.json()).results[0].bookId as string;
  await reader.goto(`/books/${bookId}/read`);
  const view = reader.getByTestId("reader");
  await expect(view).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  for (let i = 0; i < 4; i++) await reader.getByRole("button", { name: "Next page" }).click();
  await expect.poll(() => view.getAttribute("data-cfi")).toMatch(/^epubcfi\(/);
  const cfi = (await view.getAttribute("data-cfi"))!;

  // Without a key: the paragraph and saved answers are there, but no estimate, and a new answer is refused with how to add one.
  const info = await (await reader.request.get(`/api/books/${bookId}/rewrites?${new URLSearchParams({ cfi })}`)).json();
  expect(info.estimates).toBeNull();
  const refused = await reader.request.post(`/api/books/${bookId}/rewrites`, { data: { sectionId: info.paragraph.id, level: "plain" } });
  expect(refused.status()).toBe(503);
  expect((await refused.json()).error).toContain("Add your own Anthropic key");

  // The reader adds a key in Reading settings: kept in this browser, shown by its last four characters only.
  await reader.getByRole("button", { name: "Reading settings" }).click();
  const keys = reader.getByTestId("own-keys");
  await keys.getByLabel(/Anthropic key/).fill(KEY);
  await keys.getByRole("button", { name: "Save" }).first().click();
  await expect(keys).toContainText("Anthropic key …7319 · kept in this browser");
  expect(await reader.evaluate(() => localStorage.getItem("neolibrary:own-key:anthropic"))).toBe(KEY);

  // With a key in the request, a new answer is made on it, and the answer never repeats the key.
  const made = await reader.request.post(`/api/books/${bookId}/rewrites`, {
    data: { sectionId: info.paragraph.id, level: "plain" },
    headers: { "x-neolibrary-anthropic-key": KEY },
  });
  expect(made.status()).toBe(201);
  const madeText = await made.text();
  expect(madeText).toContain("anthropic-own-key");
  expect(madeText).not.toContain(KEY);

  // The reader's own panels send the key from the browser: Study (Need to know) asks with it, and only AI
  // requests carry it.
  const sent: string[] = [];
  const other: string[] = [];
  reader.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (r.headers()["x-neolibrary-anthropic-key"] === KEY) sent.push(path);
    else if (path.startsWith("/api/")) other.push(path);
  });
  await reader.evaluate(() => localStorage.setItem("neolibrary:reader-sidebar", "open"));
  await reader.reload();
  await expect(view).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await reader.getByRole("navigation", { name: "Reading tools" }).getByRole("button", { name: /Study/ }).click();
  await expect.poll(() => sent.some((p) => p.endsWith("/prerequisites"))).toBe(true);
  expect(sent.every((p) => /\/(rewrites|rewritten|prerequisites|questions|ask|explain-back|xray)/.test(p))).toBe(true);
  expect(other.some((p) => p.endsWith("/annotations"))).toBe(true); // other requests went, without the key

  // Removing the key forgets it in this browser.
  await reader.getByRole("button", { name: "Reading settings" }).click();
  await reader.getByTestId("own-keys").getByRole("button", { name: "Remove Anthropic key" }).click();
  expect(await reader.evaluate(() => localStorage.getItem("neolibrary:own-key:anthropic"))).toBeNull();

  // The Account page offers the same to a reader; the owner, whose keys are the library's, is not asked.
  await reader.goto("/account");
  await expect(reader.getByTestId("own-keys")).toBeVisible();
  await page.goto("/account");
  await expect(page.getByTestId("own-keys")).toHaveCount(0);
  await reader.context().close();
});
