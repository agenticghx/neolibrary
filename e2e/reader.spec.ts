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

// M19 P1b (the site review): the keyboard follows a panel, as in the account menu. Focus moves into a panel when it
// opens, and Escape closes it and puts focus back on the button that opened it, even right after a click on it.
test("the keyboard follows a panel: focus moves in when it opens, and Escape brings it back to its button", async ({ page }) => {
  await openJekyll(page);
  const pairs = [
    [page.getByRole("button", { name: "Contents" }), page.getByRole("navigation", { name: "Contents" })],
    [page.getByRole("button", { name: "Study" }), page.getByRole("region", { name: "What do I need to know?" })],
    [page.getByRole("button", { name: /^Notes/ }), page.getByRole("navigation", { name: "Notes" })],
    [page.getByRole("button", { name: "Reading settings" }), page.getByRole("region", { name: "Reading settings" })],
  ] as const;
  for (const [button, panel] of pairs) {
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    await expect.poll(() => panel.evaluate((el) => el.contains(document.activeElement)), { message: "focus inside the panel" }).toBe(true);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();
  }
  // Escape with the toolbar button itself focused (it used to swallow the key, so the panel stayed open).
  const [button, panel] = pairs[3];
  await button.click();
  await expect(panel).toBeVisible();
  await button.focus();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
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

// The book viewer paints the margins around the text with the colour the page had when its chapter loaded, unless the
// page names its theme colour (--theme-bg-color). Without it, a device turning dark (theme Auto) or a new theme left a
// light frame around a dark page until the next chapter or a reload (seen 2026-10-11 in M20's dark screenshots).
test("the margins around the text follow a change of theme without a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await openJekyll(page);
  // The band above the text: the viewer's top margin, outside the chapter's own frame.
  const margin = async () => {
    const png = (await page.screenshot({ clip: { x: 600, y: 64, width: 80, height: 24 } })).toString("base64");
    return page.evaluate(async (b64) => {
      const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/png" }));
      const ctx = new OffscreenCanvas(img.width, img.height).getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
      return sum.map((v) => Math.round(v / (d.length / 4)));
    }, png);
  };
  const paper = async () => (await reader(page).evaluate((el) => getComputedStyle(el).backgroundColor)).match(/\d+/g)!.slice(0, 3).map(Number);
  const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 6);
  const check = async (why: string) => {
    const want = await paper();
    await expect.poll(async () => near(await margin(), want), { message: `${why}: margin ${await margin()} vs paper ${want}` }).toBe(true);
  };
  await check("light");
  const light = await paper();
  // The device turns dark while the book is open (theme Auto).
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(async () => near(await paper(), light)).toBe(false);
  await check("device dark");
  // A theme chosen in the reader: Sepia, then back to Auto.
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Sepia" }).click();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await check("Sepia");
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Auto" }).click();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await check("back to light");
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
  // Labelled by what each title offers: the AI voice reads PDFs too (Part A2), so this PDF says
  // Read and listen, as an EPUB does (the tests' fake voice counts as narration).
  const shelfItem = (title: string) => page.getByTestId("shelf").getByRole("listitem").filter({ hasText: title });
  await expect(shelfItem("Discourse on the Method").getByText("Read and listen", { exact: true })).toBeVisible();
  await expect(shelfItem("The Strange Case").getByText("Read and listen", { exact: true })).toBeVisible();

  await page.getByTestId("shelf").getByRole("link", { name: /^Discourse on the Method/ }).click();
  await expect(page.getByText(/PDF · 3 pages/)).toBeVisible();
  await expect(page.getByText("Read and listen · 0% read")).toBeVisible();
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

// M20 Q8: a large book on a slow connection. The reader says how much of the file has arrived, and it waits as long
// as pieces keep coming (before, it gave up 30 s after it began opening, download included). The connection is slowed
// with Chromium's DevTools; the service worker is kept out of this page so the slowing applies to the download itself.
test.describe("a large book on a slow connection", () => {
  test.use({ serviceWorkers: "block" });

  test("says how much of the file has arrived, then opens", async ({ page }) => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const { randomBytes } = await import("node:crypto");
    const doc = await PDFDocument.create();
    doc.setTitle("A Heavy Book");
    doc.setAuthor("Test");
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    doc.addPage([612, 792]).drawText("A heavy book: three megabytes, mostly an attachment.", { x: 72, y: 700, size: 14, font });
    await doc.attach(randomBytes(3 * 1024 * 1024), "filler.bin", { mimeType: "application/octet-stream" });
    await page.goto("/import");
    await page.getByLabel("Choose files").setInputFiles({ name: "heavy.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
    await expect(page.getByTestId("upload-results").getByText("Added to your library")).toBeVisible({ timeout: 20_000 });
    const books = (await (await page.request.get("/api/export")).json()).books as { id: string; title: string; deletedAt?: string }[];
    const heavy = books.find((b) => b.title === "A Heavy Book" && !b.deletedAt)!;

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    // About 1 MB a second: the 3 MB file takes about 3 s.
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: 1024 * 1024, uploadThroughput: -1 });
    await page.goto(`/books/${heavy.id}/read`);
    await expect(page.getByText(/^Opening the book… \d+\.\d of 3\.0 MB downloaded$/)).toBeVisible({ timeout: 10_000 });
    await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

    // Leave the shelves as the later tests expect them: the heavy book removed.
    await page.goto(`/books/${heavy.id}`);
    await page.locator("summary", { hasText: "Remove from library" }).click();
    await page.locator("form").getByRole("button", { name: "Remove from library" }).click();
    await expect(page).toHaveURL(/\/library$/);
  });
});

/** The PDF leaf in an address (epubcfi(/6/4) is leaf 1), or -1. */
function pdfLeaf(cfi: string) {
  const n = Number(/^epubcfi\(\/6\/(\d+)/.exec(cfi)?.[1]);
  return Number.isInteger(n) ? n / 2 - 1 : -1;
}

/** The one PDF leaf on screen, or -1 when none or several are showing. */
async function visiblePdfLeaf(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as {
      renderer?: { getContents(): { doc: Document }[] };
    };
    const pages = (view?.renderer?.getContents() ?? []).flatMap(({ doc }) => {
      const raw = doc?.documentElement?.dataset?.page;
      const frame = doc?.defaultView?.frameElement as HTMLElement | null;
      const host = frame?.parentElement;
      if (!host || raw == null) return [];
      const box = host.getBoundingClientRect();
      if (getComputedStyle(host).display === "none" || box.width <= 2 || box.height <= 2) return [];
      const n = Number(raw);
      return Number.isInteger(n) ? [n] : [];
    });
    const only = pages[0];
    return pages.length === 1 && only !== undefined ? only : -1;
  });
}

