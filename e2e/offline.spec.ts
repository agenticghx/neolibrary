import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M12 (a): the library is an installable web app, and a book downloaded for
// offline opens with the network off. playwright.config.ts turns on offline
// mode for service workers too (without it this test would prove nothing).

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial" });

const bookId = async (page: Page, title: string) =>
  ((await (await page.request.get("/api/export")).json()).books as { id: string; title: string }[]).find((b) => b.title === title)!.id;

const visibleText = (page: Page) =>
  page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as { lastLocation: { range: Range } | null } | null;
    return view?.lastLocation?.range.toString().trim() ?? "";
  });

test("the manifest, icons and service worker load without signing in", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const req = context.request;
  const manifest = await req.get("/manifest.webmanifest", { maxRedirects: 0 });
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()["content-type"]).toContain("application/manifest+json");
  const m = await manifest.json();
  expect(m).toMatchObject({ name: "Neolibrary", display: "standalone", start_url: "/" });
  for (const icon of m.icons.filter((i: { type: string }) => i.type === "image/png")) {
    const res = await req.get(icon.src, { maxRedirects: 0 });
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  }
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  const sw = await req.get("/sw.js", { maxRedirects: 0 });
  expect(sw.status()).toBe(200);
  expect(sw.headers()["cache-control"]).toContain("no-cache");
  expect(await sw.text()).toContain("neolibrary-offline-books-v1");
  await context.close();
});

