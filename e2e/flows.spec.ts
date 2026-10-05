import { expect, test, type Browser } from "@playwright/test";
import { ADMIN, ADMIN_STATE } from "./pages";

// M2 "Done when": a logged-out visitor gets nothing (pages, API, file URLs),
// and an invited user can log in.

const PROTECTED_PAGES = ["/", "/design", "/admin/invites", "/some/future/page"];
const PROTECTED_API = ["/api/me", "/api/files/books/x.epub", "/api/files/books/x.epub?exp=9999999999&sig=forged"];

async function freshContext(browser: Browser) {
  return browser.newContext({ storageState: { cookies: [], origins: [] } });
}

test.describe("a logged-out visitor gets nothing", () => {
  for (const path of PROTECTED_PAGES) {
    test(`page ${path} sends them to sign-in`, async ({ browser }) => {
      const ctx = await freshContext(browser);
      const page = await ctx.newPage();
      const res = await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in(\?next=.*)?$/);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
      await expect(page.getByText("Hidden Machinery")).toHaveCount(0);
      await ctx.close();
    });
  }

  for (const path of PROTECTED_API) {
    test(`API ${path} answers 401`, async ({ browser }) => {
      const ctx = await freshContext(browser);
      const res = await ctx.request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(401);
      expect(await res.text()).not.toContain("owner@example.com");
      await ctx.close();
    });
  }

  test("a forged session cookie gets nothing either", async ({ browser, baseURL }) => {
    const ctx = await freshContext(browser);
    await ctx.addCookies([{ name: "nl_session", value: "forged", url: baseURL! }]);
    expect((await ctx.request.get("/api/me")).status()).toBe(401);
    expect((await ctx.request.get("/api/files/books/x.epub")).status()).toBe(401);
    const page = await ctx.newPage();
    await page.goto("/admin/invites");
    await expect(page).toHaveURL(/\/sign-in$/);
    await ctx.close();
  });

  test("setup is closed once the owner exists", async ({ browser }) => {
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/sign-in$/);
    await ctx.close();
  });
});

test.describe("signed in", () => {
  test.use({ storageState: ADMIN_STATE });

  test("the API knows who you are, and file links need a valid signature", async ({ request }) => {
    expect(await (await request.get("/api/me")).json()).toMatchObject({ email: ADMIN.email, role: "admin" });
    expect((await request.get("/api/files/books/x.epub")).status()).toBe(403);
    expect((await request.get("/api/files/books/x.epub?exp=9999999999&sig=forged")).status()).toBe(403);
  });

  test("an invited person joins, signs out and signs back in; the link works once", async ({ page, browser }) => {
    await page.goto("/admin/invites");
    await page.getByLabel(/Who is it for/).fill("Ada, reading group");
    await page.getByRole("button", { name: "Make an invitation link" }).click();
    const link = await page.getByTestId("invite-link").inputValue();
    expect(link).toMatch(/\/invite\/[\w-]{20,}$/);
    await expect(page.getByText("Ada, reading group")).toBeVisible();

    const ctx = await freshContext(browser);
    const guest = await ctx.newPage();
    await guest.goto(link);
    await expect(guest.getByRole("heading", { name: "You are invited" })).toBeVisible();
    await guest.getByLabel("Your name").fill("Ada Lovelace");
    await guest.getByLabel("Email address").fill("ada@example.com");
    await guest.getByLabel("Password").fill("analytical engine");
    await guest.getByRole("button", { name: "Join the library" }).click();
    await expect(guest.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expect(guest.getByText("Good to see you, Ada. Your library is empty.")).toBeVisible();

    // A new reader starts with an empty library and can add the starter path.
    const guestSidebar = guest.getByRole("complementary", { name: "Sidebar" });
    await expect(guestSidebar.getByRole("link", { name: /^Hidden Machinery/ })).toHaveCount(0);
    await guest.getByRole("button", { name: "Add this path" }).click();
    await expect(guest).toHaveURL(/\/paths\/hidden-machinery$/);
    await expect(guest.getByRole("heading", { name: "Hidden Machinery", level: 1 })).toBeVisible();
    // The sidebar lists it at once; /paths lists it and no longer offers it.
    await expect(guestSidebar.getByRole("link", { name: /^Hidden Machinery/ })).toHaveAttribute("aria-current", "page");
    await guest.goto("/paths");
    await expect(guest.getByRole("main").getByRole("link", { name: "Hidden Machinery", exact: true })).toBeVisible();
    await expect(guest.getByRole("button", { name: "Add this path" })).toHaveCount(0);
    // A reader who is not an admin is not offered Invite.
    await expect(guestSidebar.getByRole("link", { name: "Invite", exact: true })).toHaveCount(0);
    // New collection works before the first book.
    await guestSidebar.getByRole("link", { name: "New collection", exact: true }).click();
    await expect(guest.getByLabel("Collection name")).toBeVisible();

    // Readers cannot reach admin pages.
    expect((await guest.goto("/admin/invites"))?.status()).toBe(404);

    // Sign out, then back in.
    await guest.goto("/");
    await guest.getByRole("button", { name: "Sign out" }).click();
    await expect(guest).toHaveURL(/\/sign-in$/);
    expect((await ctx.request.get("/api/me")).status()).toBe(401);
    await guest.getByLabel("Email address").fill("ada@example.com");
    await guest.getByLabel("Password").fill("wrong password!!");
    await guest.getByRole("button", { name: "Sign in" }).click();
    await expect(guest.getByRole("alert").filter({ hasText: "That email and password do not match." })).toBeVisible();
    // The email stays filled in after a failed attempt.
    await expect(guest.getByLabel("Email address")).toHaveValue("ada@example.com");
    await guest.getByLabel("Password").fill("analytical engine");
    await guest.getByRole("button", { name: "Sign in" }).click();
    await expect(guest.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();

    // An empty shelf offers three free classics; one click, and they can be read.
    await guest.goto("/library");
    await guest.getByRole("button", { name: "Add three free classics" }).click();
    for (const title of ["Frankenstein", "The Strange Case of Dr. Jekyll and Mr. Hyde", "The Time Machine"]) {
      await expect(guest.getByTestId("shelf").getByRole("link", { name: new RegExp(`^${title}`) })).toBeVisible();
    }
    await expect(guest.getByRole("button", { name: "Add three free classics" })).toHaveCount(0);
    await guest.getByTestId("shelf").getByRole("link", { name: /^Frankenstein/ }).click();
    await guest.getByRole("link", { name: "Read", exact: true }).click();
    await expect(guest.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });

    // The same link cannot be used again.
    const ctx2 = await freshContext(browser);
    const other = await ctx2.newPage();
    await other.goto(link);
    await expect(other.getByRole("heading", { name: "This invitation has closed" })).toBeVisible();

    await page.reload();
    await expect(page.getByText("Joined")).toBeVisible();
    await ctx.close();
    await ctx2.close();
  });

  test("sign-in returns you to the page you asked for", async ({ browser }) => {
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await page.goto("/design");
    await page.getByLabel("Email address").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/design$/);
    await ctx.close();
  });
});

test("health endpoint answers without signing in", async ({ browser }) => {
  const ctx = await freshContext(browser);
  const res = await ctx.request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok", service: "neolibrary" });
  await ctx.close();
});
