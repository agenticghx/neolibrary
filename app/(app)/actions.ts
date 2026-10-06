"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createInvite, revokeInvite } from "@/lib/auth/service";
import { requireAdmin, requireUser, stopSession } from "@/lib/auth/session";
import { addSection, addTitle, createPath, moveTitle, PathError, removeTitle, renamePath, seedPath } from "@/lib/library/paths";
import { createAnnotation, deleteAnnotation } from "@/lib/library/annotations";
import { starterPath } from "@/lib/library/seed";
import { addSampleBooks } from "@/lib/library/samples";
import { getStorage } from "@/lib/storage";
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
  const seed = starterPath(String(data.get("slug")));
  if (!seed) return;
  await seedPath(await getDb(), user.id, seed);
  // The sidebar on every page lists the Paths.
  revalidatePath("/", "layout");
  redirect(`/paths/${seed.slug}`);
}

export type CollectionState = { error: string | null };

export async function createCollectionAction(_: CollectionState, data: FormData): Promise<CollectionState> {
  const user = await requireUser();
  try {
    const c = await createCollection(await getDb(), user.id, String(data.get("name") ?? ""));
    revalidatePath("/", "layout");
    redirect(`/library?c=${c.id}`);
  } catch (e) {
    if (e instanceof CollectionError) return { error: e.message };
    throw e;
  }
}

export async function deleteCollectionAction(data: FormData) {
  const user = await requireUser();
  await deleteCollection(await getDb(), user.id, String(data.get("id")));
  revalidatePath("/", "layout");
  redirect("/library");
}

export async function toggleCollectionAction(data: FormData) {
  const user = await requireUser();
  const bookId = String(data.get("bookId"));
  await setInCollection(await getDb(), user.id, String(data.get("collectionId")), bookId, data.get("inside") === "1");
  revalidatePath(`/books/${bookId}`);
  revalidatePath("/library");
}

/** A note on a pillar or a whole path (from the Path view). */
export async function addTargetNoteAction(data: FormData) {
  const user = await requireUser();
  const targetType = String(data.get("targetType"));
  if (targetType !== "pillar" && targetType !== "path") return;
  const body = String(data.get("body") ?? "");
  if (!body.trim()) return;
  await createAnnotation(await getDb(), user.id, { kind: "note", targetType, targetId: String(data.get("targetId")), body });
  // Path notes show on the Path's page and (until Home changes) on Home.
  revalidatePath("/", "layout");
}

export async function removeNoteAction(data: FormData) {
  const user = await requireUser();
  await deleteAnnotation(await getDb(), user.id, String(data.get("id")));
  revalidatePath("/", "layout");
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

/** Adds the free sample classics to the reader's shelf (an empty library gets something to read at once). */
export async function addSampleBooksAction() {
  const user = await requireUser();
  await addSampleBooks(await getDb(), await getStorage(), user.id);
  revalidatePath("/", "layout");
}

/* Your own Paths (M14 step 5). Every change refreshes the whole layout: the sidebar lists the Paths. */

export type PathFormState = { error: string | null; done?: string | null };

const pathPages = (slug: string) => {
  revalidatePath("/", "layout");
  revalidatePath(`/paths/${slug}`);
  revalidatePath(`/paths/${slug}/edit`);
};

export async function createPathAction(_: PathFormState, data: FormData): Promise<PathFormState> {
  const user = await requireUser();
  let slug: string;
  try {
    slug = (await createPath(await getDb(), user.id, { title: data.get("title"), description: data.get("description") })).slug;
  } catch (e) {
    if (e instanceof PathError) return { error: e.message };
    throw e;
  }
  pathPages(slug);
  redirect(`/paths/${slug}/edit`);
}

export async function renamePathAction(_: PathFormState, data: FormData): Promise<PathFormState> {
  const user = await requireUser();
  try {
    await renamePath(await getDb(), user.id, String(data.get("pathId")), { title: data.get("title"), description: data.get("description") });
  } catch (e) {
    if (e instanceof PathError) return { error: e.message };
    throw e;
  }
  pathPages(String(data.get("slug")));
  return { error: null, done: "Saved the name and description." };
}

export async function addSectionAction(_: PathFormState, data: FormData): Promise<PathFormState> {
  const user = await requireUser();
  let section: { title: string };
  try {
    section = await addSection(await getDb(), user.id, String(data.get("pathId")), data.get("title"));
  } catch (e) {
    if (e instanceof PathError) return { error: e.message };
    throw e;
  }
  pathPages(String(data.get("slug")));
  return { error: null, done: `Added the section ${section.title}.` };
}

/** Adds a title to a section; the message names the book, so a repeated "Added" is still news to a screen reader. */
export async function addTitleAction(_: PathFormState, data: FormData): Promise<PathFormState> {
  const user = await requireUser();
  const bookId = String(data.get("bookId") ?? "");
  const typedAuthor = String(data.get("author") ?? "").trim();
  let added: Awaited<ReturnType<typeof addTitle>>;
  try {
    added = await addTitle(await getDb(), user.id, String(data.get("pillarId")), {
      ...(bookId ? { bookId } : { title: data.get("title"), author: data.get("author") }),
      kind: data.get("kind"),
    });
  } catch (e) {
    if (e instanceof PathError) return { error: e.message };
    throw e;
  }
  pathPages(String(data.get("slug")));
  if (!added.reused || bookId) return { error: null, done: `Added ${added.title}.` };
  // A typed title that turned out to be a book already in the library: say which one, and how to undo a wrong guess.
  const name = added.author ? `${added.title} by ${added.author}` : added.title;
  const undo = typedAuthor ? "" : " If you meant another book, remove it and add it again with its author.";
  return { error: null, done: `Added ${name}: it was already in your library, so this is the same book.${undo}` };
}

/**
 * Moves a title up or down, or takes it off its section, and says what
 * happened ("Moved Against Method to 1 of 2."). A title already gone (another
 * tab) changes nothing: the line says so, and the page shows the Path as it is now.
 */
export async function moveOrRemoveTitleAction(_: PathFormState, data: FormData): Promise<PathFormState> {
  const user = await requireUser();
  const slotId = String(data.get("slotId"));
  const op = data.get("op");
  let done: string;
  try {
    if (op === "remove") {
      done = `Removed ${(await removeTitle(await getDb(), user.id, slotId)).title}. It stays in your library.`;
    } else {
      const moved = await moveTitle(await getDb(), user.id, slotId, op === "up" ? "up" : "down");
      done = `Moved ${moved.title} to ${moved.place} of ${moved.count}.`;
    }
  } catch (e) {
    if (!(e instanceof PathError)) throw e;
    pathPages(String(data.get("slug")));
    return { error: e.message, done: null };
  }
  pathPages(String(data.get("slug")));
  return { error: null, done };
}

