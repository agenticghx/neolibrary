import { openDatabase, type Database } from "./client";
import { migrateUp } from "./migrate";

// One database connection per server process (kept on globalThis so
// development hot-reloads do not open new ones).
const g = globalThis as unknown as { __neolibraryDb?: Promise<Database> };

export function getDatabase(): Promise<Database> {
  g.__neolibraryDb ??= (async () => {
    const database = await openDatabase();
    await migrateUp(database.raw);
    return database;
  })();
  return g.__neolibraryDb;
}

export async function getDb() {
  return (await getDatabase()).db;
}
