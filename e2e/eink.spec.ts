import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M42 S1 "Done when" (docs/eink-reading-plan.md): with Aa > E-ink on, nothing in the reader moves, blurs or casts a
// shadow; the paper is white and the ink black (white on black at night); Scroll cannot be chosen; a highlight is an
// underline in ink whose line tells its colour; the ruler is a bar in the margin. A reader of its own (invited here),
// so its highlight is not counted by the other projects.

test.use({ storageState: ADMIN_STATE });

const PASSWORD = "black ink on white paper";

/** The owner invites a new reader, who joins; returns the reader's page (signed in, on Home). */
async function newReader(page: Page, browser: Browser) {
  await page.goto("/admin/invites");
  await page.getByLabel(/Who is it for/).fill("Ezi, e-ink");
  await page.getByRole("button", { name: "Make an invitation link" }).click();
  const link = await page.getByTestId("invite-link").inputValue();
  // Its own address (the app reads x-forwarded-for), as own-keys.spec.ts: joining counts against the sign-in limit of
  // 10 per address in 15 minutes (app/(public)/actions.ts). CI run 42503607489: with this reader on the shared
  // address, focus.spec's join got "Too many attempts".
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { "x-forwarded-for": "198.51.100.42" },
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("neolibrary:reader-sidebar", "open");
    } catch {
      // A page that keeps nothing starts with the sidebar closed.
    }
  });
  const reader = await ctx.newPage();
  await reader.goto(link);
  await reader.getByLabel("Your name").fill("Ezi Eink");
  await reader.getByLabel("Email address").fill(`eink-${crypto.randomUUID()}@example.com`);
  await reader.getByLabel("Password").fill(PASSWORD);
  await reader.getByRole("button", { name: "Join the library" }).click();
  await expect(reader.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  return reader;
}

type Overlay = { doc: Document; overlayer?: { element: SVGElement } };
type View = HTMLElement & { renderer: { getContents(): Overlay[] }; goToFraction(f: number): Promise<void> };

/** Selects the first words of the first long paragraph in the chapter shown, as a reader dragging over them would. */
async function selectWords(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as View;
    for (const { doc } of view.renderer.getContents()) {
      const p = [...doc.querySelectorAll("p")].find((x) => (x.textContent ?? "").length > 80);
      const text = p && [...p.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && (n.nodeValue ?? "").length > 30);
      if (!text) continue;
      const r = doc.createRange();
      r.setStart(text, 0);
      r.setEnd(text, 20);
      const sel = doc.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
      return r.toString();
    }
    throw new Error("no paragraph to select");
  });
}

/** What the reader draws that an e-ink screen does badly: motion, blur and shadows, counted over every element in it. */
async function moving(page: Page) {
  return page.evaluate(() => {
    const nonzero = (v: string) => v.split(",").some((d) => parseFloat(d) > 0);
    const out = { transitions: [] as string[], animations: [] as string[], shadows: [] as string[], blurs: [] as string[] };
    const name = (el: Element) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
    // The reader element and everything in it. The command palette, mounted beside the reader, is the whole site's: S2.
    const root = document.querySelector("[data-testid=reader]")!;
    for (const el of [root, ...root.querySelectorAll("*")]) {
      const cs = getComputedStyle(el);
      if (nonzero(cs.transitionDuration)) out.transitions.push(name(el));
      if (cs.animationName !== "none" && nonzero(cs.animationDuration)) out.animations.push(name(el));
      if (cs.boxShadow !== "none") out.shadows.push(name(el));
      const blur = cs.backdropFilter;
      if (blur && blur !== "none" && blur !== "blur(0px)") out.blurs.push(name(el));
    }
    return out;
  });
}

/** The highlight marks drawn over the book's pages: tints (foliate's own), and E-ink's underlines by their line. */
async function marks(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as View;
    let tints = 0;
    const lines: string[] = [];
    for (const { overlayer } of view.renderer.getContents()) {
      for (const g of overlayer?.element.querySelectorAll(":scope > g:not([data-xray])") ?? []) {
        const line = g.getAttribute("data-eink-line");
        if (line) lines.push(line);
        else tints++;
      }
    }
    return { tints, lines };
  });
}

/** The body colours of the book's page shown, as the page's own CSS computes them. */
async function pageColours(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as View;
    const doc = view.renderer.getContents()[0].doc;
    const cs = doc.defaultView!.getComputedStyle(doc.body);
    return [cs.backgroundColor, cs.color];
  });
}

