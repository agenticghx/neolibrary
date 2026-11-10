import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// The reading tools (Notes, Study, Rewritten view, Bookmark, Focus session) live in the reader's sidebar
// (app/(reader)/books/[id]/read/sidebar.ts, Samuel 2026-11-01); these tests start with it open.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("neolibrary:reader-sidebar", "open");
    } catch {
      // A page that keeps nothing starts with the sidebar closed.
    }
  });
});

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

// A deploy gives the reader page new script files. The downloaded copy of the page is refreshed on the next online
// visit, so the files it now names must be kept too, or the book stops opening offline. Modelled here by taking one
// kept script away after the download (as if the page now named a file the device never saved).
test("after a deploy, one online visit keeps the page's new files and the book still opens offline", async ({ page, context }) => {
  const frankenstein = await bookId(page, "Frankenstein");
  const ready = () => expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.goto(`/books/${frankenstein}/read`);
  await ready();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 10_000 }).toBe(true);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByTestId("offline").getByRole("button", { name: "Download for offline" }).click();
  await expect(page.getByTestId("offline").getByRole("status")).toBeVisible();

  // Every script the page uses is taken out of the kept files: the device now holds none of the "new build".
  const kept = () =>
    page.evaluate(async () => (await (await caches.open("neolibrary-offline-assets-v1")).keys()).map((r) => r.url).filter((u) => u.endsWith(".js")));
  const scripts = await kept();
  expect(scripts.length).toBeGreaterThan(3);
  await page.evaluate(async (urls) => {
    const cache = await caches.open("neolibrary-offline-assets-v1");
    await Promise.all(urls.map((u) => cache.delete(u)));
  }, scripts);
  expect(await kept()).toEqual([]);

  // One visit with the network on: the files the page loads are kept again.
  await page.goto(`/books/${frankenstein}/read`);
  await ready();
  await expect.poll(async () => (await kept()).length, { timeout: 15_000 }).toBeGreaterThan(3);

  // Network off: the book opens from the device.
  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
  await page.goto(`/books/${frankenstein}/read`);
  await ready();
  await expect.poll(() => visibleText(page)).not.toBe("");
  await context.unrouteAll();
  await context.setOffline(false);

  // Removing the last download empties the kept app files too, and they are not kept again while nothing is downloaded.
  await page.goto(`/books/${frankenstein}/read`);
  await ready();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByTestId("offline").getByRole("button", { name: "Remove download" }).click();
  await expect(page.getByTestId("offline").getByRole("button", { name: "Download for offline" })).toBeVisible();
  expect(await page.evaluate(() => caches.has("neolibrary-offline-assets-v1"))).toBe(false);
  await page.goto(`/books/${frankenstein}/read`);
  await ready();
  expect(await page.evaluate(() => caches.has("neolibrary-offline-assets-v1"))).toBe(false);
});

