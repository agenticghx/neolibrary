import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { ADMIN, ADMIN_STATE } from "./pages";

// M11 (a): a personal API token made in the UI lets a client with no cookies
// act as its owner on /api/agent/*; revoking it stops that at once.

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial" });

/** A client with no cookies at all, like an agent on another machine. */
async function agentClient(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }, token?: string) {
  return playwright.request.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: token ? { authorization: `Bearer ${token}` } : {},
  });
}

test("agent routes answer 401 (never a sign-in redirect) without a valid token", async ({ playwright }) => {
  for (const token of [undefined, "nl_not-a-real-token"]) {
    const client = await agentClient(playwright, token);
    const res = await client.get("/api/agent/me", { maxRedirects: 0 });
    expect(res.status()).toBe(401);
    expect(res.headers()["www-authenticate"]).toContain("Bearer");
    expect((await res.json()).error).toContain("API token");
    await client.dispose();
  }
  // A Bearer header opens only agent routes, not the rest of the API or pages.
  const client = await agentClient(playwright, "nl_not-a-real-token");
  expect((await client.get("/api/export", { maxRedirects: 0 })).status()).toBe(401);
  expect((await client.get("/library", { maxRedirects: 0 })).status()).toBe(307);
  await client.dispose();
});

test("make a token, use it without cookies, see it used, revoke it", async ({ page, playwright }) => {
  await page.goto("/data");
  await page.getByRole("link", { name: "Agent access" }).click();
  await expect(page.getByRole("heading", { name: "Agent access", level: 1 })).toBeVisible();
  await page.getByLabel("Which agent is it for?").fill("Test agent");
  await page.getByRole("button", { name: "Make a token" }).click();
  const shown = page.getByTestId("new-token");
  await expect(shown).toHaveValue(/^nl_[A-Za-z0-9_-]{43}$/);
  const token = await shown.inputValue();
  const row = page.getByTestId("token-rows").getByRole("listitem").filter({ hasText: "Test agent" });
  await expect(row).toContainText(token.slice(0, 8));
  await expect(row).toContainText("Not used yet");
  await expect(row).toContainText(/expires/i);

  // Shown once: after a reload only the first characters remain.
  await page.reload();
  await expect(page.getByTestId("new-token")).toHaveCount(0);
  expect(await page.content()).not.toContain(token);

  const agent = await agentClient(playwright, token);
  const me = await agent.get("/api/agent/me");
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ name: ADMIN.name, email: ADMIN.email });
  await page.reload();
  await expect(row).toContainText("Last used");

  await row.getByRole("button", { name: "Revoke Test agent" }).click();
  await expect(row).toContainText("Revoked");
  expect((await agent.get("/api/agent/me")).status()).toBe(401);
  await agent.dispose();

  // A second, live token for the screenshots: one revoked row and one in use.
  await page.getByLabel("Which agent is it for?").fill("Claude on my laptop");
  await page.getByRole("button", { name: "Make a token" }).click();
  await expect(page.getByTestId("new-token")).toBeVisible();
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `screenshots/agents-tokens-${name}-${scheme}.png`, fullPage: true });
    }
  }
});

