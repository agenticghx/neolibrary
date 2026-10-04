export type Health = { status: "ok"; service: "neolibrary"; commit: string | null };

export function health(env: Record<string, string | undefined> = process.env): Health {
  return { status: "ok", service: "neolibrary", commit: env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null };
}