// A session that ended (expired, or switched off by the owner) does not pass the sign-in page: the library sends a
// signed-out visit to the open shelf. Downloads leave the device there too.
test("the open shelf, seen signed out, removes downloaded books from the device", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/manifest.webmanifest");
  await page.evaluate(async () => {
    await (await caches.open("neolibrary-offline-books-v1")).put("/books/x/read", new Response("kept?"));
  });
  await page.goto("/browse");
  await expect.poll(() => page.evaluate(() => caches.has("neolibrary-offline-books-v1"))).toBe(false);
  await ctx.close();
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

// Edits and removals made offline wait on the device too, and are applied once when the network returns.
test("a note edited and a note removed offline are changed on the server when the network returns", async ({ page, context, playwright }) => {
  const frankenstein = await bookId(page, "Frankenstein");
  const server = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL, storageState: ADMIN_STATE });
  type Row = { id: string; body: string };
  const onServer = async () => ((await (await server.get(`/api/books/${frankenstein}/annotations`)).json()).annotations as Row[]);
  const keep = (await (await server.post(`/api/books/${frankenstein}/annotations`, { data: { kind: "note", body: "Polar voyage as ambition." } })).json()) as Row;
  const drop = (await (await server.post(`/api/books/${frankenstein}/annotations`, { data: { kind: "note", body: "Delete this one later." } })).json()) as Row;

  await page.goto(`/books/${frankenstein}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 10_000 }).toBe(true);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByTestId("offline").getByRole("button", { name: "Download for offline" }).click();
  await expect(page.getByTestId("offline").getByRole("status")).toBeVisible();

  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
  await page.goto(`/books/${frankenstein}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: /^Notes/ }).click();
  const notes = page.getByTestId("notes");
  const kept = notes.getByRole("listitem").filter({ hasText: "Polar voyage as ambition." });
  await kept.getByRole("button", { name: "Edit note" }).click();
  await kept.getByLabel("Edit note").fill("Polar voyage as ambition, edited on the train.");
  // (Its text is now in the edit box, so the item is no longer found by it: use the one Save button.)
  await notes.getByRole("button", { name: "Save" }).click();
  const edited = notes.getByRole("listitem").filter({ hasText: "edited on the train" });
  await expect(edited.getByTestId("note-pending")).toBeVisible();
  await notes.getByRole("listitem").filter({ hasText: "Delete this one later." }).getByRole("button", { name: "Remove" }).click();
  await expect(notes.getByRole("listitem").filter({ hasText: "Delete this one later." })).toHaveCount(0);

  // Still offline after a reload: both changes stay, and the server has neither yet.
  await page.goto(`/books/${frankenstein}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: /^Notes/ }).click();
  await expect(notes.getByRole("listitem").filter({ hasText: "edited on the train" })).toBeVisible();
  await expect(notes.getByRole("listitem").filter({ hasText: "Delete this one later." })).toHaveCount(0);
  expect((await onServer()).find((a) => a.id === keep.id)?.body).toBe("Polar voyage as ambition.");
  expect((await onServer()).some((a) => a.id === drop.id)).toBe(true);

  // Network back: both changes reach the server, each exactly once.
  await context.unrouteAll();
  await context.setOffline(false);
  await expect.poll(async () => (await onServer()).find((a) => a.id === keep.id)?.body, { timeout: 15_000 }).toBe("Polar voyage as ambition, edited on the train.");
  await expect.poll(async () => (await onServer()).some((a) => a.id === drop.id), { timeout: 15_000 }).toBe(false);
  await page.reload();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const versions = async (id: string) => ((await (await server.get(`/api/annotations/${id}`)).json()).versions as unknown[]).length;
  expect(await versions(keep.id)).toBe(2);
  expect(await versions(drop.id)).toBe(2);
  await server.dispose();
});

// M19 P3a: Undo works offline too. A removal still waiting in the outbox is simply taken back; a removal the server
// already has is brought back by a restore that waits in the outbox, shows at once, and is sent once.
test("a note removed and brought back while offline is still there when the network returns", async ({ page, context, playwright }) => {
  const frankenstein = await bookId(page, "Frankenstein");
  const server = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL, storageState: ADMIN_STATE });
  type Row = { id: string; body: string };
  const onServer = async () => ((await (await server.get(`/api/books/${frankenstein}/annotations`)).json()).annotations as Row[]);
  const versions = async (id: string) => ((await (await server.get(`/api/annotations/${id}`)).json()).versions as unknown[]).length;
  const early = (await (await server.post(`/api/books/${frankenstein}/annotations`, { data: { kind: "note", body: "Removed and undone on the train." } })).json()) as Row;
  const late = (await (await server.post(`/api/books/${frankenstein}/annotations`, { data: { kind: "note", body: "Removed at home, undone on the train." } })).json()) as Row;

  await page.goto(`/books/${frankenstein}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 10_000 }).toBe(true);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByTestId("offline").getByRole("button", { name: "Download for offline" }).click();
  await expect(page.getByTestId("offline").getByRole("status")).toBeVisible();
  // Removed while online: the server has the removal.
  await page.getByRole("button", { name: /^Notes/ }).click();
  const notes = page.getByTestId("notes");
  await notes.getByRole("listitem").filter({ hasText: late.body }).getByRole("button", { name: "Remove" }).click();
  await expect.poll(async () => (await onServer()).some((a) => a.id === late.id)).toBe(false);

  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
  const status = page.getByRole("navigation", { name: "Notes" }).getByRole("status");
  // Undo of a removal the server already has: a restore waits in the outbox, and the note shows at once.
  await status.getByRole("button", { name: "Undo" }).click();
  await expect(notes.getByRole("listitem").filter({ hasText: late.body })).toHaveCount(1);
  // Undo of a removal made offline: the waiting removal is taken back.
  await notes.getByRole("listitem").filter({ hasText: early.body }).getByRole("button", { name: "Remove" }).click();
  await expect(notes.getByRole("listitem").filter({ hasText: early.body })).toHaveCount(0);
  await status.getByRole("button", { name: "Undo" }).click();
  await expect(notes.getByRole("listitem").filter({ hasText: early.body })).toHaveCount(1);

  // Network back: both are on the server; the early note was never removed there, the late one was brought back once.
  await context.unrouteAll();
  await context.setOffline(false);
  await expect.poll(async () => (await onServer()).some((a) => a.id === late.id), { timeout: 15_000 }).toBe(true);
  await page.reload();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  expect((await onServer()).some((a) => a.id === early.id)).toBe(true);
  expect(await versions(early.id)).toBe(1);
  expect(await versions(late.id)).toBe(3);
  await server.dispose();
});

