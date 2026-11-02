import type { Piece } from "./rewritten";

/**
 * M41 R1c: the pieces on screen, with each run of equations or table cells folded into one line that says it is kept
 * as in the book ("A table (24 cells), kept as in the book."), so a page holding a table is not a list of its cells.
 */
export function keptRuns(pieces: Piece[]): (Piece | { id: string; kept: string })[] {
  const out: (Piece | { id: string; kept: string })[] = [];
  for (let i = 0; i < pieces.length; ) {
    const p = pieces[i];
    if (p.form === "prose") {
      out.push(p);
      i += 1;
      continue;
    }
    let j = i;
    while (j < pieces.length && pieces[j].form === p.form) j += 1;
    const n = j - i;
    const kept =
      p.form === "cell"
        ? `A table (${n} ${n === 1 ? "cell" : "cells"}), kept as in the book.`
        : n === 1
          ? "An equation, kept as in the book."
          : `${n} equations, kept as in the book.`;
    out.push({ id: `kept-${p.id}`, kept });
    i = j;
  }
  return out;
}

