import type { Db } from "@/lib/db/client";
import { freeBookToRead, shelfOwner } from "@/lib/library/open-shelf";
import { takeVisitorRequest, visitorAddress } from "@/lib/visitor-limit";
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

/**
 * askerFor for a route: the asker, or the response to send instead: 401 when nobody may ask (not signed in, book
 * not free), 429 when a visitor has used up their AI requests for now (M34 S5, lib/visitor-limit.ts). Counted
 * here, where a visitor is known for sure; a cookie alone would not prove anything.
 */
export async function askerOr(db: Db, bookId: string, req: Request): Promise<Asker | Response> {
  const asker = await askerFor(db, bookId);
  if (!asker) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (asker.visitor) {
    const taken = takeVisitorRequest("ai", visitorAddress(req.headers));
    if (!taken.ok) return tooMany(taken.retryAfterSeconds);
  }
  return asker;
}

/** The answer to a visitor who has asked too often: try again in a moment. */
export function tooMany(retryAfterSeconds: number) {
  return Response.json(
    { error: `Too many requests for now. Try again in ${retryAfterSeconds} seconds.` },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}
