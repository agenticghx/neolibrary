import { readFile } from "node:fs/promises";
import { openDatabase } from "./client";
import { migrateUp } from "./migrate";

let snapshot: Promise<Blob> | undefined;

/**
 * A fresh in-memory Postgres (PGlite) with all migrations applied.
 *
 * Under Vitest the migrations are applied once for the whole run
 * (lib/db/test-db-snapshot.ts) and each call here starts from a copy of that
 * database. `migrateUp` still runs: on a copy it finds nothing to do, and
 * without a snapshot (a script calling this outside Vitest) it does the work.
 */
export async function testDatabase() {
  const file = process.env.NEOLIBRARY_TEST_DB_SNAPSHOT;
  if (file) snapshot ??= readFile(file).then((bytes) => new Blob([bytes]));
  const database = await openDatabase({}, snapshot ? { loadDataDir: await snapshot } : {});
  await migrateUp(database.raw);
  return database;
}
