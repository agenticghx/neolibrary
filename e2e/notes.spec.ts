import { expect, test } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M8 "Done when" (part): a voice note on a passage survives a reload. The
// browser uses Chromium's fake microphone (a test tone), and the server the
// fake transcriber (AI_FAKE=1).

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial" });

async function selectPhrase(page: import("@playwright/test").Page, phrase: string) {
  await page.evaluate((phrase) => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
    for (const { doc } of view.renderer.getContents()) {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.nodeValue!.indexOf(phrase);
        if (i < 0) continue;
        const r = doc.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + phrase.length);
        doc.getSelection()!.removeAllRanges();
        doc.getSelection()!.addRange(r);
        return;
      }
    }
    throw new Error(`phrase not on this page: ${phrase}`);
  }, phrase);
}

test("record a voice note on a passage; it is transcribed, kept after a reload, and found by search", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent('"a volume of some dry divinity"')}`);
  await page.getByRole("region", { name: /The Strange Case/ }).getByRole("link").filter({ hasText: "divinity" }).first().click();
  const reader = page.getByTestId("reader");
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const notesButton = page.getByRole("button", { name: /^Notes/ });
  const before = Number(/\((\d+)\)/.exec((await notesButton.textContent()) ?? "")?.[1] ?? 0);

  await selectPhrase(page, "a volume of some dry divinity");
  const bar = page.getByRole("toolbar", { name: "Selected text" });
  await bar.getByRole("button", { name: "Voice note" }).click();
  const rec = bar.getByRole("group", { name: "Voice note" });
  await rec.getByRole("button", { name: "Record" }).click();
  await expect(rec).toContainText(/Recording 0:0[0-9]/);
  await page.waitForTimeout(1500); // record a moment of the fake microphone's tone
  await rec.getByRole("button", { name: "Stop" }).click();
  await expect(rec).toContainText(/Recorded 0:0[1-9]\. Save it/);
  await rec.getByRole("button", { name: "Save voice note" }).click();

  const list = page.getByTestId("notes");
  const item = list.locator("li").filter({ hasText: "Voice note" });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("a volume of some dry divinity");
  await expect(item).toContainText(/Test transcript of a voice note \(\d+ bytes of audio\)\./);
  await expect(notesButton).toHaveText(`Notes (${before + 1})`);
  const src = (await item.locator("audio").getAttribute("src"))!;
  const audio = await page.request.get(src);
  expect(audio.status()).toBe(200);
  expect(audio.headers()["content-type"]).toMatch(/^audio\/(webm|ogg)/);
  expect((await audio.body()).length).toBeGreaterThan(1000);

  await page.reload();
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: /^Notes/ }).click();
  await expect(page.getByTestId("notes").locator("li").filter({ hasText: "Voice note" })).toContainText("Test transcript of a voice note");

  await page.goto(`/search?q=${encodeURIComponent("transcript voice note")}`);
  const found = page.getByRole("region", { name: "Your notes" });
  await expect(found).toContainText("Voice note · The Strange Case of Dr. Jekyll and Mr. Hyde");
  await expect(found).toContainText("transcript of a voice note");
});

test("put a sticker on a passage; it is drawn, listed, and still there after a reload", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent('"a volume of some dry divinity"')}`);
  await page.getByRole("region", { name: /The Strange Case/ }).getByRole("link").filter({ hasText: "divinity" }).first().click();
  const reader = page.getByTestId("reader");
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const notesButton = page.getByRole("button", { name: /^Notes/ });
  const before = Number(/\((\d+)\)/.exec((await notesButton.textContent()) ?? "")?.[1] ?? 0);

  await selectPhrase(page, "he took up a candle");
  const bar = page.getByRole("toolbar", { name: "Selected text" });
  await bar.getByRole("button", { name: "Sticker" }).click();
  const stickers = bar.getByRole("group", { name: "Stickers" });
  await expect(stickers.getByRole("button")).toHaveCount(6); // five stickers and Back
  await stickers.getByRole("button", { name: "Sticker: Question" }).click();
  await expect(notesButton).toHaveText(`Notes (${before + 1})`);
  await expect(bar).toHaveCount(0);
  await page.screenshot({ path: "screenshots/reader-sticker-drawn.png" });

  await page.reload();
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(notesButton).toHaveText(`Notes (${before + 1})`);
  await notesButton.click();
  const item = page.getByTestId("notes").locator("li").filter({ hasText: "Sticker · Question" });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("he took up a candle");

  const id = /\/books\/([0-9a-f-]{36})\/read/.exec(page.url())![1];
  const md = await (await page.request.get(`/api/books/${id}/annotations/export?format=md`)).text();
  expect(md).toContain("Sticker: Question");
});

