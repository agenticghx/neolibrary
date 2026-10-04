import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/client";
import { apiTokens, users } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { sha256 } from "./crypto";
import { acceptInvite, createFirstAdmin, createInvite } from "./service";
import { bearerToken, createApiToken, listApiTokens, revokeApiToken, TokenError, userForApiToken } from "./tokens";

let database: Database;
let ownerId: string;
let otherId: string;

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "Owner", password: "long enough pw" })).id;
  const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "Owner", role: "admin" });
  otherId = (await acceptInvite(database.db, token, { email: "r@example.com", name: "Reader", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

describe("personal API tokens (M11)", () => {
  it("a new token is shown once, stored only as a hash, and acts as its owner", async () => {
    const made = await createApiToken(database.db, ownerId, "  Claude   desktop ", new Date("2026-10-04T10:00:00Z"));
    expect(made.token).toMatch(/^nl_[A-Za-z0-9_-]{43}$/);
    const [row] = await database.db.select().from(apiTokens);
    expect(row.tokenHash).toBe(sha256(made.token));
    expect(JSON.stringify(row)).not.toContain(made.token);
    expect(row.prefix).toBe(made.token.slice(0, 8));
    expect(await userForApiToken(database.db, made.token)).toEqual({
      user: { id: ownerId, email: "o@example.com", name: "Owner", role: "admin" },
      tokenName: "Claude desktop",
    });
    expect(await listApiTokens(database.db, ownerId)).toEqual([
      expect.objectContaining({ id: made.id, name: "Claude desktop", prefix: made.token.slice(0, 8), revokedAt: null }),
    ]);
    expect(await listApiTokens(database.db, otherId)).toEqual([]);
    await expect(createApiToken(database.db, ownerId, "   ")).rejects.toThrow(TokenError);
  });

  it("notes when a token was last used, at most once a minute", async () => {
    const { token } = await createApiToken(database.db, ownerId, "agent");
    const t0 = new Date("2026-10-04T10:00:00Z");
    await userForApiToken(database.db, token, t0);
    await userForApiToken(database.db, token, new Date("2026-10-04T10:00:30Z"));
    expect((await listApiTokens(database.db, ownerId))[0].lastUsedAt).toEqual(t0);
    const t2 = new Date("2026-10-04T10:02:00Z");
    await userForApiToken(database.db, token, t2);
    expect((await listApiTokens(database.db, ownerId))[0].lastUsedAt).toEqual(t2);
  });

  it("refuses unknown, malformed and revoked tokens, and tokens of disabled users", async () => {
    const { id, token } = await createApiToken(database.db, ownerId, "agent");
    for (const bad of [null, "", "nl_", "nl_wrong", token.slice(3), token + "x", "x".repeat(500)]) {
      expect(await userForApiToken(database.db, bad)).toBeNull();
    }
    // Someone else cannot revoke it, and an unknown id is "not found".
    await expect(revokeApiToken(database.db, otherId, id)).rejects.toThrow("Token not found");
    await expect(revokeApiToken(database.db, ownerId, "nonsense")).rejects.toThrow("Token not found");
    expect(await userForApiToken(database.db, token)).not.toBeNull();
    await revokeApiToken(database.db, ownerId, id, new Date("2026-10-04T11:00:00Z"));
    await revokeApiToken(database.db, ownerId, id); // twice is fine; the first date stays
    expect(await userForApiToken(database.db, token)).toBeNull();
    expect((await listApiTokens(database.db, ownerId))[0].revokedAt).toEqual(new Date("2026-10-04T11:00:00Z"));

    const second = await createApiToken(database.db, otherId, "reader's agent");
    expect(await userForApiToken(database.db, second.token)).toMatchObject({ user: { id: otherId }, tokenName: "reader's agent" });
    await database.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, otherId));
    expect(await userForApiToken(database.db, second.token)).toBeNull();
  });

  it("reads the token from an Authorization header", () => {
    expect(bearerToken("Bearer nl_abc")).toBe("nl_abc");
    expect(bearerToken("bearer   nl_abc ")).toBe("nl_abc");
    expect(bearerToken("Basic dXNlcg==")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});
