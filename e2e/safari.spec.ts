import { expect, test, type Page } from "@playwright/test";
import { expectHighlightKeepsUp } from "./listen";
import { ADMIN_STATE } from "./pages";

// The reader in Safari's engine (WebKit). On 2026-10-04 books never opened in
// Safari: the security policy's frame-ancestors 'none' made WebKit refuse the
// reader's own chapter frames, while Chrome (every other test) was fine.

test.use({ storageState: ADMIN_STATE });

const bookId = async (page: Page, title: string) =>
  ((await (await page.request.get("/api/export")).json()).books as { id: string; title: string }[]).find((b) => b.title === title)!.id;

test("an EPUB opens in Safari, shows its text and turns pages", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|frame-ancestors/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`/books/${await bookId(page, "Frankenstein")}/read`);
  const reader = page.getByTestId("reader");
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const text = () =>
    page.evaluate(() => {
      const view = document.querySelector("foliate-view") as unknown as { lastLocation: { range: Range | null } | null };
      return view.lastLocation?.range?.toString().trim() ?? "";
    });
  await expect.poll(text).not.toBe("");
  const cfi = await reader.getAttribute("data-cfi");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(reader).not.toHaveAttribute("data-cfi", cfi ?? "");
  expect(errors).toEqual([]);
});

test("a PDF opens in Safari", async ({ page }) => {
  await page.goto(`/books/${await bookId(page, "Discourse on the Method")}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
});

// Samuel (2026-10-04, in Safari): the read-aloud highlight did not keep up
// with the voice. Chapter V of Frankenstein, the paragraph he was listening to.
test("in Safari, the read-aloud highlight lands on every word in order, on time", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent('"instruments of life around me"')}`);
  await page.getByRole("region", { name: /Frankenstein/ }).getByRole("link").filter({ hasText: "instruments" }).first().click();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await expect(bar.getByRole("button", { name: "Play" })).toBeEnabled();
  await expectHighlightKeepsUp(page, "It was on a dreary night of November, that I beheld the accomplishment of my toils. With an anxiety that almost amounted to agony,");
});

// M41 R6: a redrawn figure loads in Safari's engine. WebKit sends a picture request from the book's page (a blob:
// frame) without the sign-in cookie, so on 2026-11-07 every redraw was a 401 and a broken picture on an iPad; the
// reader now fetches the redraw from its own page and hands the book's page a blob: address. The paper and its
// redraw come from the uploads test ("a paper's figure can be shown redrawn or as printed").
test("a paper's redrawn figure loads in Safari", async ({ page }) => {
  await page.goto("/library");
  await page.getByTestId("shelf").getByRole("link", { name: /^A Paper With One Figure/ }).click();
  await page.waitForURL(/\/books\/[0-9a-f-]{36}/);
  const id = /\/books\/([0-9a-f-]{36})/.exec(page.url())![1];
  await page.goto(`/books/${id}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
        const img = view.renderer.getContents().map((x) => x.doc).find((d) => d.querySelector("img"))?.querySelector("img");
        return !!img && img.complete && img.naturalWidth > 0 && !!img.dataset.nlRedraw && img.getAttribute("src") === img.dataset.nlRedraw;
      }),
    )
    .toBe(true);
});

// Samuel reads on an iPad (every iPad browser is WebKit). On 2026-11-08 the reading ruler, in WebKit only, landed in
// the middle of a page just turned to, and after Larger text it went off the page, leaving every line dimmed.
test("the reading ruler goes to the first line of a turned page, and stays on the page after Larger text, in Safari", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/books/${await bookId(page, "The Strange Case of Dr. Jekyll and Mr. Hyde")}/read`);
  const reader = page.getByTestId("reader");
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Contents" }).getByRole("button", { name: "Search for Mr. Hyde" }).click();
  await expect(page.locator("footer").getByText("Search for Mr. Hyde")).toBeVisible();
  const settings = page.getByRole("region", { name: "Reading settings" });
  await page.getByRole("button", { name: "Reading settings" }).click();
  await settings.getByRole("group", { name: "Focus" }).getByRole("button", { name: "Ruler", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await page.mouse.move(5, 5); // no mouse on the book: the ruler goes where the page puts it

  /** The ruler's band, the first line of text on screen, and whether the band's line is the clear one. */
  const shown = () =>
    page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-testid="ruler"]');
      const band = el && getComputedStyle(el).display !== "none" ? el.getBoundingClientRect() : null;
      const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
      for (const { doc } of view.renderer.getContents()) {
        const win = doc.defaultView as (Window & { CSS: typeof CSS }) | null;
        const frameEl = win?.frameElement as HTMLElement | null;
        const frame = frameEl?.getBoundingClientRect();
        const seen = frameEl?.parentElement?.parentElement?.getBoundingClientRect();
        if (!win || !frame || !seen) continue;
        let first = Infinity;
        for (const p of Array.from(doc.querySelectorAll("p, h1, h2, h3"))) {
          const range = doc.createRange();
          range.selectNodeContents(p);
          for (const b of Array.from(range.getClientRects())) {
            const x = frame.left + b.left;
            const y = frame.top + (b.top + b.bottom) / 2;
            if (b.width > 1 && x >= seen.left && x + b.width <= seen.right + 1 && y >= seen.top && y <= seen.bottom) first = Math.min(first, y);
          }
        }
        let clear = null as boolean | null;
        if (band) {
          // The middle of the band (a heading is centred), one letter in (a range's ends count as inside it).
          const at = doc.caretRangeFromPoint((band.left + band.right) / 2 - frame.left, (band.top + band.bottom) / 2 - frame.top);
          const dim = win.CSS.highlights.get("nl-dim") as unknown as Iterable<Range> | undefined;
          const offset = at ? Math.min(at.startOffset + 1, at.startContainer.nodeValue?.length ?? 0) : 0;
          clear = !!at && !Array.from(dim ?? []).some((r) => r.isPointInRange(at.startContainer, offset));
        }
        return { band: band && { top: band.top, bottom: band.bottom, left: band.left, right: band.right }, first, seen: { left: seen.left, right: seen.right }, clear };
      }
      return null;
    });
  const onFirstLine = async () => {
    const s = await shown();
    return !!s?.band && s.band.top <= s.first && s.band.bottom >= s.first && s.band.left >= s.seen.left - 1 && s.band.right <= s.seen.right + 1 && s.clear === true;
  };
  await expect.poll(onFirstLine, { message: "the band on the first line when Ruler is chosen" }).toBe(true);
  for (let turn = 1; turn <= 2; turn++) {
    // The page-turn button, as the other Safari tests turn pages (on CI's WebKit an Arrow key here was not taken:
    // run 42477309939); the mouse then leaves the book again.
    const at = (await reader.getAttribute("data-cfi")) ?? "";
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(reader).not.toHaveAttribute("data-cfi", at);
    await page.mouse.move(5, 5);
    await expect.poll(onFirstLine, { message: `the band on the first line after turn ${turn}` }).toBe(true);
  }
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Larger text" }).click();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await page.mouse.move(5, 5);
  await expect.poll(onFirstLine, { message: "the band on a line of the page after Larger text" }).toBe(true);
});
