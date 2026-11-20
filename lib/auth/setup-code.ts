import { randomToken, safeEqual } from "./crypto";

/**
 * The one-time code that lets the owner create the first admin account.
 * Taken from SETUP_CODE if set; otherwise made up at start-up and printed in
 * the server log (Railway → web → Deployments → View logs).
 */
const g = globalThis as unknown as { __neolibrarySetupCode?: string };

export function setupCode(env: Record<string, string | undefined> = process.env): string {
  if (env.SETUP_CODE) return env.SETUP_CODE;
  if (env !== process.env) return randomToken(9);
  g.__neolibrarySetupCode ??= randomToken(9);
  return g.__neolibrarySetupCode;
}

export function checkSetupCode(given: string, env?: Record<string, string | undefined>): boolean {
  return safeEqual(given.trim(), setupCode(env));
}
