import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import * as CFI from "foliate-js/epubcfi.js";
import { readableEpub } from "../lib/library/test-epub";
import { ADMIN_STATE } from "./pages";

// M4 "Done when" (part): open a book, change font size, reload: it reopens at
// the same spot.

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial" });

const reader = (page: Page) => page.getByTestId("reader");
const cfiStart = (cfi: string | null) => (cfi ?? "").split(",")[0];

async function openJekyll(page: Page) {
  await page.goto("/library");
  await page.getByTestId("shelf").getByRole("link", { name: /^The Strange Case/ }).click();
  await expect(page.getByRole("heading", { name: /^The Strange Case/, level: 1 })).toBeVisible();
  await page.getByRole("link", { name: /^(Read|Continue reading)$/ }).click();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
}

async function savedPosition(page: Page, title: RegExp) {
  const data = await (await page.request.get("/api/export")).json();
  return data.books.find((b: { title: string }) => title.test(b.title))?.position ?? null;
}

test("open a book, turn pages, change the text size, reload: same spot", async ({ page }) => {
  await openJekyll(page);
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next page" }).click();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Story of the Door").last()).toBeVisible();

  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Larger text" }).click();
  await page.getByRole("button", { name: "Larger text" }).click();
  await expect(page.getByTestId("text-size")).toHaveText("120%");
  await page.keyboard.press("Escape");

  // Wait until the position on the page has been saved on the server.
  let before = "";
  await expect
    .poll(async () => {
      before = (await reader(page).getAttribute("data-cfi")) ?? "";
      return before !== "" && (await savedPosition(page, /^The Strange Case/)) === before;
    }, { timeout: 10_000 })
    .toBe(true);
  expect(before).toMatch(/^epubcfi\(/);

  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: "Reading settings" }).click();
  await expect(page.getByTestId("text-size")).toHaveText("120%");
  await expect.poll(async () => cfiStart(await reader(page).getAttribute("data-cfi"))).toBe(cfiStart(before));

  // The shelf and book page show the progress too.
  await page.goto("/library");
  await expect(page.getByTestId("shelf").getByText(/% read$/).first()).toBeVisible();
});

