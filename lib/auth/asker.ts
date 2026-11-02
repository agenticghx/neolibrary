import type { Db } from "@/lib/db/client";
import { freeBookToRead, shelfOwner } from "@/lib/library/open-shelf";
import { currentUser } from "./session";

/**
 * Who is asking an AI route about a book (M34, the open shelf). A signed-in person is themselves. Someone not
 * signed in is a visitor, and only for a book that is free to read: they see the owner's copy of it (its saved
 * answers, which hold only the book's text and the AI's words) and pay for anything new with their own key, since
 * their role is not the owner's (lib/ai/model-picks.ts textModelFor). A route that serves a visitor must never
 * return or save anything personal of the owner's (marks, notes, attempts): `visitor` says when to leave it out.
 */
export type Asker = { id: string; role: string; visitor: boolean };

export async function askerFor(db: Db, bookId: string): Promise<Asker | null> {
  const user = await currentUser();
  if (user) return { id: user.id, role: user.role, visitor: false };
  if (!(await freeBookToRead(db, bookId))) return null;
  const owner = await shelfOwner(db);
  return owner ? { id: owner.id, role: "visitor", visitor: true } : null;
}
