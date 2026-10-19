/** M26 R4a. Kept apart from focus-lock.ts (which reads the database) so the browser's FocusGuard can use it too. */

/**
 * Where a page sends the reader while a session runs: the focused book's reader, unless the page is that reader
 * or Account (where Sign out is). Null means the page opens. Pure, so the rule is unit-tested on its own.
 */
export function focusRedirect(running: { bookId: string } | null, pathname: string): string | null {
  if (!running) return null;
  const home = `/books/${running.bookId}/read`;
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === home || path === "/account" || path.startsWith("/account/")) return null;
  return home;
}
