"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createInvite, revokeInvite } from "@/lib/auth/service";
import { requireAdmin, stopSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export async function signOutAction() {
  await stopSession();
  redirect("/sign-in");
}

export type InviteState = { error: string | null; link: string | null };

export async function createInviteAction(_: InviteState, data: FormData): Promise<InviteState> {
  const admin = await requireAdmin();
  const { token } = await createInvite(await getDb(), admin, String(data.get("note") ?? ""));
  revalidatePath("/admin/invites");
  return { error: null, link: `/invite/${token}` };
}

export async function revokeInviteAction(data: FormData) {
  const admin = await requireAdmin();
  await revokeInvite(await getDb(), admin, String(data.get("id")));
  revalidatePath("/admin/invites");
}
