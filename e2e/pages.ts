/**
 * Pages covered by the screenshot and accessibility checks. Add new pages here.
 * `signedIn: false` pages are checked as a logged-out visitor.
 */
export type PageCase = { name: string; path: string; signedIn: boolean; click?: string };

/** `click`: after opening `path`, follow the link with this accessible name. */
export const pages: PageCase[] = [
  { name: "sign-in", path: "/sign-in", signedIn: false },
  { name: "invite-closed", path: "/invite/not-a-real-invite", signedIn: false },
  { name: "path", path: "/", signedIn: true },
  { name: "book-not-available", path: "/", signedIn: true, click: "The Grid (not available yet)" },
  { name: "shelf-empty", path: "/shelf", signedIn: true },
  { name: "data", path: "/data", signedIn: true },
  { name: "agents", path: "/agents", signedIn: true },
  { name: "stats", path: "/stats", signedIn: true },
  { name: "search", path: "/search", signedIn: true },
  { name: "invites", path: "/admin/invites", signedIn: true },
  { name: "costs", path: "/admin/costs", signedIn: true },
  { name: "design", path: "/design", signedIn: true },
];

export const ADMIN = { name: "Samuel Example", email: "owner@example.com", password: "a long test password" };
export const SETUP_CODE = "e2e-setup-code";
export const ADMIN_STATE = "e2e/.auth/admin.json";
/**
 * The most bytes one answer to a byte-range request carries in the browser
 * tests (8 MB in production, lib/http-range.ts): small, so audio plays past
 * the end of several answers in every read-aloud test.
 */
export const TEST_MAX_RANGE = 64 * 1024;
