import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { isStyle, isView, STYLES, VIEWS, type RewrittenView, type Style } from "./levels";

/**
 * A reader's reading preferences (M17), set on the Account page or in the
 * reader: the AI explanations style for all books (a book can have its own,
 * set under Aa) and the view a book opens in. New readers start in STE light,
 * side by side (Samuel, 2026-10-10).
 */
export type Preferences = { aiStyle: Style; rewrittenView: RewrittenView };

export class PreferencesError extends Error {}

export async function getPreferences(db: Db, userId: string): Promise<Preferences> {
  const [row] = await db.select({ aiStyle: users.aiStyle, rewrittenView: users.rewrittenView }).from(users).where(eq(users.id, userId));
  if (!row) throw new PreferencesError("Account not found");
  return row;
}

/** Changes either preference, or both; anything else in the input is refused. */
export async function setPreferences(db: Db, userId: string, input: { aiStyle?: unknown; rewrittenView?: unknown }) {
  const patch: Partial<Preferences> = {};
  if (input.aiStyle !== undefined) {
    if (!isStyle(input.aiStyle)) throw new PreferencesError(`The style is one of: ${Object.keys(STYLES).join(", ")}.`);
    patch.aiStyle = input.aiStyle;
  }
  if (input.rewrittenView !== undefined) {
    if (!isView(input.rewrittenView)) throw new PreferencesError(`The view is one of: ${Object.keys(VIEWS).join(", ")}.`);
    patch.rewrittenView = input.rewrittenView;
  }
  if (!Object.keys(patch).length) throw new PreferencesError("Nothing to change.");
  await db.update(users).set(patch).where(eq(users.id, userId));
  return getPreferences(db, userId);
}
