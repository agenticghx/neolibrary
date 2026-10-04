import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Database access. In production DATABASE_URL points at Railway's Postgres.
 * Without it (tests, local development) the app uses PGlite: real Postgres
 * compiled to run inside Node, stored in PGLITE_DIR or kept in memory.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Plain SQL access, used by the migration runner. */
export type RawSql = {
  exec(sql: string): Promise<void>;
  /** Runs `sql` (one or more statements) inside a single transaction. */
  transaction(sql: string): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
};

export type Database = { db: Db; raw: RawSql; kind: "postgres" | "pglite" };

export async function openDatabase(
  env: Record<string, string | undefined> = process.env,
): Promise<Database> {
  if (env.DATABASE_URL) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const client = postgres(env.DATABASE_URL, { max: 5, onnotice: () => {} });
    return {
      kind: "postgres",
      db: drizzle(client, { schema }) as unknown as Db,
      raw: {
        exec: async (sql) => void (await client.unsafe(sql)),
        // postgres.js refuses a raw BEGIN on a pooled client (UNSAFE_TRANSACTION),
        // so transactions go through sql.begin, which holds one connection.
        transaction: async (sql) => void (await client.begin((tx) => tx.unsafe(sql))),
        query: async (sql, params = []) => (await client.unsafe(sql, params as never[])) as never,
        close: () => client.end(),
      },
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  if (env.PGLITE_DIR) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(env.PGLITE_DIR, { recursive: true });
  }
  const client = env.PGLITE_DIR ? new PGlite(env.PGLITE_DIR) : new PGlite();
  await client.waitReady;
  return {
    kind: "pglite",
    db: drizzle(client, { schema }) as unknown as Db,
    raw: {
      exec: async (sql) => void (await client.exec(sql)),
      transaction: async (sql) => void (await client.transaction((tx) => tx.exec(sql))),
      query: async (sql, params = []) => (await client.query(sql, params)).rows as never,
      close: () => client.close(),
    },
  };
}
