import { and, asc, count, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { invites, sessions, users, type Role, type User } from "@/lib/db/schema";
import { DUMMY_PASSWORD_HASH, hashPassword, randomToken, sha256, verifyPassword } from "./crypto";

/**
 * Account rules, independent of Next.js so they can be unit-tested:
 * - No public sign-up. The first admin is created once with the setup code;
 *   everyone else joins through an invite link made by an admin.
 * - Passwords: at least 10 characters, stored as scrypt hashes.
 * - Sessions last 30 days; the cookie holds a random token, the database only its hash.
 */
export const SESSION_DAYS = 30;
export const INVITE_DAYS = 7;
export const MIN_PASSWORD = 10;

export type PublicUser = Pick<User, "id" | "email" | "name" | "role">;

export class AuthError extends Error {}

const toPublic = (u: User): PublicUser => ({ id: u.id, email: u.email, name: u.name, role: u.role });

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function checkAccountInput(email: string, name: string, password: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("Enter a valid email address.");
  if (!name.trim()) throw new AuthError("Enter your name.");
  if (password.length < MIN_PASSWORD) throw new AuthError(`Use a password of at least ${MIN_PASSWORD} characters.`);
}

export async function userCount(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users);
  return Number(row.n);
}

async function insertUser(db: Db, email: string, name: string, password: string, role: Role) {
  const e = normaliseEmail(email);
  checkAccountInput(e, name, password);
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, e));
  if (existing.length) throw new AuthError("An account with this email already exists.");
  const [u] = await db
    .insert(users)
    .values({ email: e, name: name.trim(), passwordHash: await hashPassword(password), role })
    .returning();
  return u;
}

/** Creates the first admin. Refused once any account exists. */
export async function createFirstAdmin(db: Db, input: { email: string; name: string; password: string }) {
  return db.transaction(async (tx) => {
    // Lock so two setup attempts at the same moment cannot both succeed.
    await tx.execute(sql`LOCK TABLE users IN EXCLUSIVE MODE`);
    const t = tx as unknown as Db;
    if ((await userCount(t)) > 0) throw new AuthError("Setup is already complete.");
    return toPublic(await insertUser(t, input.email, input.name, input.password, "admin"));
  });
}

export async function createInvite(db: Db, admin: PublicUser, note = "", now = new Date()) {
  if (admin.role !== "admin") throw new AuthError("Only an admin can invite people.");
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86_400_000);
  const [row] = await db
    .insert(invites)
    .values({ tokenHash: sha256(token), note: note.trim().slice(0, 200), createdBy: admin.id, expiresAt })
    .returning({ id: invites.id });
  return { id: row.id, token, expiresAt };
}

export type InviteStatus = "open" | "used" | "expired" | "revoked";

export async function listInvites(db: Db, now = new Date()) {
  const rows = await db.select().from(invites).orderBy(desc(invites.createdAt));
  return rows.map((r) => {
    const status: InviteStatus = r.revokedAt ? "revoked" : r.usedAt ? "used" : r.expiresAt <= now ? "expired" : "open";
    return { id: r.id, note: r.note, createdAt: r.createdAt, expiresAt: r.expiresAt, status };
  });
}

export async function revokeInvite(db: Db, admin: PublicUser, id: string, now = new Date()) {
  if (admin.role !== "admin") throw new AuthError("Only an admin can revoke invites.");
  await db.update(invites).set({ revokedAt: now }).where(and(eq(invites.id, id), isNull(invites.usedAt)));
}

async function findOpenInvite(db: Db, token: string, now: Date) {
  const [inv] = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.tokenHash, sha256(token)),
        isNull(invites.usedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, now),
      ),
    );
  return inv;
}

export async function inviteIsOpen(db: Db, token: string, now = new Date()) {
  return Boolean(await findOpenInvite(db, token, now));
}

