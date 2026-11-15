import { cache } from "react";
import { getDb } from "@/lib/db";
import { focusedBookIds } from "./focus-lock";
import { dueCount } from "./review";

/**
 * How many Daily review cards wait today, as the sidebar and Home show it: during a whole-book focus (M26 R5) only
 * that book's, as on the review page. Kept for the length of one request (React's cache), so a page that shows the
 * count twice, as Home does with the sidebar, counts once. A failed count is 0: no count is shown.
 */
export const dueToday = cache(async (ownerId: string): Promise<number> => {
  try {
    const db = await getDb();
    return await dueCount(db, ownerId, new Date(), await focusedBookIds(db, ownerId));
  } catch {
    return 0;
  }
});