/** How many pages are actually facing the reader (not the saved choice). */
async function sidesShowing(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as {
      lastLocation?: { range: Range | null };
      renderer: {
        columnCount?: number;
        localName: string;
        getAttribute(name: string): string | null;
        getBoundingClientRect(): DOMRect;
        getContents(): { doc: Document }[];
      };
    };
    const r = view?.renderer;
    if (!r) return 0;
    const contents = r.getContents();
    const realPdf = contents.filter(({ doc }) => doc?.documentElement?.dataset?.page != null);
    // A PDF's pages are frames. While a page choice reopens them, none are ready yet: that is zero, not a column count.
    if (realPdf.length || r.localName === "foliate-fxl") {
      return realPdf.filter(({ doc }) => {
        const frame = doc.defaultView?.frameElement as HTMLElement | null;
        const host = frame?.parentElement;
        if (!host) return false;
        const box = host.getBoundingClientRect();
        return getComputedStyle(host).display !== "none" && box.width > 2 && box.height > 2;
      }).length;
    }
    // The renderer's column count can stay at 2 after Scroll. The document's own column-width is the layout:
    // auto is one column (scroll). A pixel width is pages, and the span of the text says whether two are showing.
    if (typeof r.columnCount === "number" && r.columnCount < 2) return 1;
    const laidOut = contents[0]?.doc?.documentElement;
    const laidOutWin = laidOut?.ownerDocument?.defaultView;
    if (laidOut && laidOutWin && laidOutWin.getComputedStyle(laidOut).columnWidth === "auto") return 1;
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

test("two pages is a reading setting for every book", async ({ page }, testInfo) => {
  // Four reloads, a second book, then the tall-window check. The group's limit does not always apply; set it here too.
  testInfo.setTimeout(120_000);
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

  // Two pages on a tall window. Next from the cover shows the left page of the pair. A reload must open that same page, not the hidden one beside it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect.poll(() => sidesShowing(page)).toBe(1);
  for (let i = 0; i < 6 && (await visiblePdfLeaf(page)) !== 0; i++) {
    const at = (await reader(page).getAttribute("data-cfi")) ?? "";
    await page.getByRole("button", { name: "Previous page" }).click();
    await expect(reader(page)).not.toHaveAttribute("data-cfi", at);
    await expect.poll(() => sidesShowing(page)).toBe(1);
  }
  await expect.poll(() => visiblePdfLeaf(page)).toBe(0);
  await expect.poll(async () => pdfLeaf((await reader(page).getAttribute("data-cfi")) ?? "")).toBe(0);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect.poll(() => visiblePdfLeaf(page)).toBe(1);
  await expect.poll(async () => pdfLeaf((await reader(page).getAttribute("data-cfi")) ?? "")).toBe(1);
  // The saved place is written a moment after the turn. Reload only once the server has this leaf.
  await expect.poll(async () => pdfLeaf((await savedPosition(page, /^Facing Pages/)) ?? "")).toBe(1);
  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect.poll(() => visiblePdfLeaf(page)).toBe(1);
  await expect.poll(async () => pdfLeaf((await reader(page).getAttribute("data-cfi")) ?? "")).toBe(1);
});
});

/** The PDF leaves actually facing the reader, low index first. */
async function pdfLeaves(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as {
      renderer?: { getContents(): { doc: Document }[] };
    };
    const leaves = (view?.renderer?.getContents() ?? []).flatMap(({ doc }) => {
      const raw = doc?.documentElement?.dataset?.page;
      const frame = doc?.defaultView?.frameElement as HTMLElement | null;
      const host = frame?.parentElement;
      if (!host || raw == null) return [];
      const box = host.getBoundingClientRect();
      if (getComputedStyle(host).display === "none" || box.width <= 2 || box.height <= 2) return [];
      const n = Number(raw);
      return Number.isInteger(n) ? [n] : [];
    });
    return leaves.sort((a, b) => a - b);
  });
}

