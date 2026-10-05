/**
 * Which navigation link is the current page (aria-current="page").
 * - "exact": the same path; on /library also the same filter (`show`, where
 *   no `show` means "all") and the same collection (`c`); on any path, the
 *   same `new` (the New path and New collection links). Sidebar links.
 * - "section": the path or anything under it (/paths covers /paths/x). Phone
 *   tabs. Home ("/") is only ever exact.
 */
export function isCurrent(href: string, pathname: string, params: URLSearchParams, match: "exact" | "section" = "exact"): boolean {
  const url = new URL(href, "http://local");
  if (match === "section" && url.pathname !== "/") return pathname === url.pathname || pathname.startsWith(`${url.pathname}/`);
  if (pathname !== url.pathname) return false;
  const same = (key: string) => (url.searchParams.get(key) ?? "") === (params.get(key) ?? "");
  if (!same("new")) return false;
  if (url.pathname !== "/library") return true;
  const show = (p: URLSearchParams) => (p.get("show") ?? "all") || "all";
  return show(url.searchParams) === show(params) && same("c");
}
