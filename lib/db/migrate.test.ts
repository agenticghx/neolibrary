import { afterEach, describe, expect, it } from "vitest";
import { TOKEN_DAYS } from "@/lib/auth/tokens";
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

  it("gives an existing API token an expiry 90 days after it was made, and the reverse step removes it", async () => {
    database = await openDatabase({});
    await migrateUp(database.raw);
    // Back to just before 0022, however many migrations came after it.
    const ids = (await loadMigrations()).map((m) => m.id);
    const from0022 = ids.slice(ids.indexOf("0022_api_token_expiry"));
    await migrateDown(database.raw, from0022.length);
    const [user] = await database.raw.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash, role) VALUES ('a@example.com', 'A', 'x', 'reader') RETURNING id",
    );
    await database.raw.query(
      "INSERT INTO api_tokens (owner_id, name, token_hash, prefix, created_at) VALUES ($1, 'agent', 'hash-one', 'nl_test1', timestamptz '2026-10-04 00:00:00+00')",
      [user.id],
    );
    expect(await migrateUp(database.raw)).toEqual(from0022);
    const [row] = await database.raw.query<{ expires_at: string | Date }>("SELECT expires_at FROM api_tokens");
    const made = new Date("2026-10-04T00:00:00Z");
    expect(new Date(row.expires_at).toISOString()).toBe(new Date(made.getTime() + TOKEN_DAYS * 86_400_000).toISOString());
    await migrateDown(database.raw, from0022.length);
    const cols = await database.raw.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'api_tokens'",
    );
    expect(cols.map((c) => c.column_name)).not.toContain("expires_at");
  });

  it("0023 opens books side by side for everyone, keeps each reader's style, and starts new readers in STE light", async () => {
    database = await openDatabase({});
    await migrateUp(database.raw);
    await migrateDown(database.raw, 1);
    await database.raw.query("INSERT INTO users (email, name, password_hash, role, ai_style) VALUES ('p@example.com', 'P', 'x', 'reader', 'plain')");
    expect(await migrateUp(database.raw)).toEqual(["0023_reading_defaults"]);
    await database.raw.query("INSERT INTO users (email, name, password_hash, role) VALUES ('n@example.com', 'N', 'x', 'reader')");
    const rows = await database.raw.query<{ email: string; ai_style: string; rewritten_view: string }>(
      "SELECT email, ai_style, rewritten_view FROM users ORDER BY email",
    );
    expect(rows).toEqual([
      { email: "n@example.com", ai_style: "ste-light", rewritten_view: "side" },
      { email: "p@example.com", ai_style: "plain", rewritten_view: "side" },
    ]);
    await migrateDown(database.raw, 1);
    const cols = await database.raw.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
    expect(cols.map((c) => c.column_name)).not.toContain("rewritten_view");
    await database.raw.query("INSERT INTO users (email, name, password_hash, role) VALUES ('o@example.com', 'O', 'x', 'reader')");
    expect((await database.raw.query<{ ai_style: string }>("SELECT ai_style FROM users WHERE email = 'o@example.com'"))[0].ai_style).toBe("plain");
  });
});