/** Turns an invite into a reader account. Each invite works once. */
export async function acceptInvite(
  db: Db,
  token: string,
  input: { email: string; name: string; password: string },
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const inv = await findOpenInvite(t, token, now);
    if (!inv) throw new AuthError("This invitation is not valid any more. Ask for a new link.");
    const u = await insertUser(t, input.email, input.name, input.password, "reader");
    await tx.update(invites).set({ usedAt: now, usedBy: u.id }).where(eq(invites.id, inv.id));
    return toPublic(u);
  });
}

/**
 * The hash to check a password against. Unknown emails and disabled accounts
 * use a stand-in, so the slow hash runs once either way (the time would
 * otherwise say whether the email exists).
 */
export function hashToCheck(user: { passwordHash: string; disabledAt: Date | null } | undefined): string {
  if (!user || user.disabledAt) return DUMMY_PASSWORD_HASH;
  return user.passwordHash;
}

/** Checks email + password. Same error for unknown email, a disabled account, and a wrong password. */
export async function authenticate(db: Db, email: string, password: string) {
  const [u] = await db.select().from(users).where(eq(users.email, normaliseEmail(email)));
  const ok = await verifyPassword(password, hashToCheck(u));
  if (!u || u.disabledAt || !ok) throw new AuthError("That email and password do not match.");
  return toPublic(u);
}

export async function createSession(db: Db, userId: string, now = new Date()) {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function userForSession(db: Db, token: string | undefined, now = new Date()) {
  if (!token) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, now), isNull(users.disabledAt)));
  return row ? toPublic(row.user) : null;
}

export async function endSession(db: Db, token: string | undefined) {
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

/**
 * Replaces the password when the current one matches. Other sessions stay
 * signed in until the person signs them out.
 */
export async function changePassword(db: Db, userId: string, current: string, next: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const ok = await verifyPassword(current, hashToCheck(user));
  if (!user || user.disabledAt || !ok) throw new AuthError("That is not your current password.");
  if (next.length < MIN_PASSWORD) throw new AuthError(`Use a password of at least ${MIN_PASSWORD} characters.`);
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
}

/**
 * Deletes every session for this person except the browser that asked.
 * Returns how many sessions were signed out. With no current token, deletes nothing.
 */
export async function endOtherSessions(db: Db, userId: string, currentToken: string | undefined): Promise<number> {
  if (!currentToken) return 0;
  const removed = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, sha256(currentToken))))
    .returning({ id: sessions.id });
  return removed.length;
}

export type ReaderView = { id: string; name: string; email: string; disabledAt: Date | null };

/** People who joined through an invitation. The owner (an admin) is not in this list. */
export async function listReaders(db: Db): Promise<ReaderView[]> {
  return db
    .select({ id: users.id, name: users.name, email: users.email, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.role, "reader"))
    .orderBy(asc(users.name), asc(users.email));
}

/**
 * An admin disables or enables a reader. Disable sets disabledAt (kept if it
 * was already set) and deletes that person's sessions, so they are signed
 * out at once. Enable clears disabledAt. You cannot change your own account.
 */
export async function setReaderDisabled(db: Db, admin: PublicUser, readerId: string, disabled: boolean, now = new Date()) {
  if (admin.role !== "admin") throw new AuthError("Only an admin can change a reader's access.");
  if (readerId === admin.id) throw new AuthError("You cannot disable your own account.");
  if (!/^[0-9a-f-]{36}$/i.test(readerId)) throw new AuthError("That person is not a reader here.");
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [reader] = await t.select().from(users).where(eq(users.id, readerId));
    if (!reader || reader.role !== "reader") throw new AuthError("That person is not a reader here.");
    if (disabled) {
      if (!reader.disabledAt) await t.update(users).set({ disabledAt: now }).where(eq(users.id, readerId));
      await t.delete(sessions).where(eq(sessions.userId, readerId));
    } else {
      await t.update(users).set({ disabledAt: null }).where(eq(users.id, readerId));
    }
  });
}
