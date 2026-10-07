import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/lib/db";
import { createSession, endSession, userForSession, type PublicUser } from "./service";

/** Cookie holding the session token. Read optimistically by proxy.ts, verified here. */
export const SESSION_COOKIE = "nl_session";

export const currentUser = cache(async (): Promise<PublicUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userForSession(await getDb(), token);
});

export async function requireUser(): Promise<PublicUser> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function requireAdmin(): Promise<PublicUser> {
  const user = await requireUser();
  if (user.role !== "admin") notFound();
  return user;
}

export async function startSession(userId: string) {
  const { token, expiresAt } = await createSession(await getDb(), userId);
  // Railway serves https and says so in x-forwarded-proto; local test servers are http.
  const secure = (await headers()).get("x-forwarded-proto") === "https";
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/", expires: expiresAt });
}

export async function stopSession() {
  const jar = await cookies();
  await endSession(await getDb(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
}

/** Where to go after signing in: a path on this site only. A control character (a tab, say) is refused too: browsers drop them from addresses, so "/<tab>/elsewhere" would read as "//elsewhere". */
export function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && !/\p{Cc}/u.test(next)
    ? next
    : "/";
}