test("draw a handwritten note on a passage; the strokes are saved and redrawn after a reload", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent('"a volume of some dry divinity"')}`);
  await page.getByRole("region", { name: /The Strange Case/ }).getByRole("link").filter({ hasText: "divinity" }).first().click();
  const reader = page.getByTestId("reader");
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });

  await selectPhrase(page, "went into his business room");
  const bar = page.getByRole("toolbar", { name: "Selected text" });
  await bar.getByRole("button", { name: "Draw" }).click();
  const pad = page.getByTestId("drawing-pad");
  const box = (await pad.boundingBox())!;
  // A scripted stroke (a wave), then a dot.
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width * (0.1 + i * 0.07), box.y + box.height * (0.5 + (i % 2 ? -0.25 : 0.25)));
  await page.mouse.up();
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.8);
  await expect(pad).toHaveAttribute("aria-label", "Drawing pad, 2 strokes");
  await bar.getByRole("button", { name: "Save drawing" }).click();

  const item = page.getByTestId("notes").locator("li").filter({ hasText: "Handwritten note" });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("went into his business room");
  const preview = item.getByTestId("drawing-preview");
  await expect(preview).toHaveAttribute("aria-label", "Handwritten note, 2 strokes");
  const drawn = await preview.locator("path").evaluateAll((ps) => ps.map((p) => p.getAttribute("d")));
  expect(drawn).toHaveLength(2);
  expect(drawn[0]!.split("L").length).toBeGreaterThanOrEqual(10); // the wave keeps its points
  expect(drawn[1]).toMatch(/^M\d+ \d+h0\.01$/); // the dot

  await page.reload();
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "screenshots/reader-drawing-page.png" }); // the marks in the margins, checked by eye
  await page.getByRole("button", { name: /^Notes/ }).click();
  const again = page.getByTestId("notes").locator("li").filter({ hasText: "Handwritten note" }).getByTestId("drawing-preview");
  await expect(again.locator("path")).toHaveCount(2);
  expect(await again.locator("path").evaluateAll((ps) => ps.map((p) => p.getAttribute("d")))).toEqual(drawn);
  await again.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "screenshots/reader-drawing.png" });
});

test("the voice note in the Notes panel is accessible, and looks right on phone and desktop, light and dark", async ({ page }) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  const { mkdir } = await import("node:fs/promises");
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/search?q=${encodeURIComponent('"a volume of some dry divinity"')}`);
      await page.getByRole("region", { name: /The Strange Case/ }).getByRole("link").filter({ hasText: "divinity" }).first().click();
      await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
      await page.getByRole("button", { name: /^Notes/ }).click();
      const item = page.getByTestId("notes").locator("li").filter({ hasText: "Voice note" });
      await item.scrollIntoViewIfNeeded();
      await expect(item).toContainText("Transcript · machine-made");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => `${n.target} ${n.failureSummary}`).join(" | ")}`)).toEqual([]);
      await page.screenshot({ path: `screenshots/reader-voice-note-${name}-${scheme}.png` });
    }
  }
});
