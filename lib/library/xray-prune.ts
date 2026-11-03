import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { appSettings, xrayEntries, xrayFacts } from "@/lib/db/schema";
import { findMentions, findNames, paragraphsOf, saveMentions } from "./xray";

/** The app_settings row that says the pass below has run. */
export const XRAY_NAMES = "xray-junk-names";

/** The id findNames gives an entry: from its ways of writing, in its order. One edited since no longer matches. */
const ownId = (aliases: string[]) => `x-${createHash("sha1").update(aliases.join("|")).digest("hex").slice(0, 12)}`;

/**
 * M41: takes out of a book's stored index the names its text finder no longer finds ("Eq", "III", "Inc", a formula's
 * "Econ", a reference list's journals), then finds the mentions of what is left again. A book's index is not rebuilt:
 * entries added by AI reading, and every entry that has facts (paid for) or was changed since it was found, are kept
 * exactly as they are. Only an entry the finder made itself and nothing else uses goes. Returns how many went.
 */
export async function pruneXrayNames(db: Db, bookId: string): Promise<number> {
  const stored = await db
    .select({ id: xrayEntries.id, name: xrayEntries.name, kind: xrayEntries.kind, aliases: xrayEntries.aliases })
    .from(xrayEntries)
    .where(and(eq(xrayEntries.bookId, bookId), isNull(xrayEntries.generationId)));
  if (!stored.length) return 0;
  const paragraphs = await paragraphsOf(db, bookId);
  const names = findNames(paragraphs);
  const found = new Set(names.map((e) => e.id));
  const withFacts = new Set((await db.selectDistinct({ id: xrayFacts.entryId }).from(xrayFacts).where(eq(xrayFacts.bookId, bookId))).map((f) => f.id));
  const gone = stored.filter((e) => e.kind === "name" && e.id === ownId(e.aliases) && !withFacts.has(e.id) && !found.has(e.id)).map((e) => e.id);
  if (!gone.length) return 0;
  for (let i = 0; i < gone.length; i += 500) {
    await db.delete(xrayEntries).where(and(eq(xrayEntries.bookId, bookId), inArray(xrayEntries.id, gone.slice(i, i + 500))));
  }
  const left = await db.select({ id: xrayEntries.id, name: xrayEntries.name, kind: xrayEntries.kind, aliases: xrayEntries.aliases }).from(xrayEntries).where(eq(xrayEntries.bookId, bookId));
  // A name found now in a new shape ("Steel", once "Method of Steel"), with two mentions of its own as buildXray asks,
  // joins the index, unless a way of writing it is already another entry's.
  const taken = new Set(left.flatMap((e) => [e.name, ...e.aliases].map((a) => a.toLowerCase())));
  const fresh = names.filter((e) => !e.aliases.some((a) => taken.has(a.toLowerCase())) && !taken.has(e.name.toLowerCase()));
  const counts = new Map<string, number>();
  for (const m of findMentions([...left, ...fresh], paragraphs)) counts.set(m.entryId, (counts.get(m.entryId) ?? 0) + 1);
  const added = fresh.filter((e) => (counts.get(e.id) ?? 0) >= 2);
  if (added.length) await db.insert(xrayEntries).values(added.map((e) => ({ bookId, id: e.id, name: e.name, kind: e.kind, aliases: e.aliases })));
  // Mentions are derived from the entries and the text (an imported library leaves them out too): found again.
  await saveMentions(db, bookId, findMentions([...left, ...added], paragraphs));
  return gone.length;
}

/** Once, at start-up: every book's index. Null when it ran before. A book that fails is skipped, the rest go on. */
export async function backfillXrayNames(db: Db): Promise<{ books: number; removed: number } | null> {
  const [done] = await db.select({ name: appSettings.name }).from(appSettings).where(eq(appSettings.name, XRAY_NAMES));
  if (done) return null;
  const list = await db.selectDistinct({ bookId: xrayEntries.bookId }).from(xrayEntries);
  let touched = 0;
  let removed = 0;
  for (const { bookId } of list) {
    try {
      const n = await pruneXrayNames(db, bookId);
      if (n) touched += 1;
      removed += n;
    } catch (e) {
      console.error("X-ray names: skipped a book", bookId, e);
    }
  }
  await db.insert(appSettings).values({ name: XRAY_NAMES, value: { books: String(touched), removed: String(removed), at: new Date().toISOString() } }).onConflictDoNothing();
  return { books: touched, removed };
}
