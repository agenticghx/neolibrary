export type Health = { status: "ok"; service: "neolibrary"; commit: string | null };

/**
 * The deployed commit, 7 characters. Railway sets RAILWAY_GIT_COMMIT_SHA when
 * it builds from GitHub. A laptop upload (`railway up`) does not, so that
 * deploy sets NEOLIBRARY_COMMIT to `git rev-parse HEAD` instead. Anything
 * that is not a git sha is left out: a health check should not echo an
 * arbitrary setting.
 */
export function commitOf(env: Record<string, string | undefined>): string | null {
  const raw = (env.RAILWAY_GIT_COMMIT_SHA || env.NEOLIBRARY_COMMIT || "").trim();
  if (!/^[0-9a-f]{7,40}$/i.test(raw)) return null;
  return raw.slice(0, 7);
}

export function health(env: Record<string, string | undefined> = process.env): Health {
  return { status: "ok", service: "neolibrary", commit: commitOf(env) };
}
