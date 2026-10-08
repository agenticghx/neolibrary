import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { apiTokens, users } from "@/lib/db/schema";
import { randomToken, sha256 } from "./crypto";
import type { PublicUser } from "./service";

/**
 * Personal API tokens (M11): a user makes a token for an AI agent, which then
 * acts as that user (sees only what they see) by sending
 * `Authorization: Bearer <token>`. The token is shown once; the database keeps
 * only its sha256 hash and its first characters (to tell tokens apart).
 * Revoking is immediate and permanent. A token also stops working 90 days
 * after it was made; an expired token is treated the same as a revoked one.
 */
export class TokenError extends Error {}

/** Every token starts with this, so a leaked one is easy to recognise (and to search for). */
export const TOKEN_PREFIX = "nl_";
/** How long a new token works, and how long an existing one is given when expiry is added. */
export const TOKEN_DAYS = 90;
const TOKEN_MS = TOKEN_DAYS * 86_400_000;
const SHOWN = 8;
/** Refresh "last used" at most this often, so busy agents do not write on every call. */
const TOUCH_MS = 60 * 1000;

export type TokenView = {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export async function createApiToken(db: Db, ownerId: string, name: string, now = new Date()) {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 100);
  if (!clean) throw new TokenError("Give the token a name, e.g. the agent that will use it.");
  const token = TOKEN_PREFIX + randomToken();
  const [row] = await db
    .insert(apiTokens)
    .values({
      ownerId,
      name: clean,
      tokenHash: sha256(token),
      prefix: token.slice(0, SHOWN),
      createdAt: now,
      expiresAt: new Date(now.getTime() + TOKEN_MS),
    })
    .returning({ id: apiTokens.id });
  return { id: row.id, token };
}

export async function listApiTokens(db: Db, ownerId: string): Promise<TokenView[]> {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      createdAt: apiTokens.createdAt,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.ownerId, ownerId))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id));
}

/** Revokes one of the owner's own tokens; anyone else's (or an unknown id) is "not found". */
export async function revokeApiToken(db: Db, ownerId: string, id: string, now = new Date()) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new TokenError("Token not found");
  const done = await db
    .update(apiTokens)
    .set({ revokedAt: now })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.ownerId, ownerId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  if (done.length === 0) {
    const [mine] = await db.select({ id: apiTokens.id }).from(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.ownerId, ownerId)));
    if (!mine) throw new TokenError("Token not found");
  }
}

/** The user a token acts for and the token's name, or null (unknown, revoked, expired, or the user is disabled). Notes when it was last used. */
export async function userForApiToken(
  db: Db,
  token: string | null | undefined,
  now = new Date(),
): Promise<{ user: PublicUser; tokenName: string } | null> {
  if (!token || !token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
  const hash = sha256(token);
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, tokenName: apiTokens.name })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.ownerId))
    .where(and(eq(apiTokens.tokenHash, hash), isNull(apiTokens.revokedAt), gt(apiTokens.expiresAt, now), isNull(users.disabledAt)));
  if (!row) return null;
  await db
    .update(apiTokens)
    .set({ lastUsedAt: now })
    .where(and(eq(apiTokens.tokenHash, hash), or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, new Date(now.getTime() - TOUCH_MS)))));
  const { tokenName, ...user } = row;
  return { user, tokenName };
}

/** The token in an `Authorization: Bearer …` header, if any. */
export function bearerToken(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m ? m[1] : null;
}