// M20 Q2: a note made without a connection that the library then refuses (as it does for a book removed from the
// library meanwhile) is no longer dropped without a word: it stays on the device under "Could not be saved", with the
// library's reason and the words the reader wrote, is not sent again, and leaves only when dismissed.
test("a note the library refuses when the connection returns is kept under Could not be saved", async ({ page, context, playwright }) => {
  const frankenstein = await bookId(page, "Frankenstein");
  const server = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL, storageState: ADMIN_STATE });
  const onServer = async () => ((await (await server.get(`/api/books/${frankenstein}/annotations`)).json()).annotations as { body: string }[]);
  const words = "Written on the train; the library will not take it.";
  const open = async () => {
    await page.goto(`/books/${frankenstein}/read`);
    await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
    await page.getByRole("button", { name: /^Notes/ }).click();
  };
  const panel = page.getByRole("navigation", { name: "Notes" });
  const notSaved = panel.getByTestId("not-saved");

  // No connection when the note is added: it waits on the device.
  await open();
  await context.route("**/api/books/*/annotations", (route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
  );
  await panel.getByLabel("A note about this book").fill(words);
  await panel.locator("form").filter({ has: page.getByLabel("A note about this book") }).getByRole("button", { name: "Add note" }).click();
  await expect(panel.getByTestId("notes").getByRole("listitem").filter({ hasText: words }).getByTestId("note-pending")).toBeVisible();

  // The connection is back, and the library refuses the note.
  await context.unrouteAll();
  let sent = 0;
  await context.route("**/api/books/*/annotations", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent += 1;
    return route.fulfill({ status: 400, json: { error: "Book not found." } });
  });
  await open();
  const item = notSaved.getByRole("listitem");
  await expect(item).toHaveCount(1);
  await expect(notSaved).toContainText("Could not be saved");
  await expect(item).toContainText("A new note");
  await expect(item).toContainText(words);
  await expect(item).toContainText("The library said: Book not found.");
  // Not shown as a note waiting to sync, since it never will.
  await expect(page.getByTestId("notes").getByRole("listitem").filter({ hasText: words })).toHaveCount(0);
  expect(sent).toBe(1);
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await notSaved.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      await page.screenshot({ path: `screenshots/reader-not-saved-${name}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });

  // Opened again: still listed, and not sent a second time.
  await open();
  await expect(item).toHaveCount(1);
  expect(sent).toBe(1);

  // Dismissed: gone from the device, and the server never had it.
  await item.getByRole("button", { name: "Dismiss: A new note" }).click();
  await expect(notSaved).toHaveCount(0);
  await context.unrouteAll();
  await open();
  await expect(notSaved).toHaveCount(0);
  expect((await onServer()).some((a) => a.body === words)).toBe(false);
  await server.dispose();
});

// Two people can use one browser. A note waiting on the device belongs to the reader who wrote it: another reader's
// session never sends it (the library would refuse it as "not your book" and it would never be sent again), and it
// still waits, untouched, for its owner.
test("a waiting note of another reader is not sent, and stays on the device for them", async ({ page, context }) => {
  const frankenstein = await bookId(page, "Frankenstein");
  const theirs = "0b1f6f0e-3c56-4c1e-9a55-0f6d3c1f7a11";
  const posted: string[] = [];
  await context.route("**/api/books/*/annotations", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posted.push((route.request().postDataJSON() as { id: string }).id);
    return route.continue();
  });
  const outbox = () =>
    page.evaluate(
      () =>
        new Promise<{ id: string; owner?: string; refused?: unknown }[]>((resolve, reject) => {
          const open = indexedDB.open("neolibrary-offline", 1);
          open.onupgradeneeded = () => open.result.createObjectStore("outbox", { keyPath: "id" });
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const all = open.result.transaction("outbox").objectStore("outbox").getAll();
            all.onsuccess = () => (open.result.close(), resolve(all.result));
          };
        }),
    );
  // Another reader used this browser and left a note waiting.
  await page.goto("/help");
  await page.evaluate(
    ({ id, bookId }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("neolibrary-offline", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("outbox", { keyPath: "id" });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const put = open.result
            .transaction("outbox", "readwrite")
            .objectStore("outbox")
            .put({ id, owner: "another-reader", bookId, body: { kind: "note", body: "Another reader's words." }, savedAt: "2026-11-10T09:00:00.000Z" });
          put.onsuccess = () => (open.result.close(), resolve());
        };
      }),
    { id: theirs, bookId: frankenstein },
  );

  // This reader opens the book: the reader page sends what waits, at once.
  const listed = page.waitForResponse((r) => r.url().endsWith(`/api/books/${frankenstein}/annotations`) && r.request().method() === "GET");
  await page.goto(`/books/${frankenstein}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await listed;
  await page.getByRole("button", { name: /^Notes/ }).click();
  const panel = page.getByRole("navigation", { name: "Notes" });
  await expect(panel.getByText("Another reader's words.")).toHaveCount(0);
  await expect(panel.getByTestId("not-saved")).toHaveCount(0);

  // A note of this reader's own, made with no connection, is kept under their account and sent when it returns.
  await context.unrouteAll();
  await context.route("**/api/books/*/annotations", (route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
  );
  const words = `Mine, written offline ${Date.now()}.`;
  await panel.getByLabel("A note about this book").fill(words);
  await panel.locator("form").filter({ has: page.getByLabel("A note about this book") }).getByRole("button", { name: "Add note" }).click();
  const row = panel.getByTestId("notes").getByRole("listitem").filter({ hasText: words });
  await expect(row.getByTestId("note-pending")).toBeVisible();
  const own = (await outbox()).find((i) => i.id !== theirs)!;
  expect(own.owner).toMatch(/^[0-9a-f-]{36}$/);
  await context.unrouteAll();
  await context.route("**/api/books/*/annotations", (route) => {
    if (route.request().method() === "POST") posted.push((route.request().postDataJSON() as { id: string }).id);
    return route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(row.getByTestId("note-pending")).toHaveCount(0);

  // The other reader's note was never sent, and still waits exactly as it was left.
  expect(posted).toContain(own.id);
  expect(posted).not.toContain(theirs);
  expect(await outbox()).toEqual([expect.objectContaining({ id: theirs, owner: "another-reader" })]);
  expect((await outbox())[0].refused).toBeUndefined();
});

// PDF books too: the PDF viewer's files are kept with the first PDF downloaded.
test("a PDF downloaded for offline opens with the network off, pages and all", async ({ page, context }) => {
  const discourse = await bookId(page, "Discourse on the Method");
  await page.goto(`/books/${discourse}/read`);
  const reader = page.getByTestId("reader");
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 10_000 }).toBe(true);
  await page.getByRole("button", { name: "Reading settings" }).click();
  const offline = page.getByTestId("offline");
  await expect(offline).toContainText("The first PDF also keeps the PDF viewer");
  await offline.getByRole("button", { name: "Download for offline" }).click();
  await expect(offline.getByRole("status")).toHaveText("Available offline on this device. Signing out removes it.", { timeout: 30_000 });
  // Every file of the viewer is on the device, not only those page 1 needed.
  const kept = await page.evaluate(async () => {
    const files = (await (await fetch("/pdfjs/files.json")).json()) as string[];
    const cache = await caches.open("neolibrary-offline-assets-v1");
    let n = 0;
    for (const f of files) if (await cache.match(new URL(`/pdfjs/${f}`, location.origin).href)) n += 1;
    return { n, of: files.length };
  });
  expect(kept.n).toBe(kept.of);

  await context.setOffline(true);
  const refused: string[] = [];
  await context.route("**/*", (route) => {
    refused.push(new URL(route.request().url()).pathname);
    return route.abort("internetdisconnected");
  });
  expect(await page.evaluate(() => fetch("/api/health", { cache: "no-store" }).then(() => "reached", () => "failed"))).toBe("failed");
  await page.goto(`/books/${discourse}/read`);
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  // It opens at the saved page; turn to page 3 (not shown in this browser before going offline): it renders too.
  for (let i = 0; i < 3 && !/^epubcfi\(\/6\/6/.test((await reader.getAttribute("data-cfi")) ?? ""); i++) {
    const at = await reader.getAttribute("data-cfi");
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(reader).not.toHaveAttribute("data-cfi", at ?? "");
  }
  await expect(reader).toHaveAttribute("data-cfi", /^epubcfi\(\/6\/6/);
  // The page's text layer (what search and selection use) is there too.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
        return view.renderer.getContents().map((c) => c.doc.body?.textContent ?? "").join(" ");
      }),
    )
    .toContain("vigorous mind");
  // The page, the PDF file and the viewer's worker were asked of the network, refused, and came from the device.
  expect(refused).toContain(`/books/${discourse}/read`);
  expect(refused.some((p) => p.startsWith("/api/files/books/") && p.endsWith(`${discourse}.pdf`))).toBe(true);
  expect(refused).toContain("/pdfjs/pdf.worker.min.mjs");
  await context.unrouteAll();
  await context.setOffline(false);
});

