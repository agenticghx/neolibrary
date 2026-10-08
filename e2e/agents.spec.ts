import { mkdir } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";
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