// M11 "Done when": a test agent, using a token, lists books and adds a note
// that shows up in the reader, marked as written by the agent.
test("an agent with a token lists books, searches, adds a note, and the reader shows it", async ({ page, playwright }) => {
  await page.goto("/agents");
  await page.getByLabel("Which agent is it for?").fill("Reading agent");
  await page.getByRole("button", { name: "Make a token" }).click();
  const token = await page.getByTestId("new-token").inputValue();
  const agent = await agentClient(playwright, token);

  const books = (await (await agent.get("/api/agent/books")).json()).books as { id: string; title: string }[];
  const jekyll = books.find((b) => b.title === "The Strange Case of Dr. Jekyll and Mr. Hyde")!;
  expect(books.map((b) => b.title)).toContain("The Time Machine");
  const search = await agent.get(`/api/agent/search?q=${encodeURIComponent('"Next they turned to the business table"')}&limit=3`);
  expect(search.status()).toBe(200);
  const hit = ((await search.json()).results as { bookId: string; sectionId: string; text: string }[]).find((h) => h.bookId === jekyll.id)!;
  expect(hit.text).toMatch(/\*\*/);

  const added = await agent.post(`/api/agent/books/${jekyll.id}/notes`, { data: { text: "Utterson and Poole search the cabinet here.", sectionId: hit.sectionId } });
  expect(added.status()).toBe(201);
  expect((await added.json()).note).toMatchObject({ addedByAgent: "Reading agent", sectionId: hit.sectionId, color: "sky" });
  const notes = (await (await agent.get(`/api/agent/books/${jekyll.id}/notes`)).json()).notes as { note: string; addedByAgent: string | null }[];
  expect(notes).toContainEqual(expect.objectContaining({ note: "Utterson and Poole search the cabinet here.", addedByAgent: "Reading agent" }));
  // Bad input is explained, and another book id is "not found".
  expect((await agent.post(`/api/agent/books/${jekyll.id}/notes`, { data: { text: "" } })).status()).toBe(400);
  expect((await agent.get("/api/agent/books/00000000-0000-4000-8000-000000000000/notes")).status()).toBe(404);
  await agent.dispose();

  // The reader sees it, marked as the agent's, and "Go to" opens its paragraph.
  await page.goto(`/books/${jekyll.id}/read`);
  const reader = page.getByTestId("reader");
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: /^Notes/ }).click();
  const item = page.getByTestId("notes").getByRole("listitem").filter({ hasText: "Utterson and Poole search the cabinet here." });
  await expect(item.getByTestId("note-agent")).toHaveText("Added by agent · Reading agent");
  await expect(item.locator("blockquote")).toContainText("Next they turned to the business table");
  await item.getByRole("button", { name: "Go to" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const view = document.querySelector("foliate-view") as unknown as { lastLocation: { range: Range } | null };
        return view.lastLocation?.range.toString() ?? "";
      }),
    )
    .toContain("Next they turned to the business table");
  if (!(await page.getByTestId("notes").isVisible())) await page.getByRole("button", { name: /^Notes/ }).click();
  await expect(item).toBeVisible();
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await item.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      await page.screenshot({ path: `screenshots/reader-agent-note-${name}-${scheme}.png` });
    }
  }
});

