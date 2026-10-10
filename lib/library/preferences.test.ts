import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { getPreferences, PreferencesError, setPreferences } from "./preferences";

let database: Database;
let ownerId: string;

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

describe("reading preferences (M17)", () => {
  it("a new reader opens books side by side, in STE light (Samuel, 2026-10-10)", async () => {
    expect(await getPreferences(database.db, ownerId)).toEqual({ aiStyle: "ste-light", rewrittenView: "side" });
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const reader = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
    expect(await getPreferences(database.db, reader)).toEqual({ aiStyle: "ste-light", rewrittenView: "side" });
  });

  it("changes either one, or both, for this reader only, and refuses what it does not know", async () => {
    expect(await setPreferences(database.db, ownerId, { rewrittenView: "rewritten" })).toEqual({ aiStyle: "ste-light", rewrittenView: "rewritten" });
    expect(await setPreferences(database.db, ownerId, { aiStyle: "ste-strict", rewrittenView: "original" })).toEqual({
      aiStyle: "ste-strict",
      rewrittenView: "original",
    });
    await expect(setPreferences(database.db, ownerId, { rewrittenView: "sideways" })).rejects.toBeInstanceOf(PreferencesError);
    await expect(setPreferences(database.db, ownerId, { aiStyle: "loud" })).rejects.toBeInstanceOf(PreferencesError);
    await expect(setPreferences(database.db, ownerId, {})).rejects.toThrow("Nothing to change.");
    expect(await getPreferences(database.db, ownerId)).toEqual({ aiStyle: "ste-strict", rewrittenView: "original" });
  });
});
