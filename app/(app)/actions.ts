"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createInvite, revokeInvite } from "@/lib/auth/service";
import { requireAdmin, requireUser, stopSession } from "@/lib/auth/session";
import { seedPath } from "@/lib/library/paths";
import { createAnnotation, deleteAnnotation } from "@/lib/library/annotations";
import { STARTER_PATHS } from "@/lib/library/seed";
import { createApiToken, revokeApiToken, TokenError } from "@/lib/auth/tokens";
import { CollectionError, createCollection, deleteCollection, setInCollection } from "@/lib/library/shelf";
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

export async function addPathAction(data: FormData) {
  const user = await requireUser();
  const seed = STARTER_PATHS[String(data.get("slug"))];
  if (seed) await seedPath(await getDb(), user.id, seed);
  revalidatePath("/");
}

export type CollectionState = { error: string | null };

export async function createCollectionAction(_: CollectionState, data: FormData): Promise<CollectionState> {
  const user = await requireUser();
  try {
    const c = await createCollection(await getDb(), user.id, String(data.get("name") ?? ""));
    revalidatePath("/shelf");
    redirect(`/shelf?c=${c.id}`);
  } catch (e) {
    if (e instanceof CollectionError) return { error: e.message };
    throw e;
  }
}

export async function deleteCollectionAction(data: FormData) {
  const user = await requireUser();
  await deleteCollection(await getDb(), user.id, String(data.get("id")));
  revalidatePath("/shelf");
  redirect("/shelf");
}

export async function toggleCollectionAction(data: FormData) {
  const user = await requireUser();
  const bookId = String(data.get("bookId"));
  await setInCollection(await getDb(), user.id, String(data.get("collectionId")), bookId, data.get("inside") === "1");
  revalidatePath(`/books/${bookId}`);
  revalidatePath("/shelf");
}

/** A note on a pillar or a whole path (from the Path view). */
export async function addTargetNoteAction(data: FormData) {
  const user = await requireUser();
  const targetType = String(data.get("targetType"));
  if (targetType !== "pillar" && targetType !== "path") return;
  const body = String(data.get("body") ?? "");
  if (!body.trim()) return;
  await createAnnotation(await getDb(), user.id, { kind: "note", targetType, targetId: String(data.get("targetId")), body });
  revalidatePath("/");
}

export async function removeNoteAction(data: FormData) {
  const user = await requireUser();
  await deleteAnnotation(await getDb(), user.id, String(data.get("id")));
  revalidatePath("/");
}

export type TokenState = { error: string | null; token: string | null };

export async function createTokenAction(_: TokenState, data: FormData): Promise<TokenState> {
  const user = await requireUser();
  try {
    const { token } = await createApiToken(await getDb(), user.id, String(data.get("name") ?? ""));
    revalidatePath("/agents");
    return { error: null, token };
  } catch (e) {
    if (e instanceof TokenError) return { error: e.message, token: null };
    throw e;
  }
}

export async function revokeTokenAction(data: FormData) {
  const user = await requireUser();
  try {
    await revokeApiToken(await getDb(), user.id, String(data.get("id") ?? ""));
  } catch (e) {
    if (!(e instanceof TokenError)) throw e;
  }
  revalidatePath("/agents");
}
