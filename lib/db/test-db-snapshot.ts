import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "./client";
import { migrateUp } from "./migrate";

/**
 * Vitest global setup: runs once before all unit tests. It builds one empty
 * database with every migration applied, saves it as a file, and tells the
 * tests where it is. Each test then starts from a copy of that file
 * (lib/db/test-db.ts) instead of replaying every migration itself, which was
 * most of the unit tests' running time.
 */
export const SNAPSHOT_ENV = "NEOLIBRARY_TEST_DB_SNAPSHOT";

export default async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "neolibrary-test-db-"));
  const file = path.join(dir, "migrated.tar");
  const database = await openDatabase({});
  await migrateUp(database.raw);
  const dump = await database.dump?.();
  await database.raw.close();
  if (!dump) throw new Error("The test database could not be saved as a snapshot");
  await writeFile(file, Buffer.from(await dump.arrayBuffer()));
  process.env[SNAPSHOT_ENV] = file;
  return async () => {
    delete process.env[SNAPSHOT_ENV];
    await rm(dir, { recursive: true, force: true });
  };
}
