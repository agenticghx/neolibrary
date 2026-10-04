/**
 * Pages covered by the screenshot and accessibility checks. Add new pages here.
 * `signedIn: false` pages are checked as a logged-out visitor.
 */
export const pages = [
  { name: "sign-in", path: "/sign-in", signedIn: false },
  { name: "invite-closed", path: "/invite/not-a-real-invite", signedIn: false },
  { name: "home", path: "/", signedIn: true },
  { name: "invites", path: "/admin/invites", signedIn: true },
  { name: "design", path: "/design", signedIn: true },
] as const;

export const ADMIN = { name: "Samuel Example", email: "owner@example.com", password: "a long test password" };
export const SETUP_CODE = "e2e-setup-code";
export const ADMIN_STATE = "e2e/.auth/admin.json";
