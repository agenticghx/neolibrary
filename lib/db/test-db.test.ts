import { expect, test } from "vitest";
import { loadMigrations } from "./migrate";
import { testDatabase } from "./test-db";

test("a test database starts from the run's snapshot with every migration applied", async () => {
  // Set by lib/db/test-db-snapshot.ts (Vitest global setup). If this is empty,
  // every test is replaying all the migrations again and the suite is slow.
  expect(process.env.NEOLIBRARY_TEST_DB_SNAPSHOT).toBeTruthy();
  const database = await testDatabase();
  const rows = await database.raw.query<{ id: string }>("SELECT id FROM _migrations ORDER BY id");
  expect(rows.map((r) => r.id)).toEqual((await loadMigrations()).map((m) => m.id));
  await database.raw.close();
});

test("two test databases do not share rows", async () => {
  const a = await testDatabase();
  const b = await testDatabase();
  await a.raw.exec("CREATE TABLE only_in_a (id int)");
  const seen = await b.raw.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'only_in_a'");
  expect(seen).toEqual([]);
  await a.raw.close();
  await b.raw.close();
});