// M20 Q3: the reader page's link to the book file lasts five minutes. "Download for offline" pressed later than
// that used the same link and failed (403). It now asks for a fresh link. Here the page's own link answers 403, as an
// expired one does, and the download still succeeds, through a different link, and the book opens offline.
test("Download for offline works after the page's file link has expired", async ({ page, context }) => {
  const timeMachine = await bookId(page, "The Time Machine");
  const opened = page.waitForRequest((r) => new URL(r.url()).pathname.startsWith("/api/files/books/"));
  await page.goto(`/books/${timeMachine}/read`);
  const original = (await opened).url();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 10_000 }).toBe(true);

  // A link names its expiry in whole seconds, so one signed in the same second as the page's own would be the very
  // same link (CI pressed Download that fast once, run 38163565879). Wait for the next second: then the server's fresh
  // link differs from the page's, as it does after the five minutes this test stands in for.
  const signedAt = Number(new URL(original).searchParams.get("exp")) - 5 * 60;
  await expect.poll(() => Math.floor(Date.now() / 1000), { timeout: 3_000 }).toBeGreaterThan(signedAt);
  await context.route((url) => url.href === original, (route) => route.fulfill({ status: 403, json: { error: "Link expired" } }));
  expect(await page.evaluate((u) => fetch(u, { cache: "no-store" }).then((r) => r.status), original)).toBe(403);
  const fileLinks: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/files/books/")) fileLinks.push(r.url());
  });
  await page.getByRole("button", { name: "Reading settings" }).click();
  const offline = page.getByTestId("offline");
  await offline.getByRole("button", { name: "Download for offline" }).click();
  await expect(offline.getByRole("status")).toHaveText("Available offline on this device. Signing out removes it.");
  await expect(offline.getByRole("alert")).toHaveCount(0);
  expect(fileLinks.length).toBeGreaterThan(0);
  expect(fileLinks.every((u) => u !== original)).toBe(true);

  // With the network off, the book opens from the device.
  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
  await page.goto(`/books/${timeMachine}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect.poll(() => visibleText(page)).not.toBe("");
  await context.unrouteAll();
  await context.setOffline(false);

  // Leave the device as it was: the download removed.
  await page.goto(`/books/${timeMachine}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByTestId("offline").getByRole("button", { name: "Remove download" }).click();
  await expect(page.getByTestId("offline").getByRole("button", { name: "Download for offline" })).toBeVisible();
});
