"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/ActionForm";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import { acceptInvite, authenticate, AuthError, createFirstAdmin, normaliseEmail } from "@/lib/auth/service";
import { safeNext, startSession } from "@/lib/auth/session";
import { checkSetupCode } from "@/lib/auth/setup-code";
import { getDb } from "@/lib/db";

const limiter = createRateLimiter(10, 15 * 60_000);
const field = (data: FormData, name: string) => String(data.get(name) ?? "");

async function clientAddress() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

/** Runs `fn`; turns AuthError into a message on the form. */
async function attempt(fn: () => Promise<void>): Promise<FormState> {
  try {
    await fn();
    return { error: null };
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message };
    throw e;
  }
}

export async function signInAction(_: FormState, data: FormData): Promise<FormState> {
  const email = normaliseEmail(field(data, "email"));
  if (!limiter.allow(`email:${email}`) || !limiter.allow(`ip:${await clientAddress()}`)) {
    return { error: "Too many attempts. Wait 15 minutes and try again." };
  }
  const result = await attempt(async () => {
    const user = await authenticate(await getDb(), email, field(data, "password"));
    await startSession(user.id);
  });
  if (result.error) return result;
  limiter.reset(`email:${email}`);
  redirect(safeNext(field(data, "next")));
}

export async function setupAction(_: FormState, data: FormData): Promise<FormState> {
  if (!limiter.allow(`setup:${await clientAddress()}`)) return { error: "Too many attempts. Wait 15 minutes." };
  if (!checkSetupCode(field(data, "code"))) return { error: "That setup code is not right. It is in the server log." };
  const result = await attempt(async () => {
    const user = await createFirstAdmin(await getDb(), {
      email: field(data, "email"),
      name: field(data, "name"),
      password: field(data, "password"),
    });
    await startSession(user.id);
  });
  if (result.error) return result;
  redirect("/");
}

export async function acceptInviteAction(_: FormState, data: FormData): Promise<FormState> {
  if (!limiter.allow(`invite:${await clientAddress()}`)) return { error: "Too many attempts. Wait 15 minutes." };
  const result = await attempt(async () => {
    const user = await acceptInvite(await getDb(), field(data, "token"), {
      email: field(data, "email"),
      name: field(data, "name"),
      password: field(data, "password"),
    });
    await startSession(user.id);
  });
  if (result.error) return result;
  redirect("/");
}
