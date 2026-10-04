import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { readFileSync } from "node:fs";
import path from "node:path";
import { tinyEpub } from "../lib/library/test-epub";
import { ADMIN_STATE } from "./pages";

// M3 "Done when" (part): uploading three public-domain books shows them on the
// shelf with correct titles and covers; uploading a file whose title matches a
// wanted book attaches to it.

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial" });

const fixture = (name: string) => path.join("fixtures", "books", name);

test("three public-domain books land on the shelf with their titles and covers", async ({ page }) => {
  await page.goto("/shelf");
  await page.getByLabel("Choose files").setInputFiles([
    fixture("stevenson-jekyll-and-hyde.epub"),
    fixture("shelley-frankenstein.epub"),
    fixture("wells-the-time-machine.epub"),
  ]);
  const results = page.getByTestId("upload-results");
  await expect(results.getByText("Added to your shelf")).toHaveCount(3);

  const shelf = page.getByTestId("shelf");
  for (const title of ["The Strange Case of Dr. Jekyll and Mr. Hyde", "Frankenstein", "The Time Machine"]) {
    await expect(shelf.getByRole("link", { name: new RegExp(`^${title.replace(/[.]/g, "\\.")}`) })).toBeVisible();
  }
  // Each cover is the book's own image, and it actually loaded.
  const covers = shelf.locator("img");
  await expect(covers).toHaveCount(3);
  for (const img of await covers.all()) {
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  await expect(page.getByText("3 books.")).toBeVisible();
});

test("a book page shows what the file told us", async ({ page }) => {
  await page.goto("/shelf");
  await page.getByTestId("shelf").getByRole("link", { name: /^The Time Machine/ }).click();
  await expect(page.getByRole("heading", { name: "The Time Machine", level: 1 })).toBeVisible();
  await expect(page.getByText("H. G. Wells")).toBeVisible();
  await expect(page.getByText(/EPUB · \d+ chapters/)).toBeVisible();
});

test("a file matching a wanted book attaches to it and lights up the path", async ({ page }) => {
  await page.goto("/shelf");
  await page.getByLabel("Choose files").setInputFiles({
    name: "the-grid.epub",
    mimeType: "application/epub+zip",
    buffer: Buffer.from(tinyEpub("The Grid: The Fraying Wires Between Americans and Our Energy Future", "Gretchen Bakke")),
  });
  await expect(page.getByTestId("upload-results").getByText("Attached to the wanted book in your path")).toBeVisible();
  await page.goto("/");
  // Owned now: no "(not owned)" in its name, and the path counts it.
  await expect(page.getByRole("link", { name: "The Grid", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "The Grid (not owned)" })).toHaveCount(0);
  await expect(page.getByText(/1 owned/)).toBeVisible();
});

test("duplicates, other file types and DRM-protected books are refused politely", async ({ page }) => {
  await page.goto("/shelf");
  const drm = zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>'),
    "META-INF/rights.xml": strToU8("<rights/>"),
    "c.opf": strToU8("<package><metadata/></package>"),
  });
  await page.getByLabel("Choose files").setInputFiles([
    { name: "wells-the-time-machine.epub", mimeType: "application/epub+zip", buffer: readFileSync(fixture("wells-the-time-machine.epub")) },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
    { name: "locked.epub", mimeType: "application/epub+zip", buffer: Buffer.from(drm) },
  ]);
  const results = page.getByTestId("upload-results");
  await expect(results.getByText("Already on your shelf")).toBeVisible();
  await expect(results.getByText("Only EPUB and PDF files can be added.")).toBeVisible();
  await expect(results.getByText(/DRM-protected/)).toBeVisible();
  await expect(page.getByText("4 books.")).toBeVisible();
});

test("cover links are signed, short-lived and only for their owner", async ({ page, browser }) => {
  await page.goto("/shelf");
  const src = await page.getByTestId("shelf").locator("img").first().getAttribute("src");
  expect(src).toMatch(/^\/api\/files\/covers\/[0-9a-f-]+\/[0-9a-f-]+\.svg\?exp=\d+&sig=/);
  const ok = await page.request.get(src!);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-security-policy"]).toContain("sandbox");
  // Tampered signature → 403; signed out → 401.
  expect((await page.request.get(src!.replace(/sig=.*/, "sig=forged"))).status()).toBe(403);
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  expect((await anon.request.get(src!)).status()).toBe(401);
  await anon.close();
});
