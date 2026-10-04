import { openDatabase } from "./client";
import { migrateUp } from "./migrate";

/** A fresh in-memory Postgres (PGlite) with all migrations applied. */
export async function testDatabase() {
  const database = await openDatabase({});
  await migrateUp(database.raw);
  return database;
}
