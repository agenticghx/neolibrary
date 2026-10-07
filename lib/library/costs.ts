import { and, eq, gte, sql } from "drizzle-orm";
import { capsFromEnv, spending } from "@/lib/ai/generate";
import type { Db } from "@/lib/db/client";
import { audioTracks, books, generations } from "@/lib/db/schema";

/**
 * The running cost counter (M7, ground rule 8): this month's spending per
 * paid service, against its cap, for the owner's admin page. One API key pays
 * for every reader, so the totals cover everyone. The split by book names
 * only the admin's own books (ground rule 6: books are private); other
 * readers' spending is one line.
 */
export const SERVICES = [
  { provider: "anthropic", label: "Claude (text AI)", short: "Claude", caps: "AI" },
  { provider: "elevenlabs", label: "ElevenLabs (voice and transcripts)", short: "ElevenLabs", caps: "VOICE" },
  { provider: "openai", label: "OpenAI (pictures)", short: "OpenAI", caps: "IMAGE" },
] as const;

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export async function costReport(db: Db, adminId: string, now = new Date(), env: Record<string, string | undefined> = process.env) {
  const since = monthStart(now);
  const services = [];
  for (const s of SERVICES) {
    const { month } = await spending(db, s.provider, null, now);
    const count = async (table: typeof generations | typeof audioTracks) =>
      Number(
        (
          await db
            .select({ n: sql<number>`count(*)::int` })
            .from(table)
            .where(and(eq(table.provider, s.provider), eq(table.imported, false), gte(table.createdAt, since)))
        )[0]?.n ?? 0,
      );
    services.push({
      ...s,
      spentUsd: month,
      capUsd: capsFromEnv(env, s.caps).perMonthUsd,
      perBookCapUsd: capsFromEnv(env, s.caps).perBookUsd,
      calls: (await count(generations)) + (await count(audioTracks)),
    });
  }

  // Spending per book and per service (provider), from both stores of paid work
  // (not rows brought back from a library file, as in spending()).
  const byBook = new Map<string, Record<string, number>>();
  const add = (bookId: string | null, provider: string, usd: number) => {
    const k = bookId ?? "";
    const v = byBook.get(k) ?? {};
    v[provider] = (v[provider] ?? 0) + usd;
    byBook.set(k, v);
  };
  const g = await db
    .select({ bookId: generations.bookId, provider: generations.provider, usd: sql<number>`sum(${generations.costUsd})::float8` })
    .from(generations)
    .where(and(eq(generations.imported, false), gte(generations.createdAt, since)))
    .groupBy(generations.bookId, generations.provider);
  for (const r of g) add(r.bookId, r.provider, Number(r.usd));
  const a = await db
    .select({ bookId: audioTracks.bookId, provider: audioTracks.provider, usd: sql<number>`sum(${audioTracks.costUsd})::float8` })
    .from(audioTracks)
    .where(and(eq(audioTracks.imported, false), gte(audioTracks.createdAt, since)))
    .groupBy(audioTracks.bookId, audioTracks.provider);
  for (const r of a) add(r.bookId, r.provider ?? "", Number(r.usd));

  const mine = await db.select({ id: books.id, title: books.title }).from(books).where(eq(books.ownerId, adminId));
  const titles = new Map(mine.map((b) => [b.id, b.title]));
  const total = (v: Record<string, number>) => Object.values(v).reduce((x, y) => x + y, 0);
  const yours: { bookId: string; title: string; byProvider: Record<string, number> }[] = [];
  const others: Record<string, number> = {};
  for (const [bookId, v] of byBook) {
    const title = titles.get(bookId);
    if (title) yours.push({ bookId, title, byProvider: v });
    else for (const [p, usd] of Object.entries(v)) others[p] = (others[p] ?? 0) + usd;
  }
  yours.sort((x, y) => total(y.byProvider) - total(x.byProvider) || x.title.localeCompare(y.title));
  return { services, books: yours, others };
}