// M11 (c): the same, through the MCP server, as an MCP client (like Claude) would.
test("an MCP client with a token uses the four tools, and its note shows up in the reader", async ({ page }) => {
  const base = test.info().project.use.baseURL!;
  const connect = async (token?: string) => {
    const client = new Client({ name: "e2e-agent", version: "1.0.0" });
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    await client.connect(new StreamableHTTPClientTransport(new URL("/api/agent/mcp", base), { requestInit: { headers } }));
    return client;
  };
  // No token, or a fake one: the server refuses to talk.
  await expect(connect()).rejects.toThrow(/401|token/i);
  await expect(connect("nl_not-a-real-token")).rejects.toThrow(/401|token/i);

  await page.goto("/agents");
  await expect(page.getByTestId("mcp-url")).toHaveValue(new URL("/api/agent/mcp", base).href);
  await page.getByLabel("Which agent is it for?").fill("MCP agent");
  await page.getByRole("button", { name: "Make a token" }).click();
  const client = await connect(await page.getByTestId("new-token").inputValue());
  const text = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    expect(r.isError ?? false).toBe(false);
    return JSON.parse(r.content[0].text);
  };
  expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(["add_note", "get_notes", "list_books", "search_text"]);
  const { books } = await text("list_books", { query: "wells" });
  expect(books.map((b: { title: string }) => b.title)).toEqual(["The Time Machine"]);
  const tm = books[0].id as string;
  const { results } = await text("search_text", { query: '"recondite matter"', limit: 5 });
  const hit = results.find((r: { bookId: string }) => r.bookId === tm);
  const { note } = await text("add_note", { bookId: tm, text: "The Time Traveller begins his explanation here.", sectionId: hit.sectionId });
  expect(note).toMatchObject({ addedByAgent: "MCP agent", sectionId: hit.sectionId });
  expect((await text("get_notes", { bookId: tm })).notes).toContainEqual(expect.objectContaining({ id: note.id, addedByAgent: "MCP agent" }));
  await client.close();

  await page.goto(`/books/${tm}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: /^Notes/ }).click();
  const item = page.getByTestId("notes").getByRole("listitem").filter({ hasText: "The Time Traveller begins his explanation here." });
  await expect(item.getByTestId("note-agent")).toHaveText("Added by agent · MCP agent");
});

// M25 on the owner's Claude subscription (2026-10-17): pages of a scan read on the laptop with `claude -p`
// (scripts/text-edition-on-subscription.ts) are sent with the owner's token; the last part makes the text edition.
test("pages read on the subscription, sent with a token, make the scan's text edition", async ({ page, playwright }) => {
  test.slow();
  await page.goto("/agents");
  await page.getByLabel("Which agent is it for?").fill("Text edition on my laptop");
  await page.getByRole("button", { name: "Make a token" }).click();
  const token = await page.getByTestId("new-token").inputValue();
  // The 2-page scan is already on the shelf when the reader tests have run,
  // and this test adds it when they have not. A second file with the same
  // title is that book, not a new one (lib/library/import.ts). CI run
  // 39033952163 sent a blank page 3 to the 2-page book, and the server
  // dropped it. The file under test has its own title and a blank third page.
  const original = await page.request.post("/api/books", {
    multipart: { files: { name: "scanned-meditation.pdf", mimeType: "application/pdf", buffer: readFileSync("fixtures/books/scanned-meditation.pdf") } },
  });
  expect(["added", "duplicate"]).toContain((await original.json()).results[0].status);
  const doc = await PDFDocument.load(readFileSync("fixtures/books/scanned-meditation.pdf"));
  doc.setTitle("A Subscription Scanned Meditation");
  doc.addPage([612, 792]);
  const upload = await page.request.post("/api/books", {
    multipart: { files: { name: "scanned-meditation-sent.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) } },
  });
  const uploaded = await upload.json();
  expect(uploaded.results[0].status).toBe("added");
  const scanId = uploaded.results[0].bookId as string;

  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const promptHash = sha(readFileSync("prompts/transcribe-page.md", "utf8"));
  const read = (n: number, markdown: string, over: object = {}) => ({ page: n, markdown, model: "claude-sonnet-5-5", promptHash, inputHash: sha(`picture ${n}`), inputTokens: 4321, outputTokens: 600, ...over });
  const page1 = "# MEDITATION I.\n\nSeveral years have now elapsed since I first became aware that I had accepted, even from my youth, many false opinions for true.";
  // Page 2 carries a table wider than the reading column, like The Pay Off's page 51 (9 columns), which spilled over
  // the text beside it (2026-10-17).
  const wide = ["Means", "Anonymous?", "Can be traced?", "Ubiquity of acceptance", "Immediacy of value transfer", "Irreversible?", "Constant value?", "Transaction cost", "Physical convenience"];
  const table = [`| ${wide.join(" | ")} |`, `|${wide.map(() => "---").join("|")}|`, ...["Bank transfer", "Gold", "Diamonds", "Cash"].map((r) => `| ${[r, ...wide.slice(1).map((w) => `${w.split(" ")[0]} value`)].join(" | ")} |`)].join("\n");
  const more = Array.from({ length: 14 }, (_, i) => `Paragraph ${i + 1} after the table: the meditation goes on, for I would build anew from the foundation, if I wished to establish something firm and lasting in the sciences.`).join("\n\n");
  const page2 = `And I was thereby convinced that I must once for all seriously undertake to rid myself of all the opinions I had adopted.\n\n${table}\n\n${more}`;
  const url = `/api/agent/books/${scanId}/text-edition`;

  // Without a token: 401; with the owner's token but other instructions: refused, nothing saved.
  const anonymous = await agentClient(playwright);
  expect((await anonymous.post(url, { data: { pages: [read(1, page1)] } })).status()).toBe(401);
  await anonymous.dispose();
  const agent = await agentClient(playwright, token);
  const other = await agent.post(url, { data: { pages: [read(1, page1, { promptHash: sha("other instructions") })] } });
  expect(other.status()).toBe(400);
  expect((await other.json()).error).toContain("other instructions");

  const first = await agent.post(url, { data: { pages: [read(1, page1)], finish: false } });
  expect(first.status()).toBe(200);
  expect(await first.json()).toMatchObject({ saved: expect.any(Number), editionId: null }); // 1, or 0 on a retry: sent again, nothing new
  const last = await agent.post(url, { data: { pages: [read(2, page2)], blankPages: [3], finish: true } });
  expect(last.status()).toBe(200);
  const made = await last.json();
  expect(made).toMatchObject({ read: 2, blankPages: [3], editionId: expect.any(String) });
  await agent.dispose();

  // The scan now has a text edition, and its address opens it (text by default) at its first page, which says who read it.
  await page.goto(`/books/${scanId}/read`);
  await expect(page).toHaveURL(new RegExp(`/books/${made.editionId}/read`));
  const edition = page.getByRole("group", { name: "Edition" });
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(edition.getByText("Text")).toHaveAttribute("aria-current", "page");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const view = document.querySelector("foliate-view") as unknown as { renderer?: { getContents(): { doc: Document }[] } };
        return (view?.renderer?.getContents() ?? []).map(({ doc }) => doc?.body?.textContent ?? "").join(" ");
      }),
    )
    .toContain("read from the scanned pages of the PDF by claude-sonnet-5-5");

  // No text over text: the wide table stays inside the reading column (it scrolls sideways) and covers no line of
  // the paragraphs around it, on a phone and on a desktop.
  for (const [w, h] of [[390, 844], [1280, 800]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/books/${made.editionId}/read?page=2`);
    await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const view = document.querySelector("foliate-view") as unknown as { renderer?: { getContents(): { doc: Document }[] } };
          const doc = (view?.renderer?.getContents() ?? []).map((c) => c.doc).find((d) => d?.querySelector("table"));
          const t = doc?.querySelector("table")?.getBoundingClientRect();
          if (!doc || !t) return "no table";
          const lines = [...doc.querySelectorAll("p")].flatMap((p) => [...p.getClientRects()]).filter((l) => l.width > 0);
          const column = Math.max(...lines.map((l) => l.width));
          if (t.width > column + 2) return `the table is ${Math.round(t.width)} px wide in a ${Math.round(column)} px column`;
          const over = lines.filter((l) => l.left < t.right - 1 && l.right > t.left + 1 && l.top < t.bottom - 1 && l.bottom > t.top + 1);
          return over.length ? `${over.length} lines of text under the table` : "clear";
        }),
      )
      .toBe("clear");
    await mkdir("screenshots", { recursive: true });
    await page.screenshot({ path: `screenshots/wide-table-${w < 768 ? "phone" : "desktop"}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  // Listen on the scan reads each page as the edition read it (Open unknowns row 24, decided 2026-10-26), not the
  // scan's hidden text: page 1 whole, page 2's table a row to a sentence, and nothing after it (page 3 is blank).
  const listen = async (q: Record<string, string>) =>
    (await (await page.request.get(`/api/books/${scanId}/audio?${new URLSearchParams(q)}`)).json()).passage as { id: string; text: string; nextId: string | null };
  const one = await listen({ cfi: "epubcfi(/6/2)" });
  expect(one.text).toBe(page1.replace("# ", ""));
  const two = await listen({ section: one.nextId! });
  expect(two.text).toContain("Means, Anonymous?, Can be traced?");
  expect(two.text).toContain("Bank transfer, Anonymous? value, Can value");
  expect(two.nextId).toBeNull();
  // In the reader, the voice reads the edition's words on the scan's page.
  await page.goto(`/books/${scanId}/read?view=scan&at=${encodeURIComponent("epubcfi(/6/2)")}`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await bar.getByLabel("Voice").selectOption("fake-ada");
  await bar.getByRole("button", { name: "Play" }).click();
  await page.waitForFunction(
    (words) => words.includes(document.querySelector('[aria-label="Read aloud"]')?.getAttribute("data-word") ?? ""),
    ["Several", "years", "have", "now", "elapsed", "since"],
    { timeout: 30_000 },
  );
  await page.evaluate(() => document.querySelector("audio")!.pause());
});

// Open unknowns row 23 (1), decided 2026-10-26: notes cross between a scan and its text edition. A highlight made on
// the scan is drawn on the same words in the text edition, and one made there is drawn on the scan; each is listed in
// Notes with the version it came from. Uses the scan the test above gave a text edition (its page 1 read faithfully).
test("notes cross between a scan and its text edition: drawn on the same words, listed with where they came from", async ({ page }) => {
  test.slow();
  const books = (await (await page.request.get("/api/export")).json()).books as { id: string; title: string }[];
  const scanId = books.find((b) => b.title === "A Subscription Scanned Meditation")!.id;
  await page.goto(`/books/${scanId}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const editionId = /\/books\/([0-9a-f-]{36})\/read/.exec(page.url())![1];
  expect(editionId).not.toBe(scanId);

  type View = { renderer: { getContents(): { doc: Document; overlayer?: { element: SVGElement } }[] } };
  /** Selects a phrase in the page shown (in a scan, in its text layer), as a reader dragging over it would. */
  const select = (phrase: string) =>
    page.evaluate((phrase) => {
      const view = document.querySelector("foliate-view") as unknown as View;
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
          return true;
        }
      }
      return false;
    }, phrase);
  /** The highlights drawn on the pages shown (foliate's overlay; the X-ray's underlines aside). */
  const drawn = () =>
    page.evaluate(() =>
      (document.querySelector("foliate-view") as unknown as View).renderer
        .getContents()
        .reduce((n, { overlayer }) => n + (overlayer?.element.querySelectorAll(":scope > g:not([data-xray])").length ?? 0), 0),
    );
  const bar = page.getByRole("toolbar", { name: "Selected text" });
  const notes = page.getByTestId("notes");
  /** A book's own notes (what its export holds): their quoted words. */
  const own = async (id: string) => ((await (await page.request.get(`/api/books/${id}/annotations`)).json()).annotations as { quote: { exact: string } }[]).map((a) => a.quote.exact);

  // On the scan's page 1: a highlight on its own (hidden) text. (A scan's pages draw no highlights, their own
  // included: the PDF renderer has no drawing layer; Open unknowns row 31.)
  await page.goto(`/books/${scanId}/read?view=scan&at=${encodeURIComponent("epubcfi(/6/2)")}`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect.poll(() => select("Several years"), { timeout: 15_000 }).toBe(true);
  await bar.getByRole("button", { name: "Highlight in Amber" }).click();
  await expect.poll(() => own(scanId)).toEqual(["Several years"]);

  // In the text edition, at page 1: drawn there too, and listed as from the scan.
  await page.goto(`/books/${editionId}/read?page=1`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect.poll(drawn, { timeout: 15_000 }).toBe(1);
  await page.getByRole("button", { name: /^Notes/ }).click();
  const fromScan = notes.getByRole("listitem").filter({ has: page.getByTestId("note-crossed") });
  await expect(fromScan).toHaveCount(1);
  await expect(fromScan.getByTestId("note-crossed")).toHaveText("From the scan · page 1");
  await expect(fromScan.getByTestId("note-crossed")).toHaveAttribute("data-placed", "yes");
  await expect(fromScan.locator("blockquote")).toHaveText("Several years");
  await page.keyboard.press("Escape");

  // A highlight made in the text edition, on other words of page 1.
  expect(await select("many false opinions")).toBe(true);
  await bar.getByRole("button", { name: "Highlight in Amber" }).click();
  await expect.poll(drawn).toBe(2);
  await page.getByRole("button", { name: /^Notes/ }).click();
  await expect(notes.getByRole("listitem")).toHaveCount(2);
  await mkdir("screenshots", { recursive: true });
  for (const [size, width, height] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300); // the colours ease from one theme to the other
      await expect(fromScan.getByTestId("note-crossed")).toBeVisible();
      await page.screenshot({ path: `screenshots/notes-across-${size}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });

  // Back on the scan: the edition's note listed as from the text edition, and found on the scan's page 1 in its own
  // text (so "Go to" goes to its words).
  await page.goto(`/books/${scanId}/read?view=scan&at=${encodeURIComponent("epubcfi(/6/2)")}`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: /^Notes/ }).click();
  const fromText = notes.getByRole("listitem").filter({ has: page.getByTestId("note-crossed") });
  await expect(fromText.getByTestId("note-crossed")).toHaveText("From the text edition · page 1");
  await expect(fromText.locator("blockquote")).toHaveText("many false opinions");
  await expect(fromText.getByTestId("note-crossed")).toHaveAttribute("data-placed", "yes", { timeout: 15_000 });
  // Each book's own notes stay its own (an export of either gives only the notes made in it).
  expect(await own(scanId)).toEqual(["Several years"]);
  expect(await own(editionId)).toEqual(["many false opinions"]);
});
