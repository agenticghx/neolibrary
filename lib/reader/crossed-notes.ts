import type { Annotation } from "@/lib/library/annotations";

/**
 * A book's notes as the server sends them: its own, and in a scan or its text edition the other version's too (Open
 * unknowns row 23 (1), decided 2026-10-26), each listed before the first of the book's notes on a later page, with
 * its place here once its words were found here (`placed`, by note id; Reader's placeCrossed).
 */
export function withCrossed(body: { annotations?: Annotation[]; crossed?: Annotation[]; pages?: Record<string, number> }, placed: Map<string, string>): Annotation[] {
  const own = body.annotations ?? [];
  const crossed = (body.crossed ?? []).map((a) => ({ ...a, cfi: placed.get(a.id) ?? null }));
  if (!crossed.length) return own;
  const pages = body.pages ?? {};
  const list: Annotation[] = [];
  let next = 0;
  for (const a of own) {
    const page = pages[a.id];
    while (page !== undefined && next < crossed.length && crossed[next].crossed!.page < page) list.push(crossed[next++]);
    list.push(a);
  }
  return [...list, ...crossed.slice(next)];
}
