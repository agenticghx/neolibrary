import { mkdir } from "node:fs/promises";
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
  expect((await client.get("/shelf", { maxRedirects: 0 })).status()).toBe(307);
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
