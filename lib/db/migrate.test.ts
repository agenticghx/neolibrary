import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "./client";
import { loadMigrations, migrateDown, migrateUp } from "./migrate";

let database: Database;
afterEach(() => database?.raw.close());

const tables = async () =>
  (
    await database.raw.query<{ t: string }>(
      "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> '_migrations' ORDER BY 1",
    )
  ).map((r) => r.t);

describe("migrations", () => {
  it("every migration has a reverse step", async () => {
    const all = await loadMigrations();
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) expect(m.down.trim(), m.id).not.toBe("");
  });

  it("run up, down to nothing, and up again", async () => {
    database = await openDatabase({});
    const all = await loadMigrations();
    expect(await migrateUp(database.raw)).toEqual(all.map((m) => m.id));
    expect(await tables()).toEqual(expect.arrayContaining(["users", "sessions", "invites", "app_secrets"]));
    expect(await migrateUp(database.raw)).toEqual([]);

    await migrateDown(database.raw, all.length);
    expect(await tables()).toEqual([]);

    expect(await migrateUp(database.raw)).toEqual(all.map((m) => m.id));
  });
});