async function pdfSide(page: Page, which: "left" | "right") {
  return page.evaluate((side) => {
    const view = document.querySelector("foliate-view") as unknown as {
      renderer?: { getContents(): { doc: Document }[] };
    };
    const sides = (view?.renderer?.getContents() ?? []).flatMap(({ doc }) => {
      const raw = doc?.documentElement?.dataset?.page;
      const frame = doc?.defaultView?.frameElement as HTMLElement | null;
      const host = frame?.parentElement;
      if (!host || raw == null) return [];
      const box = host.getBoundingClientRect();
      if (getComputedStyle(host).display === "none" || box.width <= 2 || box.height <= 2) return [];
      const index = Number(raw);
      if (!Number.isInteger(index)) return [];
      return [{ index, x: box.x, y: box.y, width: box.width, height: box.height }];
    });
    sides.sort((a, b) => a.x - b.x);
    if (sides.length !== 2) return null;
    return side === "left" ? sides[0]! : sides[1]!;
  }, which);
}

async function clickSide(page: Page, which: "left" | "right") {
  const box = await pdfSide(page, which);
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

async function dragSide(page: Page, which: "left" | "right") {
  const box = await pdfSide(page, which);
  expect(box).not.toBeNull();
  const y = box!.y + box!.height * 0.21;
  await page.mouse.move(box!.x + box!.width * 0.18, y);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.78, y, { steps: 12 });
  await page.mouse.up();
}

async function selectedWords(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as {
      renderer?: { getContents(): { doc: Document }[] };
    };
    for (const { doc } of view?.renderer?.getContents() ?? []) {
      const text = doc.getSelection()?.toString() ?? "";
      if (text.trim()) return text;
    }
    return "";
  });
}

async function pdfWords(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as {
      renderer?: { getContents(): { doc: Document }[] };
    };
    return (view?.renderer?.getContents() ?? [])
      .map(({ doc }) => doc.querySelector(".textLayer")?.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  });
}

async function openSpinePdf(page: Page) {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle("Spine Fold Line");
  doc.setAuthor("Test");
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const lines = [
    "Leaf one stands alone on the right.",
    "Leaf two sits on the left of the first pair.",
    "Leaf three sits on the right of the first pair.",
    "Leaf four sits on the left of the next pair.",
    "Leaf five sits on the right of the next pair.",
    "Leaf six closes the book.",
  ];
  // Words on the west, middle, and east of each page, so a half-turned sheet shows two different pages.
  lines.forEach((text, i) => {
    const leaf = doc.addPage([612, 792]);
    const n = i + 1;
    leaf.drawText(`Leaf ${n}`, { x: 48, y: 730, size: 20, font });
    leaf.drawText("west", { x: 48, y: 690, size: 16, font });
    leaf.drawText("middle", { x: 250, y: 690, size: 16, font });
    leaf.drawText("east", { x: 450, y: 690, size: 16, font });
    // This row sits where the test drags, so a drag selects words and does not turn the page.
    leaf.drawText(`West ${n}`, { x: 48, y: 658, size: 13, font });
    leaf.drawText(`Middle ${n}`, { x: 250, y: 658, size: 13, font });
    leaf.drawText(`East ${n}`, { x: 440, y: 658, size: 13, font });
    leaf.drawText("Drag across these words to select them and the page must stay put", { x: 36, y: 620, size: 14, font });
    leaf.drawText(text, { x: 48, y: 590, size: 11, font });
    leaf.drawText(`West ${n}`, { x: 48, y: 400, size: 16, font });
    leaf.drawText(`East ${n}`, { x: 450, y: 400, size: 16, font });
  });
  await page.goto("/library");
  const link = page.getByTestId("shelf").getByRole("link", { name: /^Spine Fold Line/ });
  if ((await link.count()) === 0) {
    await page.goto("/import");
    await page.getByLabel("Choose files").setInputFiles({
      name: "spine-fold-sheet.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await doc.save()),
    });
    await expect(page.getByTestId("upload-results").getByText("Added to your library")).toBeVisible();
    await page.goto("/library");
  }
  await page.getByTestId("shelf").getByRole("link", { name: /^Spine Fold Line/ }).click();
  await page.getByRole("link", { name: /^(Read|Continue reading)$/ }).click();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
}