test("E-ink: black on white, nothing moves, blurs or casts a shadow, Pages only, highlights as lines, the ruler as a bar", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const reader = await newReader(page, browser);
  const upload = await reader.request.post("/api/books", {
    multipart: {
      files: { name: "wells-the-time-machine.epub", mimeType: "application/epub+zip", buffer: readFileSync("fixtures/books/wells-the-time-machine.epub") },
    },
  });
  const bookId = (await upload.json()).results[0].bookId as string;
  await reader.goto(`/books/${bookId}/read`);
  const view = reader.getByTestId("reader");
  const ready = async () => expect(view).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await ready();
  await reader.evaluate(() => (document.querySelector("foliate-view") as unknown as View).goToFraction(0.08));

  // A highlight in Rose, drawn as a tint while E-ink is off.
  const words = await selectWords(reader);
  const bar = reader.getByRole("toolbar", { name: "Selected text" });
  await expect(bar).toContainText(words.trim().slice(0, 10));
  await bar.getByRole("button", { name: "Highlight in Rose" }).click();
  await expect.poll(async () => (await marks(reader)).tints).toBeGreaterThan(0);
  expect((await marks(reader)).lines).toEqual([]);

  // Before: the reader has things that move (so the count below measures something).
  await view.getByRole("button", { name: "Reading settings" }).click();
  expect((await moving(reader)).transitions.length).toBeGreaterThan(0);

  // E-ink on.
  await reader.getByLabel(/^E-ink/).check();
  await expect(view).toHaveClass(/theme-eink(?!-)/);
  await expect(view).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect.poll(() => pageColours(reader)).toEqual(["rgb(255, 255, 255)", "rgb(0, 0, 0)"]);
  expect(await moving(reader)).toEqual({ transitions: [], animations: [], shadows: [], blurs: [] });
  await expect.poll(() => marks(reader)).toEqual({ tints: 0, lines: ["dotted"] });
  const aa = reader.getByRole("region", { name: "Reading settings" });
  await expect(aa.getByRole("button", { name: "Scroll", exact: true })).toBeDisabled();
  await expect(reader.getByTestId("eink-scroll-note")).toBeVisible();

  // The ruler: a bar in ink at the left of the lines, no tint and no shadow.
  await aa.getByRole("button", { name: "Ruler", exact: true }).click();
  await view.getByRole("button", { name: "Reading settings" }).click();
  const box = (await reader.locator("foliate-view").boundingBox())!;
  await reader.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const ruler = reader.getByTestId("ruler");
  await expect(ruler).toHaveAttribute("data-shown", "");
  await expect(ruler).toHaveCSS("border-left-width", "3px");
  await expect(ruler).toHaveCSS("border-left-color", "rgb(0, 0, 0)");
  await expect(ruler).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(ruler).toHaveCSS("box-shadow", "none");
  await view.getByRole("button", { name: "Reading settings" }).click();
  await aa.getByRole("button", { name: "Off", exact: true }).click();
  await view.getByRole("button", { name: "Reading settings" }).click();

  // Kept on this device: a reload opens in E-ink, in Pages.
  await reader.reload();
  await ready();
  await expect(view).toHaveClass(/theme-eink(?!-)/);
  expect(await reader.evaluate(() => JSON.parse(localStorage.getItem("neolibrary.reader.v1") || "{}"))).toMatchObject({ eink: true, flow: "paginated" });

  // At night (Auto on a dark device): white on black.
  await reader.emulateMedia({ colorScheme: "dark" });
  await reader.reload();
  await ready();
  await expect(view).toHaveClass(/theme-eink-night/);
  await expect(view).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect.poll(() => pageColours(reader)).toEqual(["rgb(0, 0, 0)", "rgb(255, 255, 255)"]);

  // The four looks: accessible, no sideways scroll on a phone, a screenshot for the pull request.
  await mkdir("screenshots", { recursive: true });
  for (const [size, width, height] of [
    ["desktop", 1280, 800],
    ["phone", 390, 844],
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await reader.setViewportSize({ width, height });
      await reader.emulateMedia({ colorScheme: scheme });
      await reader.reload();
      await ready();
      await reader.mouse.move(0, 0);
      await reader.evaluate(() => document.fonts.ready);
      const results = await new AxeBuilder({ page: reader }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${size} ${scheme} ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      expect(await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await reader.screenshot({ path: `screenshots/eink-reader-${size}-${scheme}.png` });
      await view.getByRole("button", { name: "Reading settings" }).click();
      await reader.screenshot({ path: `screenshots/eink-settings-${size}-${scheme}.png` });
      await view.getByRole("button", { name: "Reading settings" }).click();
    }
  }
  await reader.context().close();
});
