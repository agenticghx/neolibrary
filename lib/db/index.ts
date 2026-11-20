import { openDatabase, type Database } from "./client";
import { migrateUp } from "./migrate";

// One database connection per server process (kept on globalThis so
// development hot-reloads do not open new ones).
const g = globalThis as unknown as { __neolibraryDb?: Promise<Database> };

function getDatabase(): Promise<Database> {
  g.__neolibraryDb ??= (async () => {
    const database = await openDatabase();
    try {
      await migrateUp(database.raw);
      return database;
    } catch (e) {
      await database.raw.close().catch(() => {});
      throw e;
    }
  })().catch((e) => {
    g.__neolibraryDb = undefined;
    throw e;
  });
  return g.__neolibraryDb;
}

export async function getDb() {
  return (await getDatabase()).db;
}
