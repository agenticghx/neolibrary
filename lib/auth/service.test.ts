import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { eq } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "./crypto";
import {
  acceptInvite,
  authenticate,
  createFirstAdmin,
  createInvite,
  createSession,
  endSession,
  hashToCheck,
  inviteIsOpen,
  listInvites,
  revokeInvite,
  userForSession,
} from "./service";

let database: Database;
beforeEach(async () => {
  database = await testDatabase();
});
afterEach(() => database.raw.close());

const admin = { email: "Owner@Example.com", name: "Samuel", password: "correct horse battery" };
const reader = { email: "friend@example.com", name: "Ada", password: "another long secret" };

describe("first admin", () => {
  it("is created once, then setup is closed", async () => {
    const a = await createFirstAdmin(database.db, admin);
    expect(a).toMatchObject({ email: "owner@example.com", role: "admin" });
    await expect(createFirstAdmin(database.db, { ...reader })).rejects.toThrow("already complete");
  });

  it("stores a hash, never the password", async () => {
    await createFirstAdmin(database.db, admin);
    const [row] = await database.db.select().from(users);
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain(admin.password);
  });

  it("rejects short passwords and bad emails", async () => {
    await expect(createFirstAdmin(database.db, { ...admin, password: "short" })).rejects.toThrow("at least 10");
    await expect(createFirstAdmin(database.db, { ...admin, email: "nope" })).rejects.toThrow("valid email");
  });
});

describe("invites", () => {
  it("turn into a reader account, once", async () => {
    const a = await createFirstAdmin(database.db, admin);
    const { token } = await createInvite(database.db, a, "for Ada");
    expect(await inviteIsOpen(database.db, token)).toBe(true);
    const r = await acceptInvite(database.db, token, reader);
    expect(r.role).toBe("reader");
    expect(await inviteIsOpen(database.db, token)).toBe(false);
    await expect(acceptInvite(database.db, token, { ...reader, email: "x@example.com" })).rejects.toThrow(
      "not valid",
    );
    expect((await listInvites(database.db))[0].status).toBe("used");
  });

  it("expire after 7 days and can be revoked", async () => {
    const a = await createFirstAdmin(database.db, admin);
    const t0 = new Date("2026-01-01T00:00:00Z");
    const old = await createInvite(database.db, a, "", t0);
    expect(await inviteIsOpen(database.db, old.token, new Date("2026-01-09T00:00:00Z"))).toBe(false);
    const fresh = await createInvite(database.db, a);
    await revokeInvite(database.db, a, fresh.id);
    expect(await inviteIsOpen(database.db, fresh.token)).toBe(false);
  });

  it("can only be made by an admin, and a wrong token gives nothing", async () => {
    const a = await createFirstAdmin(database.db, admin);
    const { token } = await createInvite(database.db, a);
    const r = await acceptInvite(database.db, token, reader);
    await expect(createInvite(database.db, r)).rejects.toThrow("Only an admin");
    await expect(acceptInvite(database.db, "made-up", reader)).rejects.toThrow("not valid");
  });

  it("refuse an email that already has an account, and stay open", async () => {
    const a = await createFirstAdmin(database.db, admin);
    const { token } = await createInvite(database.db, a);
    await expect(acceptInvite(database.db, token, { ...reader, email: admin.email })).rejects.toThrow("already exists");
    expect(await inviteIsOpen(database.db, token)).toBe(true);
  });
});

describe("sign-in and sessions", () => {
  it("accepts the right password only, with one message for every failure", async () => {
    await createFirstAdmin(database.db, admin);
    expect((await authenticate(database.db, " OWNER@example.com ", admin.password)).role).toBe("admin");
    await expect(authenticate(database.db, admin.email, "wrong password!")).rejects.toThrow("do not match");
    await expect(authenticate(database.db, "nobody@example.com", admin.password)).rejects.toThrow("do not match");
  });

  it("checks an unknown email and a disabled account against the stand-in hash", async () => {
    const a = await createFirstAdmin(database.db, admin);
    const [row] = await database.db.select().from(users);
    expect(hashToCheck(undefined)).toBe(DUMMY_PASSWORD_HASH);
    expect(hashToCheck(row)).toBe(row.passwordHash);
    expect(hashToCheck({ ...row, disabledAt: new Date() })).toBe(DUMMY_PASSWORD_HASH);
    expect(await verifyPassword("not-the-password", DUMMY_PASSWORD_HASH)).toBe(false);
    await database.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, a.id));
    await expect(authenticate(database.db, admin.email, admin.password)).rejects.toThrow("do not match");
  });

  it("finds the user for a live session, not for an expired or ended one", async () => {
    const a = await createFirstAdmin(database.db, admin);
    const t0 = new Date("2026-01-01T00:00:00Z");
    const s = await createSession(database.db, a.id, t0);
    expect(await userForSession(database.db, s.token, new Date("2026-01-02T00:00:00Z"))).toMatchObject({ id: a.id });
    expect(await userForSession(database.db, s.token, new Date("2026-03-01T00:00:00Z"))).toBeNull();
    const live = await createSession(database.db, a.id);
    await endSession(database.db, live.token);
    expect(await userForSession(database.db, live.token)).toBeNull();
    expect(await userForSession(database.db, undefined)).toBeNull();
    expect(await userForSession(database.db, "forged")).toBeNull();
  });
});
