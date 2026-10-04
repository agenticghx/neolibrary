import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { RawSql } from "./client";

/**
 * Applies db/migrations/NNNN_name.up.sql files in order, each once. Every
 * migration must have a matching .down.sql (the reverse step); a test runs
 * up → down → up on a fresh database.
 */
export const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

type Migration = { id: string; up: string; down: string };

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).sort();
  const ids = files.filter((f) => f.endsWith(".up.sql")).map((f) => f.replace(/\.up\.sql$/, ""));
  return Promise.all(
    ids.map(async (id) => {
      if (!files.includes(`${id}.down.sql`)) throw new Error(`Migration ${id} has no ${id}.down.sql (reverse step)`);
      return {
        id,
        up: await readFile(path.join(dir, `${id}.up.sql`), "utf8"),
        down: await readFile(path.join(dir, `${id}.down.sql`), "utf8"),
      };
    }),
  );
}

async function ensureTable(raw: RawSql) {
  await raw.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
}

async function applied(raw: RawSql): Promise<string[]> {
  return (await raw.query<{ id: string }>("SELECT id FROM _migrations ORDER BY id")).map((r) => r.id);
}

export async function migrateUp(raw: RawSql, dir?: string): Promise<string[]> {
  await ensureTable(raw);
  const done = new Set(await applied(raw));
  const ran: string[] = [];
  for (const m of await loadMigrations(dir)) {
    if (done.has(m.id)) continue;
    await raw.transaction(`${m.up}\nINSERT INTO _migrations (id) VALUES ('${m.id}');`);
    ran.push(m.id);
  }
  return ran;
}

/** Reverses the most recent `steps` migrations. */
export async function migrateDown(raw: RawSql, steps = 1, dir?: string): Promise<string[]> {
  await ensureTable(raw);
  const all = new Map((await loadMigrations(dir)).map((m) => [m.id, m]));
  const done = (await applied(raw)).reverse().slice(0, steps);
  for (const id of done) {
    const m = all.get(id);
    if (!m) throw new Error(`Cannot reverse ${id}: migration file missing`);
    await raw.transaction(`${m.down}\nDELETE FROM _migrations WHERE id = '${id}';`);
  }
  return done;
}
