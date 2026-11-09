/**
 * M43: "Also in <book>". The same person or organisation in the genealogies of the reader's other books, for a line
 * under the name in the Genealogy views. Written for Claude sessions. Measured before it was built (docs/genealogy-
 * plan.md, S4): Chip War, The Grid and The Pay Off share 15 names, so a link, not a cross-book view.
 */
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, genealogyLinks } from "@/lib/db/schema";
import { matchGenealogyName, type GenealogyName } from "./genealogy-names";

/** One other book whose genealogy has the name: what it calls it there, and how much it says. */
export type GenealogyElsewhere = { bookId: string; title: string; name: string; kind: "person" | "organisation"; links: number; tree: boolean };

/**
 * The reader's other books whose genealogy has `name` (by the same rule as the Who & what card: exact spelling,
 * else a person's surname or an organisation's first words), most linked first. Only books they own; removed links
 * do not count.
 */
export async function genealogyElsewhere(db: Db, ownerId: string, bookId: string, name: string, kind: "person" | "organisation"): Promise<GenealogyElsewhere[]> {
  const rows = await db
    .select({ bookId: genealogyLinks.bookId, title: books.title, from: genealogyLinks.fromName, fromKind: genealogyLinks.fromKind, to: genealogyLinks.toName, toKind: genealogyLinks.toKind, relation: genealogyLinks.relation })
    .from(genealogyLinks)
    .innerJoin(books, eq(books.id, genealogyLinks.bookId))
    .where(and(eq(books.ownerId, ownerId), ne(genealogyLinks.bookId, bookId), eq(genealogyLinks.removed, false)));
  const perBook = new Map<string, { title: string; names: Map<string, GenealogyName & { votes: Map<string, number> }> }>();
  for (const r of rows) {
    const b = perBook.get(r.bookId) ?? { title: r.title, names: new Map() };
    perBook.set(r.bookId, b);
    const family = r.fromKind === "organisation" && r.toKind === "organisation" && ["spun_out_of", "acquired", "part_of"].includes(r.relation);
    for (const [n, k] of [
      [r.from, r.fromKind],
      [r.to, r.toKind],
    ] as const) {
      const e = b.names.get(n) ?? { name: n, kind: k, links: 0, tree: false, votes: new Map<string, number>() };
      e.links++;
      e.tree ||= family;
      e.votes.set(k, (e.votes.get(k) ?? 0) + 1);
      b.names.set(n, e);
    }
  }
  const out: GenealogyElsewhere[] = [];
  for (const [id, b] of perBook) {
    // Each name's kind: the one most of its links give it, as the views decide.
    const names = [...b.names.values()].map((e) => ({ ...e, kind: [...e.votes].sort((x, y) => y[1] - x[1])[0][0] as GenealogyName["kind"] }));
    // Either book may have the shorter name ("Robert Noyce" here, "Noyce" there, or the other way round).
    const hit =
      matchGenealogyName({ name, kind, aliases: [name] }, names) ??
      names.filter((n) => matchGenealogyName({ name: n.name, kind: n.kind, aliases: [n.name] }, [{ name, kind, links: 0, tree: false }])).sort((a, b) => b.links - a.links)[0] ??
      null;
    if (hit) out.push({ bookId: id, title: b.title, name: hit.name, kind: hit.kind, links: hit.links, tree: hit.tree });
  }
  return out.sort((a, b) => b.links - a.links);
}
