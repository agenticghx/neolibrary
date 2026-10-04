import { randomToken, safeEqual } from "./crypto";

/**
 * The one-time code that lets the owner create the first admin account.
 * Taken from SETUP_CODE if set; otherwise made up at start-up and printed in
 * the server log (Railway → web → Deployments → View logs).
 */
const g = globalThis as unknown as { __neolibrarySetupCode?: string };

export function setupCode(env: Record<string, string | undefined> = process.env): string {
  g.__neolibrarySetupCode ??= env.SETUP_CODE || randomToken(9);
  return g.__neolibrarySetupCode;
}

export function checkSetupCode(given: string, env?: Record<string, string | undefined>): boolean {
  return safeEqual(given.trim(), setupCode(env));
}