test("download a book for offline; with the network off it still opens", async ({ page, context }) => {
  const frankenstein = await bookId(page, "Frankenstein");
  const timeMachine = await bookId(page, "The Time Machine");
  await page.goto(`/books/${frankenstein}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 10_000 }).toBe(true);
  const online = await visibleText(page);
  expect(online.length).toBeGreaterThan(50);

  await page.getByRole("button", { name: "Reading settings" }).click();
  const offline = page.getByTestId("offline");
  await offline.getByRole("button", { name: "Download for offline" }).click();
  await expect(offline.getByRole("status")).toHaveText("Available offline on this device. Signing out removes it.");
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await offline.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      await page.screenshot({ path: `screenshots/reader-offline-${name}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  // Network off: offline mode, and every request (the page's and the service
  // worker's) refused, so nothing can come from the server.
  await context.setOffline(true);
  const refused: string[] = [];
  await context.route("**/*", (route) => {
    refused.push(new URL(route.request().url()).pathname);
    return route.abort("internetdisconnected");
  });
  // Proof the network is really gone, for the page and the service worker alike.
  expect(await page.evaluate(() => fetch("/api/health", { cache: "no-store" }).then(() => "reached", () => "failed"))).toBe("failed");
  // And for the service worker: a file it would fetch for itself fails too.
  expect(await page.evaluate(() => fetch("/_next/static/not-there.js", { cache: "no-store" }).then(() => "reached", () => "failed"))).toBe("failed");
  // A full page load (not an in-app link) of the downloaded book works, served from the device (0 bytes over the network).
  await page.goto(`/books/${frankenstein}/read`);
  expect(await page.evaluate(() => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).transferSize)).toBe(0);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect.poll(() => visibleText(page)).not.toBe("");
  await expect(page.getByRole("button", { name: /^Notes/ })).toBeVisible();
  // A book that was not downloaded does not open: the browser shows its "no internet" page.
  await page.goto(`/books/${timeMachine}/read`).catch(() => {});
  await expect(page.getByTestId("reader")).toHaveCount(0);
  // The service worker asks the network first: for the downloaded book, the page, the book file and the
  // notes were each tried and refused, yet the book opened, so all three came from the device.
  expect(refused).toEqual(expect.arrayContaining([`/books/${frankenstein}/read`, `/api/books/${frankenstein}/annotations`]));
  expect(refused.some((p) => p.startsWith("/api/files/books/") && p.endsWith(`${frankenstein}.epub`))).toBe(true);
  expect(refused).toContain(`/books/${timeMachine}/read`);
  await context.unrouteAll();
  await context.setOffline(false);

  // Remove the download: gone from the device.
  await page.goto(`/books/${frankenstein}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByTestId("offline").getByRole("button", { name: "Remove download" }).click();
  await expect(page.getByTestId("offline").getByRole("button", { name: "Download for offline" })).toBeVisible();
  expect(await page.evaluate(async () => Boolean(await (await caches.open("neolibrary-offline-books-v1")).match(location.href)))).toBe(false);
});

test("the sign-in page removes downloaded books from the device", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.evaluate(async () => {
    await (await caches.open("neolibrary-offline-books-v1")).put("/books/x/read", new Response("kept?"));
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => caches.has("neolibrary-offline-books-v1"))).toBe(false);
  await context.close();
});

/** Selects the start of a paragraph on the page the reader is showing; returns the selected text. */
async function selectOnPage(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as { lastLocation: { range: Range }; renderer: { getContents(): { doc: Document }[] } };
    const shown = view.lastLocation.range;
    for (const { doc } of view.renderer.getContents()) {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.nodeValue ?? "";
        if (text.trim().length < 60 || !shown.intersectsNode(n)) continue;
        const start = text.search(/\S/);
        const end = text.indexOf(" ", start + 25);
        const r = doc.createRange();
        r.setStart(n, start);
        r.setEnd(n, end);
        doc.getSelection()!.removeAllRanges();
        doc.getSelection()!.addRange(r);
        return text.slice(start, end);
      }
    }
    throw new Error("no paragraph on this page");
  });
}

// M12 "Done when": with the network off, a downloaded book opens and a new
// highlight is saved, then appears on the server when the network returns.
test("a highlight made offline is kept on the device and reaches the server when the network returns", async ({ page, context, playwright }) => {
  const frankenstein = await bookId(page, "Frankenstein");
  const server = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL, storageState: ADMIN_STATE });
  const onServer = async () =>
    ((await (await server.get(`/api/books/${frankenstein}/annotations`)).json()).annotations as { id: string; quote: { exact: string } }[]);

  await page.goto(`/books/${frankenstein}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 10_000 }).toBe(true);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByTestId("offline").getByRole("button", { name: "Download for offline" }).click();
  await expect(page.getByTestId("offline").getByRole("status")).toBeVisible();
  const before = (await onServer()).length;

  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
  await page.goto(`/books/${frankenstein}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect.poll(() => visibleText(page)).not.toBe("");
  const notesButton = page.getByRole("button", { name: /^Notes/ });
  const count = Number(/\((\d+)\)/.exec((await notesButton.textContent()) ?? "")?.[1] ?? 0);

  const phrase = await selectOnPage(page);
  const bar = page.getByRole("toolbar", { name: "Selected text" });
  await bar.getByRole("button", { name: "Highlight in Sky" }).click();
  await expect(notesButton).toHaveText(`Notes (${count + 1})`);
  await notesButton.click();
  const item = page.getByTestId("notes").getByRole("listitem").filter({ hasText: phrase });
  await expect(item.getByTestId("note-pending")).toHaveText("On this device · syncs when you are back online");
  await page.screenshot({ path: "screenshots/reader-offline-note.png" });

  // Still offline, after a reload: still there, and the server does not have it yet.
  await page.goto(`/books/${frankenstein}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(notesButton).toHaveText(`Notes (${count + 1})`);
  expect((await onServer()).some((a) => a.quote.exact === phrase)).toBe(false);

  // Network back: it is sent by itself, once.
  await context.unrouteAll();
  await context.setOffline(false);
  await expect.poll(async () => (await onServer()).filter((a) => a.quote.exact === phrase).length, { timeout: 15_000 }).toBe(1);
  expect((await onServer()).length).toBe(before + 1);
  await notesButton.click();
  await expect(page.getByTestId("notes").getByRole("listitem").filter({ hasText: phrase }).getByTestId("note-pending")).toHaveCount(0);
  // Opening the book again sends nothing twice.
  await page.reload();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(notesButton).toHaveText(`Notes (${count + 1})`);
  expect((await onServer()).filter((a) => a.quote.exact === phrase).length).toBe(1);
  await server.dispose();
});