test("contents jump to a chapter; layout can switch to scrolling", async ({ page }) => {
  await openJekyll(page);
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Contents" }).getByRole("button", { name: "Search for Mr. Hyde" }).click();
  await expect(page.locator("footer").getByText("Search for Mr. Hyde")).toBeVisible();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Scroll" }).click();
  await expect(page.getByRole("button", { name: "Scroll" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Pages", exact: true }).click(); // back to the default for later tests
});

test("scripts inside a book never run", async ({ page }) => {
  const evil = readableEpub("Trap Book", [
    `<p>Nothing to see.</p><script>document.title = "pwned"; try { parent.document.title = "pwned"; parent.postMessage("pwned", "*"); } catch (e) {}</script><img src="x" onerror="parent.document.title='pwned'"/>`,
  ]);
  await page.goto("/import");
  await page.getByLabel("Choose files").setInputFiles({ name: "trap.epub", mimeType: "application/epub+zip", buffer: Buffer.from(evil) });
  await expect(page.getByTestId("upload-results").getByText("Added to your library")).toBeVisible();
  await page.goto("/library");
  await page.evaluate(() => {
    (window as unknown as { __msgs: string[] }).__msgs = [];
    addEventListener("message", (e) => (window as unknown as { __msgs: string[] }).__msgs.push(String(e.data)));
  });
  await page.getByTestId("shelf").getByRole("link", { name: /^Trap Book/ }).click();
  await expect(page.getByRole("heading", { name: "Trap Book", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Read", exact: true }).click();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.waitForTimeout(1000);
  await expect(page).toHaveTitle(/Reading · Neolibrary/);
  expect(await page.evaluate(() => (window as unknown as { __msgs?: string[] }).__msgs ?? [])).not.toContain("pwned");
});

// Like Kindle: on the left of the top bar, a back arrow to the library and the
// table of contents, which opens on the left; reading is not disturbed.
test("the back arrow leaves the book for the library; contents open on the left without moving the page", async ({ page }) => {
  await openJekyll(page);
  const host = page.locator("foliate-view");
  const before = await host.boundingBox();
  await page.getByRole("button", { name: "Contents" }).click();
  const contents = page.getByRole("navigation", { name: "Contents" });
  await expect(contents).toBeVisible();
  const box = (await contents.boundingBox())!;
  expect(box.x + box.width / 2).toBeLessThan(1280 / 2);
  // The page of text stays exactly where it was.
  expect(await host.boundingBox()).toEqual(before);
  await contents.getByRole("button", { name: "Search for Mr. Hyde" }).click();
  await expect(contents).toHaveCount(0);
  await expect(page.locator("footer").getByText("Search for Mr. Hyde")).toBeVisible();
  // Opened again, it marks the chapter being read.
  await page.getByRole("button", { name: "Contents" }).click();
  await expect(contents.locator('[aria-current="true"]')).toHaveText("Search for Mr. Hyde");
  await page.getByRole("button", { name: "Contents" }).click();

  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
      await page.getByRole("button", { name: "Contents" }).click();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `screenshots/reader-contents-${name}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByRole("link", { name: "Back to your library" }).click();
  await expect(page).toHaveURL(/:\d+\/$/);
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
});

test("the reader is accessible, and looks right on phone and desktop, light and dark", async ({ page }) => {
  await openJekyll(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // Screenshots for the PR grid (book text renders inside the book frame).
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `screenshots/reader-${name}-${scheme}.png` });
    }
  }
});

// M4 "Done when" (part): search finds a phrase in a fixture book.
test("search finds a phrase and opens the reader at that paragraph", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("searchbox", { name: "Search inside your books" }).fill('"singular ferocity"');
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("status")).toHaveText(/^1 passage in 1 book\.$/);
  const book = page.getByRole("region", { name: /The Strange Case of Dr\. Jekyll and Mr\. Hyde/ });
  const hit = book.getByRole("link").first();
  await expect(hit).toContainText("The Carew Murder Case");
  await expect(hit.locator("mark")).toHaveText(["singular", "ferocity"]);

  const target = decodeURIComponent((await hit.getAttribute("href"))!.split("?at=")[1]);
  await hit.click();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(page.locator("footer").getByText("The Carew Murder Case")).toBeVisible();
  // The paragraph is on the page in front of the reader: its address lies inside
  // the visible range the reader reports (compared with foliate-js's own CFI code;
  // the book frame itself is closed to tests).
  const visible = (await reader(page).getAttribute("data-cfi"))!;
  const paragraphStart = target.replace(/\)$/, "/1:0)");
  expect(CFI.compare(paragraphStart, CFI.collapse(visible))).toBeGreaterThanOrEqual(0);
  expect(CFI.compare(paragraphStart, CFI.collapse(visible, true))).toBeLessThanOrEqual(0);

  // ...and a paragraph from chapter 1 is not (so the check above can fail).
  await page.goto(`/search?q=${encodeURIComponent('"rugged countenance"')}`);
  const other = decodeURIComponent(
    (await page.getByRole("region", { name: /The Strange Case/ }).getByRole("link").filter({ hasText: "rugged" }).getAttribute("href"))!.split("?at=")[1],
  );
  expect(CFI.compare(other.replace(/\)$/, "/1:0)"), CFI.collapse(visible))).toBeLessThan(0);

  // Nothing matches: a clear message, no results.
  await page.goto("/search?q=xylophone+zeppelin");
  await expect(page.getByRole("status")).toHaveText("Nothing in your books or notes matches “xylophone zeppelin”.");
});

// M4 (d): themes and PDFs.

test("the theme picker recolours the reader (Sepia), and Auto follows the device", async ({ page }) => {
  await openJekyll(page);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Sepia" }).click();
  await expect(reader(page)).toHaveClass(/theme-sepia/);
  await expect(reader(page)).toHaveCSS("background-color", "rgb(243, 234, 214)");
  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(reader(page)).toHaveClass(/theme-sepia/);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Auto" }).click();
  await expect(reader(page)).not.toHaveClass(/theme-/);
  await expect(reader(page)).toHaveCSS("background-color", "rgb(243, 237, 225)");
});

test("a PDF opens in the reader, turns pages, and its text is searchable", async ({ page }) => {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle("Discourse on the Method");
  doc.setAuthor("René Descartes");
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const lines = [
    "Good sense is, of all things among men, the most equally distributed.",
    "The diversity of our opinions does not arise from some being endowed with a larger share of reason.",
    "It is not enough to have a vigorous mind; the prime requisite is rightly to apply it.",
  ];
  lines.forEach((text, i) => {
    const p = doc.addPage([612, 792]);
    p.drawText(`Part ${i + 1}`, { x: 72, y: 700, size: 18, font });
    p.drawText(text, { x: 72, y: 660, size: 11, font });
  });
  await page.goto("/import");
  await page.getByLabel("Choose files").setInputFiles({ name: "discourse.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
  await expect(page.getByTestId("upload-results").getByText("Added to your library")).toBeVisible();
  await page.goto("/library");
  // Labelled by what each title offers: narration is EPUB only, so this PDF is Read only, while an
  // EPUB says Read and listen (the tests' fake voice counts as narration).
  const shelfItem = (title: string) => page.getByTestId("shelf").getByRole("listitem").filter({ hasText: title });
  await expect(shelfItem("Discourse on the Method").getByText("Read only", { exact: true })).toBeVisible();
  await expect(shelfItem("The Strange Case").getByText("Read and listen", { exact: true })).toBeVisible();

  await page.getByTestId("shelf").getByRole("link", { name: /^Discourse on the Method/ }).click();
  await expect(page.getByText(/PDF · 3 pages/)).toBeVisible();
  await expect(page.getByText("Read only · 0% read")).toBeVisible();
  await page.getByRole("link", { name: "Read", exact: true }).click();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(reader(page)).toHaveAttribute("data-cfi", /^epubcfi\(\/6\/2/);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(reader(page)).toHaveAttribute("data-cfi", /^epubcfi\(\/6\/4/);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await expect(page.getByText("This is a PDF")).toBeVisible();

  await page.goto(`/search?q=${encodeURIComponent('"vigorous mind"')}`);
  const hit = page.getByRole("region", { name: /Discourse on the Method/ }).getByRole("link").first();
  await expect(hit).toContainText("Page 3");
  await hit.click();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(reader(page)).toHaveAttribute("data-cfi", /^epubcfi\(\/6\/6/);
});

/** How many pages are actually facing the reader (not the saved choice). */
async function sidesShowing(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as {
      lastLocation?: { range: Range | null };
      renderer: {
        columnCount?: number;
        getAttribute(name: string): string | null;
        getBoundingClientRect(): DOMRect;
        getContents(): { doc: Document }[];
      };
    };
    const r = view?.renderer;
    if (!r) return 0;
    const realPdf = r.getContents().filter(({ doc }) => doc?.documentElement?.dataset?.page != null);
    if (realPdf.length) {
      return realPdf.filter(({ doc }) => {
        const frame = doc.defaultView?.frameElement as HTMLElement | null;
        const host = frame?.parentElement;
        if (!host) return false;
        const box = host.getBoundingClientRect();
        return getComputedStyle(host).display !== "none" && box.width > 2 && box.height > 2;
      }).length;
    }
    if (r.getAttribute("flow") === "scrolled") return 1;
    if (typeof r.columnCount === "number" && r.columnCount < 2) return 1;
    const shown = view.lastLocation?.range;
    if (!shown || typeof r.columnCount !== "number") return r.columnCount ?? 0;
    const rects = Array.from(shown.getClientRects()).filter((rect) => rect.width > 20 && rect.height > 0);
    if (!rects.length) return r.columnCount;
    const span = Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left));
    return span > r.getBoundingClientRect().width * 0.55 ? 2 : 1;
  });
}

/** Step off a single end leaf until two real pages are showing. */
async function showFacingPair(page: Page) {
  await expect.poll(() => sidesShowing(page)).toBeGreaterThan(0);
  for (let i = 0; i < 3 && (await sidesShowing(page)) < 2; i++) {
    const at = (await reader(page).getAttribute("data-cfi")) ?? "";
    const label = (await page.locator('[aria-label$="% read"]').getAttribute("aria-label")) ?? "";
    await page.getByRole("button", { name: label.startsWith("100") ? "Previous page" : "Next page" }).click();
    await expect(reader(page)).not.toHaveAttribute("data-cfi", at);
    await expect.poll(() => sidesShowing(page)).toBeGreaterThan(0);
  }
}

/** The place being read is still inside the pages now showing. */
function stillShowing(before: string, after: string) {
  const start = CFI.collapse(before);
  return CFI.compare(start, CFI.collapse(after)) >= 0 && CFI.compare(start, CFI.collapse(after, true)) <= 0;
}

async function selectShownWords(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as {
      lastLocation?: { range: Range | null };
      renderer: { getContents(): { doc: Document }[] };
    };
    const shown = view.lastLocation?.range ?? null;
    for (const { doc } of view.renderer.getContents()) {
      const layer = doc.querySelector(".textLayer");
      const root = layer ?? doc.body;
      if (!root) continue;
      const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.nodeValue ?? "";
        const start = text.search(/\S/);
        if (start < 0) continue;
        if (shown && !layer && !shown.intersectsNode(n)) continue;
        const end = Math.min(text.length, start + 24);
        if (end <= start) continue;
        const range = doc.createRange();
        range.setStart(n, start);
        range.setEnd(n, end);
        const sel = doc.getSelection();
        if (!sel) continue;
        sel.removeAllRanges();
        sel.addRange(range);
        if (sel.isCollapsed) continue;
        return text.slice(start, end);
      }
    }
    return "";
  });
}

async function uploadFacingPdf(page: Page) {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle("Facing Pages");
  doc.setAuthor("Test");
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const lines = [
    "The first leaf stands on its own.",
    "The second leaf sits across from the third.",
    "The third leaf sits across from the second.",
    "The fourth leaf closes the book.",
  ];
  lines.forEach((text, i) => {
    const p = doc.addPage([612, 792]);
    p.drawText(`Leaf ${i + 1}`, { x: 72, y: 700, size: 18, font });
    p.drawText(text, { x: 72, y: 660, size: 12, font });
  });
  await page.goto("/import");
  await page.getByLabel("Choose files").setInputFiles({
    name: "facing-pages.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.getByTestId("upload-results").getByText("Added to your library")).toBeVisible();
}

async function openFacingPdf(page: Page) {
  await page.goto("/library");
  await expect(page.getByTestId("shelf").getByRole("link", { name: /^The Strange Case/ })).toBeVisible();
  const link = page.getByTestId("shelf").getByRole("link", { name: /^Facing Pages/ });
  if ((await link.count()) === 0) await uploadFacingPdf(page);
  await page.goto("/library");
  await page.getByTestId("shelf").getByRole("link", { name: /^Facing Pages/ }).click();
  await page.getByRole("link", { name: /^(Read|Continue reading)$/ }).click();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
}

test("a book opens on one page, for an EPUB and for a PDF", async ({ page }) => {
  await openJekyll(page);
  await expect.poll(() => sidesShowing(page)).toBe(1);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await expect(page.getByRole("button", { name: "One page", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Larger text" })).toBeVisible();

  await uploadFacingPdf(page);
  await openFacingPdf(page);
  await expect.poll(() => sidesShowing(page)).toBe(1);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await expect(page.getByRole("button", { name: "One page", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("This is a PDF")).toBeVisible();
  await expect(page.getByRole("button", { name: "Larger text" })).toHaveCount(0);
});

test.describe("page count", () => {
  // Four reloads, then a second book. The default 30 seconds runs out.
  test.describe.configure({ timeout: 120_000 });

test("two pages is a reading setting for every book", async ({ page }) => {
  await openJekyll(page);
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Contents" }).getByRole("button", { name: "Story of the Door" }).click();
  await expect(page.locator("footer").getByText("Story of the Door")).toBeVisible();
  await expect.poll(() => sidesShowing(page)).toBe(1);
  const before = (await reader(page).getAttribute("data-cfi")) ?? "";
  expect(before).toMatch(/^epubcfi\(/);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Two pages", exact: true }).click();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await expect.poll(() => sidesShowing(page)).toBe(2);
  const after = (await reader(page).getAttribute("data-cfi")) ?? "";
  expect(stillShowing(before, after)).toBe(true);
  await expect.poll(() => selectShownWords(page)).not.toBe("");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => sidesShowing(page)).toBe(1);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => sidesShowing(page)).toBe(2);

  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Scroll", exact: true }).click();
  await expect.poll(() => sidesShowing(page)).toBe(1);
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await expect.poll(() => sidesShowing(page)).toBe(2);
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect.poll(() => sidesShowing(page)).toBe(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("neolibrary.reader.v1") || "{}").pages)).toBe("two");
  await page.getByRole("button", { name: "Reading settings" }).click();
  await expect(page.getByRole("button", { name: "Two pages", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [
    ["desktop", 1280, 800],
    ["phone", 390, 844],
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
      await expect.poll(() => sidesShowing(page)).toBe(name === "phone" ? 1 : 2);
      await page.screenshot({ path: `screenshots/reader-pages-epub-${name}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Reading settings" }).click();
  await expect(page.getByRole("button", { name: "Two pages", exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await page.screenshot({ path: "screenshots/reader-pages-control-desktop-light.png" });
  await page.keyboard.press("Escape");

  // The same saved choice, on the next book, which is a PDF.
  await openFacingPdf(page);
  await showFacingPair(page);
  await expect.poll(() => sidesShowing(page)).toBe(2);
  const pdfAt = (await reader(page).getAttribute("data-cfi")) ?? "";
  await expect.poll(() => selectShownWords(page)).not.toBe("");
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "One page", exact: true }).click();
  await expect.poll(() => sidesShowing(page)).toBe(1);
  await expect.poll(async () => reader(page).getAttribute("data-cfi")).toBe(pdfAt);
  await page.getByRole("button", { name: "Two pages", exact: true }).click();
  await expect.poll(() => sidesShowing(page)).toBe(2);
  await expect.poll(async () => stillShowing(pdfAt, (await reader(page).getAttribute("data-cfi")) ?? "")).toBe(true);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => sidesShowing(page)).toBe(1);

  for (const [name, w, h] of [
    ["desktop", 1280, 800],
    ["phone", 390, 844],
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
      if (name === "desktop") await showFacingPair(page);
      await expect.poll(() => sidesShowing(page)).toBe(name === "phone" ? 1 : 2);
      await page.screenshot({ path: `screenshots/reader-pages-pdf-${name}-${scheme}.png` });
    }
  }
});
});
