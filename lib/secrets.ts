import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { appSecrets } from "@/lib/db/schema";
import { randomToken } from "@/lib/auth/crypto";

/** Returns a named server secret, creating a random one the first time. */
export async function serverSecret(db: Db, name: string): Promise<string> {
  await db.insert(appSecrets).values({ name, value: randomToken(32) }).onConflictDoNothing();
  const [row] = await db.select().from(appSecrets).where(eq(appSecrets.name, name));
  return row.value;
}
