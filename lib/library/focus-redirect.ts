/** M26 R4a. Kept apart from focus-lock.ts (which reads the database) so the browser's FocusGuard can use it too. */

/** What the redirect rule needs to know about the running session. */
export type RunningFocus = {
  bookId: string;
  /** "sitting" (R3/R4: a timer, only the page) or "book" (R5: one book only, for days). Older callers omit it. */
  kind?: string;
  /**
   * M26 R5: every id the focused book goes by: a scanned book and its text edition are two books the reader moves
   * between (M25). Defaults to [bookId].
   */
  bookIds?: string[];
  /** M26 R5: the book's own page, where a whole-book focus sends the pages that list other books. Defaults to bookId. */
  homeId?: string;
};

/** The pages that show other books: during a whole-book focus they go to the focused book's page instead. */
const LISTINGS = ["/library", "/search", "/shelf", "/covers"];

/**
 * Where a page sends the reader while a session runs; null means the page opens. Pure, so the rule is unit-tested
 * on its own.
 * - A sitting (R4a): everything goes to the focused book's reader, except that reader and Account (where Sign out is).
 * - A whole book (R5): Home, Library, Search, Shelf, Covers and any other book go to the focused book's page; its
 *   own pages and reader (either edition), and everything else (Review, Stats, Paths, Import, Account, Help...)
 *   open. A Path still cannot open another book: that book's page sends the reader back.
 */
export function focusRedirect(running: RunningFocus | null, pathname: string): string | null {
  if (!running) return null;
  const path = pathname.replace(/\/+$/, "") || "/";
  if (running.kind === "book") {
    const ids = running.bookIds?.length ? running.bookIds : [running.bookId];
    const home = `/books/${running.homeId ?? running.bookId}`;
    const book = /^\/books\/([^/]+)/.exec(path)?.[1];
    if (book) return ids.includes(book) ? null : home;
    if (path === "/" || LISTINGS.some((p) => path === p || path.startsWith(`${p}/`))) return home;
    return null;
  }
  const home = `/books/${running.bookId}/read`;
  if (path === home || path === "/account" || path.startsWith("/account/")) return null;
  return home;
}
