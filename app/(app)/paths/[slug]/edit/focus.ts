/*
 * Where focus goes after a Move or Remove on the edit page (M14 step 5): the
 * same title's button while it can move that way again, else its other Move
 * button; after Remove, the title now in its place (or the one before). The
 * answer names a button as "<title id>:<op>", or null for the section heading.
 */

export type TitleOp = "up" | "down" | "remove";

/** A list's order as one string, to tell when the refreshed list is on screen. */
export const orderOf = (list: { id: string }[]) => list.map((t) => t.id).join(" ");

export function focusAfter(list: { id: string }[], done: { op: TitleOp; slotId: string; index: number }): string | null {
  if (done.op === "remove") {
    const next = list[done.index] ?? list[done.index - 1];
    return next ? `${next.id}:remove` : null;
  }
  const i = list.findIndex((t) => t.id === done.slotId);
  if (i < 0) return null;
  const again = done.op === "up" ? i > 0 : i < list.length - 1;
  return `${done.slotId}:${again ? done.op : done.op === "up" ? "down" : "up"}`;
}