test.describe("Spine fold", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a click folds two PDF pages, and a drag does not", async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);
    await mkdir("screenshots", { recursive: true });
    await openSpinePdf(page);
    await page.getByRole("button", { name: "Reading settings" }).click();
    await page.getByRole("button", { name: "Two pages", exact: true }).click();
    // Escape does nothing while the Two pages button has focus, and the open panel covers Next page.
    await page.getByRole("button", { name: "Reading settings" }).click();
    await expect(page.getByRole("region", { name: "Reading settings" })).toHaveCount(0);
    await showFacingPair(page);
    await expect.poll(() => pdfLeaves(page)).toEqual([1, 2]);
    await expect.poll(() => pdfWords(page)).toContain("Leaf 2");

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({ path: "screenshots/reader-spine-desktop-light.png" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: "screenshots/reader-spine-desktop-dark.png" });
    await page.emulateMedia({ colorScheme: "light" });

    await page.evaluate(() => {
      document.documentElement.dataset.spineHold = "mid";
    });
    await clickSide(page, "right");
    await expect(page.locator("[data-spine-fold]")).toBeVisible();
    await expect.poll(() => pdfLeaves(page)).toEqual([1, 2]);
    // A second click while the sheet is moving does nothing.
    await clickSide(page, "right");
    await page.waitForTimeout(400);
    await expect.poll(() => pdfLeaves(page)).toEqual([1, 2]);
    await page.screenshot({ path: "screenshots/reader-spine-mid-desktop-light.png" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: "screenshots/reader-spine-mid-desktop-dark.png" });
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => {
      delete document.documentElement.dataset.spineHold;
    });
    await expect.poll(() => pdfLeaves(page), { timeout: 10_000 }).toEqual([3, 4]);
    await expect(page.locator("[data-spine-fold]")).toHaveCount(0);
    await expect.poll(() => selectShownWords(page)).not.toBe("");

    await clickSide(page, "left");
    await expect.poll(() => pdfLeaves(page), { timeout: 10_000 }).toEqual([1, 2]);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => pdfLeaves(page), { timeout: 10_000 }).toEqual([3, 4]);

    await dragSide(page, "right");
    await expect(page.locator("[data-spine-fold]")).toHaveCount(0);
    await expect.poll(() => pdfLeaves(page)).toEqual([3, 4]);
    await expect.poll(() => selectedWords(page)).not.toBe("");

    // Read aloud turns with goTo. That must not play the fold, even if a test is holding one.
    await page.evaluate(() => {
      document.documentElement.dataset.spineHold = "mid";
    });
    await page.evaluate(() =>
      (document.querySelector("foliate-view") as unknown as { goTo(target: string): Promise<void> }).goTo("epubcfi(/6/12)"),
    );
    await expect(page.locator("[data-spine-fold]")).toHaveCount(0);
    await expect.poll(() => pdfLeaves(page)).toEqual([5]);
    await page.evaluate(() => {
      delete document.documentElement.dataset.spineHold;
    });

    const selectedBar = page.getByRole("toolbar", { name: "Selected text" });
    if ((await selectedBar.count()) > 0) {
      await selectedBar.getByRole("button", { name: "Close" }).click();
      await expect(selectedBar).toHaveCount(0);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => sidesShowing(page)).toBe(1);
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({ path: "screenshots/reader-spine-phone-light.png" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: "screenshots/reader-spine-phone-dark.png" });
    const phoneLeaves = await pdfLeaves(page);
    const phone = await pdfSide(page, "right");
    // One page has no left and right pair, so a click is not a turn.
    const only = await page.evaluate(() => {
      const view = document.querySelector("foliate-view") as unknown as {
        renderer?: { getContents(): { doc: Document }[] };
      };
      const boxes = (view?.renderer?.getContents() ?? []).flatMap(({ doc }) => {
        const frame = doc?.defaultView?.frameElement as HTMLElement | null;
        const host = frame?.parentElement;
        if (!host) return [];
        const box = host.getBoundingClientRect();
        if (getComputedStyle(host).display === "none" || box.width <= 2) return [];
        return [{ x: box.x, y: box.y, width: box.width, height: box.height }];
      });
      return boxes.length === 1 ? boxes[0]! : null;
    });
    expect(phone).toBeNull();
    expect(only).not.toBeNull();
    await page.mouse.click(only!.x + only!.width / 2, only!.y + only!.height / 2);
    await expect(page.locator("[data-spine-fold]")).toHaveCount(0);
    await expect.poll(() => pdfLeaves(page)).toEqual(phoneLeaves);
  });

  // M19 P2 follow-up (Samuel, 2026-10-11): in Night the pages were dimmed but the sheet turning over flashed white,
  // because the fold paints copies of the pages' pixels and the dimming is a filter on the page, not in its pixels.
  // The fold's own picture, held halfway, is now as dark as the dimmed pages, by the canvas filter and by the
  // by-hand path older Safari takes; with "As printed" it stays as bright as the paper.
  test("in Night the turning sheet is dimmed like the pages, and as printed when they are", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await openSpinePdf(page);
    const settings = page.getByRole("region", { name: "Reading settings" });
    const choose = async (name: string) => {
      if (!(await settings.isVisible())) await page.getByRole("button", { name: "Reading settings" }).click();
      await settings.getByRole("button", { name, exact: true }).click();
      await expect(settings.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
    };
    const closeSettings = async () => {
      await page.getByRole("button", { name: "Reading settings" }).click();
      await expect(settings).toHaveCount(0);
    };
    await choose("Two pages");
    await choose("Night");
    await choose("Dimmed");
    await closeSettings();
    await showFacingPair(page);
    await expect.poll(() => pdfLeaves(page)).toEqual([1, 2]);

    // How light the fold's picture is on average, held halfway (0 black, 255 white); then the turn finishes.
    const midFold = async (side: "left" | "right", shot?: string) => {
      await page.evaluate(() => {
        document.documentElement.dataset.spineHold = "mid";
      });
      await clickSide(page, side);
      await expect(page.locator("[data-spine-fold]")).toBeVisible();
      await page.waitForTimeout(400);
      if (shot) await page.screenshot({ path: shot });
      const light = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>("[data-spine-fold]")!;
        const px = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < px.length; i += 64) {
          if (px[i + 3] === 0) continue;
          sum += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
          n++;
        }
        return Math.round(sum / Math.max(1, n));
      });
      await page.evaluate(() => {
        delete document.documentElement.dataset.spineHold;
      });
      await expect(page.locator("[data-spine-fold]")).toHaveCount(0, { timeout: 10_000 });
      return light;
    };

    await mkdir("screenshots", { recursive: true });
    const byFilter = await midFold("right", "screenshots/reader-spine-mid-dim-desktop.png");
    await expect.poll(() => pdfLeaves(page), { timeout: 10_000 }).toEqual([3, 4]);
    await page.evaluate(() => {
      document.documentElement.dataset.spineNoFilter = "1";
    });
    const byHand = await midFold("left");
    await expect.poll(() => pdfLeaves(page), { timeout: 10_000 }).toEqual([1, 2]);
    await page.evaluate(() => {
      delete document.documentElement.dataset.spineNoFilter;
    });
    await choose("As printed");
    await closeSettings();
    const printed = await midFold("right");
    await expect.poll(() => pdfLeaves(page), { timeout: 10_000 }).toEqual([3, 4]);

    expect(byFilter, "dimmed, through the canvas filter").toBeLessThan(80);
    expect(byHand, "dimmed, by hand").toBeLessThan(80);
    expect(Math.abs(byFilter - byHand), "the two ways agree").toBeLessThan(12);
    expect(printed, "as printed").toBeGreaterThan(180);
  });
});

