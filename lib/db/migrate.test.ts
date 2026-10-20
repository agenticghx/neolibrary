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

  it("0026 lets a cover be the reader's own picture; going back keeps it showing, recorded as the book file's", async () => {
    database = await openDatabase({});
    await migrateUp(database.raw);
    const ids = (await loadMigrations()).map((m) => m.id);
    const from0026 = ids.slice(ids.indexOf("0026_cover_upload"));
    const [user] = await database.raw.query<{ id: string }>("INSERT INTO users (email, name, password_hash, role) VALUES ('u@example.com', 'U', 'x', 'reader') RETURNING id");
    await database.raw.query("INSERT INTO books (owner_id, title, author, cover_key, cover_source) VALUES ($1, 'Mine', 'M', 'covers/x/y-upload-1.png', 'upload')", [user.id]);
    await migrateDown(database.raw, from0026.length);
    expect(await database.raw.query("SELECT cover_key, cover_source FROM books")).toEqual([{ cover_key: "covers/x/y-upload-1.png", cover_source: "file" }]);
    await expect(database.raw.query("UPDATE books SET cover_source = 'upload'")).rejects.toThrow(/books_cover_source_check/);
    expect(await migrateUp(database.raw)).toEqual(from0026);
    await database.raw.query("UPDATE books SET cover_source = 'upload'");
    await expect(database.raw.query("UPDATE books SET cover_source = 'elsewhere'")).rejects.toThrow(/books_cover_source_check/);
  });

  it("0023 opens books side by side for everyone, keeps each reader's style, and starts new readers in STE light", async () => {
    database = await openDatabase({});
    await migrateUp(database.raw);
    // Back to just before 0023, however many migrations came after it (as the 0022 test).
    const ids = (await loadMigrations()).map((m) => m.id);
    const from0023 = ids.slice(ids.indexOf("0023_reading_defaults"));
    await migrateDown(database.raw, from0023.length);
    await database.raw.query("INSERT INTO users (email, name, password_hash, role, ai_style) VALUES ('p@example.com', 'P', 'x', 'reader', 'plain')");
    expect(await migrateUp(database.raw)).toEqual(from0023);
    await database.raw.query("INSERT INTO users (email, name, password_hash, role) VALUES ('n@example.com', 'N', 'x', 'reader')");
    const rows = await database.raw.query<{ email: string; ai_style: string; rewritten_view: string }>(
      "SELECT email, ai_style, rewritten_view FROM users ORDER BY email",
    );
    expect(rows).toEqual([
      { email: "n@example.com", ai_style: "ste-light", rewritten_view: "side" },
      { email: "p@example.com", ai_style: "plain", rewritten_view: "side" },
    ]);
    await migrateDown(database.raw, from0023.length);
    const cols = await database.raw.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
    expect(cols.map((c) => c.column_name)).not.toContain("rewritten_view");
    await database.raw.query("INSERT INTO users (email, name, password_hash, role) VALUES ('o@example.com', 'O', 'x', 'reader')");
    expect((await database.raw.query<{ ai_style: string }>("SELECT ai_style FROM users WHERE email = 'o@example.com'"))[0].ai_style).toBe("plain");
  });

  it("0024 keeps one review schedule per reader and note, refuses an ease below 1.3, and the reverse step removes it", async () => {
    database = await openDatabase({});
    await migrateUp(database.raw);
    const [user] = await database.raw.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash, role) VALUES ('r@example.com', 'R', 'x', 'reader') RETURNING id",
    );
    const card = (ease: string) =>
      database.raw.query(
        // card_id since 0030: a highlight's card is named by its annotation id.
        "INSERT INTO review_cards (owner_id, annotation_id, card_id, ease, due_at, first_reviewed_at, last_reviewed_at, last_rating) SELECT $1, u, u::text, $2::float8, now(), now(), now(), 'good' FROM gen_random_uuid() u",
        [user.id, ease],
      );
    for (const ease of ["1.2", "NaN", "Infinity"]) await expect(card(ease)).rejects.toThrow("review_cards_ease_check");
    await card("1.3");
    expect(await tables()).toContain("review_cards");
    const ids = (await loadMigrations()).map((m) => m.id);
    await migrateDown(database.raw, ids.length - ids.indexOf("0024_review"));
    expect(await tables()).not.toContain("review_cards");
  });

  it("0030 names cards so a question can be one, keeps every schedule made before it, and the reverse step keeps highlights' schedules", async () => {
    database = await openDatabase({});
    await migrateUp(database.raw);
    const ids = (await loadMigrations()).map((m) => m.id);
    const from0030 = ids.slice(ids.indexOf("0030_review_card_ids"));
    await migrateDown(database.raw, from0030.length);
    const [user] = await database.raw.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash, role) VALUES ('q@example.com', 'Q', 'x', 'reader') RETURNING id",
    );
    const note = "11111111-2222-4333-8444-555555555555";
    await database.raw.query(
      "INSERT INTO review_cards (owner_id, annotation_id, ease, interval_days, due_at, first_reviewed_at, last_reviewed_at, last_rating) VALUES ($1, $2, 2.35, 2, '2026-10-13T00:00:00Z', now(), now(), 'hard')",
      [user.id, note],
    );
    expect(await migrateUp(database.raw)).toEqual(from0030);
    expect(await database.raw.query("SELECT card_id, annotation_id, ease, interval_days FROM review_cards")).toEqual([
      { card_id: note, annotation_id: note, ease: 2.35, interval_days: 2 },
    ]);
    const add = (cardId: string, annotationId: string | null) =>
      database.raw.query(
        "INSERT INTO review_cards (owner_id, card_id, annotation_id, due_at, first_reviewed_at, last_reviewed_at, last_rating) VALUES ($1, $2, $3, now(), now(), now(), 'good')",
        [user.id, cardId, annotationId],
      );
    const question = "q:66666666-7777-4888-8999-000000000000:3";
    await add(question, null);
    // A highlight's card must carry its own id; any other card needs a kind letter, a source id and a number.
    for (const [cardId, annotationId] of [
      ["q:66666666-7777-4888-8999-000000000000:4", note],
      ["22222222-3333-4444-8555-666666666666", note],
      ["anything", null],
    ] as const)
      await expect(add(cardId, annotationId)).rejects.toThrow("review_cards_card_id_check");
    await expect(add(question, null)).rejects.toThrow("review_cards_pkey");
    await migrateDown(database.raw, from0030.length);
    expect(await database.raw.query("SELECT annotation_id, ease FROM review_cards")).toEqual([{ annotation_id: note, ease: 2.35 }]);
    const cols = await database.raw.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'review_cards'");
    expect(cols.map((c) => c.column_name)).not.toContain("card_id");
  });

  it("0025 marks every cover stored before it as from its file, refuses an unknown source, and the reverse step removes the columns", async () => {
    database = await openDatabase({});
    await migrateUp(database.raw);
    const ids = (await loadMigrations()).map((m) => m.id);
    const from0025 = ids.slice(ids.indexOf("0025_cover_lookup"));
    await migrateDown(database.raw, from0025.length);
    const [user] = await database.raw.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash, role) VALUES ('c@example.com', 'C', 'x', 'reader') RETURNING id",
    );
    await database.raw.query("INSERT INTO books (owner_id, title, cover_key) VALUES ($1, 'With a cover', 'covers/x/y.jpg'), ($1, 'Waiting', NULL)", [user.id]);
    expect(await migrateUp(database.raw)).toEqual(from0025);
    const rows = await database.raw.query<{ title: string; cover_source: string | null; cover_rejected: unknown }>(
      "SELECT title, cover_source, cover_rejected FROM books ORDER BY title",
    );
    expect(rows).toEqual([
      { title: "Waiting", cover_source: null, cover_rejected: [] },
      { title: "With a cover", cover_source: "file", cover_rejected: [] },
    ]);
    await expect(database.raw.query("UPDATE books SET cover_source = 'amazon'")).rejects.toThrow("books_cover_source_check");
    await migrateDown(database.raw, from0025.length);
    const cols = await database.raw.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'books'");
    expect(cols.map((c) => c.column_name)).not.toEqual(expect.arrayContaining(["cover_source"]));
    expect(cols.map((c) => c.column_name).filter((c) => /^cover_|^isbn$/.test(c))).toEqual(["cover_key"]);
  });
});