// M19 P2 (the site review's second finding): a PDF page stayed a white rectangle in a dark reader. In Night, or Auto
// while the device is dark, every page shown is dimmed (its picture inverted, the text layer untouched); Paper, or
// "As printed", shows it as printed. Pages that load later (the next page) are dimmed too.
test("PDF pages are dimmed at night, and can be shown as printed", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await openFacingPdf(page);
  const filters = () =>
    page.evaluate(() => {
      const view = document.querySelector("foliate-view") as unknown as { renderer?: { getContents(): { doc: Document }[] } };
      return (view?.renderer?.getContents() ?? []).flatMap(({ doc }) => {
        const canvas = doc?.querySelector("#canvas");
        return canvas && doc.defaultView ? [doc.defaultView.getComputedStyle(canvas).filter] : [];
      });
    });
  const dimmed = async () => {
    const f = await filters();
    return f.length === 0 ? "no pages" : f.every((x) => x.includes("invert")) ? "dimmed" : f.every((x) => x === "none") ? "as printed" : f.join(" | ");
  };
  const settings = page.getByRole("region", { name: "Reading settings" });
  const choose = async (name: string) => {
    if (!(await settings.isVisible())) await page.getByRole("button", { name: "Reading settings" }).click();
    await settings.getByRole("button", { name, exact: true }).click();
    await expect(settings.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
  };

  await choose("Auto");
  await expect.poll(dimmed).toBe("as printed");
  await choose("Night");
  await expect.poll(dimmed).toBe("dimmed");
  // The switch shows only for a PDF, and turns it off and on.
  await choose("As printed");
  await expect.poll(dimmed).toBe("as printed");
  await choose("Dimmed");
  await expect.poll(dimmed).toBe("dimmed");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await page.keyboard.press("Escape");
  // A page that loads later is dimmed as it loads.
  const at = (await reader(page).getAttribute("data-cfi")) ?? "";
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(reader(page)).not.toHaveAttribute("data-cfi", at);
  await expect.poll(dimmed).toBe("dimmed");
  await mkdir("screenshots", { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/reader-pdf-dim-desktop-dark.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(dimmed).toBe("dimmed");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/reader-pdf-dim-phone-dark.png" });
  await page.setViewportSize({ width: 1280, height: 800 });

  // Paper is never dimmed; Auto follows the device.
  await choose("Paper");
  await expect.poll(dimmed).toBe("as printed");
  await choose("Auto");
  await expect.poll(dimmed).toBe("as printed");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(dimmed).toBe("dimmed");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(dimmed).toBe("as printed");
  // An EPUB has no such switch: its text is recoloured instead.
  await openJekyll(page);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await expect(settings.getByRole("group", { name: "PDF pages at night" })).toHaveCount(0);
});

// M20 Q4: Contents can take you to a place far away without turning page by page, for a keyboard or a screen
// reader too: a page of a PDF, a percentage of an EPUB. A number outside the book cannot be sent.
test("Contents goes to a page of a PDF and a percentage of an EPUB", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  const contents = page.getByRole("navigation", { name: "Contents" });

  await openFacingPdf(page);
  // The book opens where an earlier test left it; the box starts from the page on screen.
  const onPage = async () => Number(/^epubcfi\(\/6\/(\d+)\)/.exec((await reader(page).getAttribute("data-cfi")) ?? "")?.[1]) / 2;
  await expect.poll(onPage).toBeGreaterThanOrEqual(1);
  const start = await onPage();
  const target = start === 3 ? 2 : 3;
  await page.getByRole("button", { name: "Contents" }).click();
  const pageBox = contents.getByLabel("Go to page (1 to 4)");
  await expect(pageBox).toHaveValue(String(start));
  await pageBox.fill("5");
  await expect(contents.getByRole("button", { name: "Go", exact: true })).toBeDisabled();
  await pageBox.fill(String(target));
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await pageBox.press("Enter");
  await expect(contents).toHaveCount(0);
  await expect.poll(onPage).toBe(target);
  // Opened again, it starts from the new page.
  await page.getByRole("button", { name: "Contents" }).click();
  await expect(pageBox).toHaveValue(String(target));
  await pageBox.fill("1");
  await contents.getByRole("button", { name: "Go", exact: true }).click();
  await expect(reader(page)).toHaveAttribute("data-cfi", /^epubcfi\(\/6\/2\)/);

  await openJekyll(page);
  const percentRead = async () => Number(/^(\d+)%/.exec((await page.locator("footer [aria-label$='% read']").textContent()) ?? "")?.[1]);
  await page.getByRole("button", { name: "Contents" }).click();
  const percentBox = contents.getByLabel("Go to a percentage of the book");
  await percentBox.fill("101");
  await expect(contents.getByRole("button", { name: "Go", exact: true })).toBeDisabled();
  await percentBox.fill("60");
  await contents.getByRole("button", { name: "Go", exact: true }).click();
  await expect.poll(percentRead).toBeGreaterThanOrEqual(55);
  expect(await percentRead()).toBeLessThanOrEqual(65);
  await page.getByRole("button", { name: "Contents" }).click();
  await percentBox.fill("0");
  await percentBox.press("Enter");
  await expect.poll(percentRead).toBeLessThanOrEqual(5);
});

// M20 Q5: Find in this book, in Contents: the library's search for this book only, hits in reading order; a hit
// opens its paragraph without leaving the reader.
test("Find in this book lists the places with a phrase and opens one", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openJekyll(page);
  const contents = page.getByRole("navigation", { name: "Contents" });
  await page.getByRole("button", { name: "Contents" }).click();
  const find = contents.getByRole("search");
  await find.getByLabel("Find in this book").fill("zebra crossing");
  await find.getByRole("button", { name: "Find" }).click();
  await expect(contents.getByRole("status")).toHaveText("Nothing found for “zebra crossing”.");

  await find.getByLabel("Find in this book").fill('"born in the year"');
  await find.getByLabel("Find in this book").press("Enter");
  await expect(contents.getByRole("status")).toHaveText("1 place with “born in the year”, in reading order.");
  const hit = contents.getByTestId("find-hits").getByRole("button");
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText("Henry Jekyll’s Full Statement of the Case");
  await expect(hit.locator("mark")).toHaveText(["born", "year"]);
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      await page.screenshot({ path: `screenshots/reader-find-${name}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });

  await hit.click();
  await expect(contents).toHaveCount(0);
  await expect(page.locator("footer").getByText("Henry Jekyll’s Full Statement of the Case")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const view = document.querySelector("foliate-view") as unknown as { lastLocation: { range: Range } | null } | null;
        return view?.lastLocation?.range.toString() ?? "";
      }),
    )
    .toContain("born in the year");
});

// M21 Focus: a reading ruler and paragraph focus for EPUBs, and the Keyboard shortcuts dialog.

type FocusLine = { left: number; right: number; y: number };

/** The book's paragraphs on screen, each with its lines (their ends and middle height), in the page's coordinates. */
async function paragraphsOnScreen(page: Page): Promise<{ text: string; lines: FocusLine[] }[]> {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as HTMLElement & { renderer: { getContents(): { doc: Document }[] } };
    const out: { text: string; lines: { left: number; right: number; y: number }[] }[] = [];
    for (const { doc } of view.renderer.getContents()) {
      const frameEl = doc.defaultView?.frameElement as HTMLElement | null;
      const frame = frameEl?.getBoundingClientRect();
      // What is on screen: foliate's page container (the frame's grandparent), which hides the pages either side.
      const seen = frameEl?.parentElement?.parentElement?.getBoundingClientRect();
      if (!frame || !seen) continue;
      for (const p of Array.from(doc.querySelectorAll("p"))) {
        const range = doc.createRange();
        range.selectNodeContents(p);
        const lines: { left: number; right: number; y: number }[] = [];
        for (const b of Array.from(range.getClientRects())) {
          if (b.width < 1 || b.height < 1) continue;
          const line = { left: frame.left + b.left, right: frame.left + b.right, y: frame.top + (b.top + b.bottom) / 2 };
          if (line.left < seen.left || line.right > seen.right || line.y < seen.top || line.y > seen.bottom) continue;
          const same = lines.find((l) => Math.abs(l.y - line.y) < 4);
          if (same) {
            same.left = Math.min(same.left, line.left);
            same.right = Math.max(same.right, line.right);
          } else lines.push(line);
        }
        if (lines.length) out.push({ text: (p.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 50), lines });
      }
    }
    return out;
  });
}

/**
 * What Focus shows on the book's page: its mode, the ruler's band (page coordinates; null when hidden), and whether
 * the text at each point is dimmed (inside the page's "nl-dim" highlight).
 */
async function focusShown(page: Page, points: { x: number; y: number }[] = []) {
  return page.evaluate((points) => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
    for (const { doc } of view.renderer.getContents()) {
      const win = doc.defaultView as (Window & { CSS: typeof CSS }) | null;
      const frame = (win?.frameElement as HTMLElement | null)?.getBoundingClientRect();
      if (!win || !frame) continue;
      const band = doc.querySelector<HTMLElement>(":root > [data-nl-ruler]");
      const box = band && win.getComputedStyle(band).display !== "none" ? band.getBoundingClientRect() : null;
      const dim = win.CSS.highlights?.get("nl-dim");
      const ranges = dim ? Array.from(dim as unknown as Iterable<Range>) : [];
      const caret = (x: number, y: number) => {
        const d = doc as Document & {
          caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
          caretRangeFromPoint?: (x: number, y: number) => Range | null;
        };
        const p = d.caretPositionFromPoint?.(x, y);
        if (p) return { node: p.offsetNode, offset: p.offset };
        const r = d.caretRangeFromPoint?.(x, y);
        return r ? { node: r.startContainer, offset: r.startOffset } : null;
      };
      const dimmed = points.map(({ x, y }) => {
        const at = caret(x - frame.left, y - frame.top);
        return !!at && ranges.some((r) => r.isPointInRange(at.node, at.offset));
      });
      return {
        mode: doc.documentElement.getAttribute("data-nl-focus"),
        band: box ? { top: frame.top + box.top, bottom: frame.top + box.bottom, left: frame.left + box.left, right: frame.left + box.right } : null,
        dimmed,
      };
    }
    return null;
  }, points);
}

/** What a pointer at each point would land on in the book's page (points in the reader's coordinates), and whether the band takes the pointer. */
async function underPointer(page: Page, points: { x: number; y: number }[]) {
  return page.evaluate((points) => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
    for (const { doc } of view.renderer.getContents()) {
      const win = doc.defaultView;
      const frame = (win?.frameElement as HTMLElement | null)?.getBoundingClientRect();
      const band = doc.querySelector<HTMLElement>(":root > [data-nl-ruler]");
      if (!win || !frame || !band) continue;
      const at = points.map(({ x, y }) => {
        const el = doc.elementFromPoint(x - frame.left, y - frame.top);
        return { band: !!el?.closest("[data-nl-ruler]"), inText: !!el && el !== doc.body && el !== doc.documentElement && doc.body.contains(el) };
      });
      return { band: win.getComputedStyle(band).pointerEvents, at };
    }
    return null;
  }, points);
}

/** Selects the words between two points of a line, as a mouse drag from the first to the second would; returns them. */
async function selectBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  return page.evaluate(
    ([from, to]) => {
      const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
      for (const { doc } of view.renderer.getContents()) {
        const frame = (doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect();
        if (!frame) continue;
        const d = doc as Document & {
          caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
          caretRangeFromPoint?: (x: number, y: number) => Range | null;
        };
        const caret = (x: number, y: number) => {
          const p = d.caretPositionFromPoint?.(x - frame.left, y - frame.top);
          if (p) return { node: p.offsetNode, offset: p.offset };
          const r = d.caretRangeFromPoint?.(x - frame.left, y - frame.top);
          return r ? { node: r.startContainer, offset: r.startOffset } : null;
        };
        const a = caret(from.x, from.y);
        const b = caret(to.x, to.y);
        if (!a || !b) continue;
        const range = doc.createRange();
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
        const sel = doc.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        return sel.toString();
      }
      return "";
    },
    [from, to] as const,
  );
}

const middle = (l: FocusLine) => ({ x: Math.round((l.left + l.right) / 2), y: Math.round(l.y) });

/** Opens Jekyll at a chapter of plain paragraphs and turns Focus to `mode` in Reading settings. */
async function jekyllWithFocus(page: Page, mode: "Off" | "Ruler" | "Paragraph") {
  await openJekyll(page);
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Contents" }).getByRole("button", { name: "Search for Mr. Hyde" }).click();
  await expect(page.locator("footer").getByText("Search for Mr. Hyde")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Reading settings" }).click();
  const focus = page.getByRole("region", { name: "Reading settings" }).getByRole("group", { name: "Focus" });
  await focus.getByRole("button", { name: mode, exact: true }).click();
  await expect(focus.getByRole("button", { name: mode, exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Reading settings" })).toBeHidden();
}

/** Two paragraphs on screen with at least two full lines each, turning pages until a page has them. */
async function twoParagraphs(page: Page) {
  const usable = async () =>
    (await paragraphsOnScreen(page)).filter((p) => p.lines.length >= 2 && p.lines.slice(0, 2).every((l) => l.right - l.left > 120));
  let found = await usable();
  for (let turn = 0; turn < 6 && found.length < 2; turn++) {
    const at = (await reader(page).getAttribute("data-cfi")) ?? "";
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(reader(page)).not.toHaveAttribute("data-cfi", at);
    await page.waitForTimeout(200);
    found = await usable();
  }
  expect(found.length, "a page with two paragraphs of two lines or more").toBeGreaterThanOrEqual(2);
  return [found[0], found[1]] as const;
}

const near = (band: { top: number; bottom: number } | null | undefined, y: number) => !!band && band.top <= y && band.bottom >= y && band.bottom - band.top < 60;

test("Focus: the reading ruler follows the pointer and dims the rest, without getting in the way of selecting and highlighting", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await jekyllWithFocus(page, "Ruler");
  await expect(page.getByRole("button", { name: /^Notes/ })).toHaveText("Notes");
  const [a, b] = await twoParagraphs(page);

  // The band sits behind the line under the pointer; the line above it and the next paragraph are dimmed, the line is not.
  const here = middle(a.lines[1]);
  await page.mouse.move(here.x, here.y);
  await expect.poll(async () => near((await focusShown(page))?.band, here.y), { message: "band on the second line" }).toBe(true);
  expect((await focusShown(page, [here, middle(a.lines[0]), middle(b.lines[0])]))?.dimmed).toEqual([false, true, true]);
  // It follows the pointer to another paragraph.
  const there = middle(b.lines[1]);
  await page.mouse.move(there.x, there.y, { steps: 8 });
  await expect.poll(async () => near((await focusShown(page))?.band, there.y), { message: "band moved with the pointer" }).toBe(true);
  expect((await focusShown(page, [there, here]))?.dimmed).toEqual([false, true]);

  // Selecting and highlighting still work with the ruler on: nothing it adds takes the pointer. A mouse drag cannot
  // show it on CI (in Linux Chromium a drag in an EPUB page selects nothing, with Focus off too: 2026-10-11), so
  // the points a drag along the line would cross are hit-tested with the band on that line, then the same words are
  // selected as the drag would select them.
  const line = b.lines[0];
  await page.mouse.move(line.left + 4, line.y);
  await expect.poll(async () => near((await focusShown(page))?.band, line.y), { message: "band on the line to select" }).toBe(true);
  const hits = await underPointer(page, [line.left + 4, line.left + 80, line.left + 160, line.right + 8].map((x) => ({ x, y: line.y })));
  expect(hits?.band, "the band takes no clicks").toBe("none");
  expect(hits?.at.map((h) => h.band), "no point on the line hits the band").toEqual([false, false, false, false]);
  expect(hits?.at.slice(0, 3).map((h) => h.inText), "the words under the pointer are the book's").toEqual([true, true, true]);
  expect(await selectBetween(page, { x: line.left + 4, y: line.y }, { x: line.left + 160, y: line.y })).not.toBe("");
  const bar = page.getByRole("toolbar", { name: "Selected text" });
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Highlight in Amber" }).click();
  await expect(page.getByRole("button", { name: /^Notes/ })).toHaveText("Notes (1)");
  // Put the book back as the later tests expect it: no notes.
  await page.getByRole("button", { name: /^Notes/ }).click();
  await page.getByTestId("notes").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("button", { name: /^Notes/ })).toHaveText("Notes");
  await page.keyboard.press("Escape");

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      const [p] = await twoParagraphs(page);
      const to = middle(p.lines[1]);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.mouse.move(to.x, to.y);
      await expect.poll(async () => near((await focusShown(page))?.band, to.y), { message: `band in ${name} ${scheme}` }).toBe(true);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/reader-focus-ruler-${name}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
});

test("Focus: paragraph focus dims every paragraph but the one under the pointer, or the first on the page from the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await jekyllWithFocus(page, "Paragraph");
  const [a, b] = await twoParagraphs(page);
  const inA = [middle(a.lines[0]), middle(a.lines[1])];
  const inB = [middle(b.lines[0]), middle(b.lines[1])];

  await page.mouse.move(inA[1].x, inA[1].y);
  await expect.poll(async () => (await focusShown(page, [...inA, ...inB]))?.dimmed, { message: "A clear, B dimmed" }).toEqual([false, false, true, true]);
  expect((await focusShown(page))?.band).toBeNull();
  await page.mouse.move(inB[0].x, inB[0].y, { steps: 8 });
  await expect.poll(async () => (await focusShown(page, [...inA, ...inB]))?.dimmed, { message: "B clear, A dimmed" }).toEqual([true, true, false, false]);

  // From the keyboard (the mouse off the book): a new page puts the first paragraph on it in focus.
  await page.mouse.move(640, 20);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const at = (await reader(page).getAttribute("data-cfi")) ?? "";
  await page.keyboard.press("ArrowRight");
  await expect(reader(page)).not.toHaveAttribute("data-cfi", at);
  await expect
    .poll(async () => {
      const shown = await paragraphsOnScreen(page);
      const first = shown[0];
      const later = shown.find((p, i) => i > 0 && p.lines.length > 0);
      if (!first || !later) return "too few paragraphs";
      return (await focusShown(page, [middle(first.lines[0]), middle(later.lines[0])]))?.dimmed;
    }, { message: "first paragraph clear, a later one dimmed" })
    .toEqual([false, true]);

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      const [, p] = await twoParagraphs(page);
      const to = middle(p.lines[0]);
      await page.mouse.move(to.x, to.y);
      await expect.poll(async () => (await focusShown(page, [to]))?.dimmed, { message: `paragraph in ${name} ${scheme}` }).toEqual([false]);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/reader-focus-paragraph-${name}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
});

test("Focus is not offered for a PDF; the Keyboard shortcuts dialog opens with ? or its link, and Escape brings the keyboard back", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  const settings = page.getByRole("region", { name: "Reading settings" });
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });

  // A PDF page is a picture: no Focus. The shortcuts link is there for every book.
  await openFacingPdf(page);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await expect(settings.getByRole("group", { name: "Theme" })).toBeVisible();
  await expect(settings.getByRole("group", { name: "Focus" })).toHaveCount(0);
  const link = settings.getByRole("button", { name: "Keyboard shortcuts" });
  await link.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  // Every key the reader answers to, and nothing else.
  await expect(dialog.locator("dd")).toHaveText([
    "Next page",
    "Previous page",
    "Close the open panel, or this list",
    "Show this list",
    "In Study, move between Need to know and Test yourself",
  ]);
  await expect(dialog.locator("dt").first()).toHaveText("Right arrow or Page Down");
  // The keyboard stays in the dialog, and the page does not turn behind it.
  const at = (await reader(page).getAttribute("data-cfi")) ?? "";
  for (const key of ["Tab", "Shift+Tab", "Tab"]) {
    await page.keyboard.press(key);
    await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  expect(await reader(page).getAttribute("data-cfi")).toBe(at);
  // Escape closes the dialog only: Reading settings stays open, with the keyboard back on the link.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(settings).toBeVisible();
  await expect(link).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // "?" from the reader's bar, in an EPUB.
  await openJekyll(page);
  const settingsButton = page.getByRole("button", { name: "Reading settings" });
  await settingsButton.focus();
  await page.keyboard.press("?");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/reader-shortcuts-${name}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(settingsButton).toBeFocused();

  // "?" inside the book's page works too; Close shuts the dialog.
  const [p] = await twoParagraphs(page);
  await page.mouse.click(middle(p.lines[0]).x, middle(p.lines[0]).y);
  await page.keyboard.press("?");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  // Not while typing: "?" goes into the box.
  await page.getByRole("button", { name: "Contents" }).click();
  const find = page.getByRole("navigation", { name: "Contents" }).getByLabel("Find in this book");
  await find.fill("why");
  await find.press("?");
  await expect(find).toHaveValue("why?");
  await expect(dialog).toBeHidden();

  // Reading settings with Focus and the link, for the PR's screenshots.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Reading settings" }).click();
  await settings.getByRole("group", { name: "Focus" }).getByRole("button", { name: "Ruler", exact: true }).click();
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await settings.getByRole("group", { name: "Focus" }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/reader-focus-settings-${name}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
});
