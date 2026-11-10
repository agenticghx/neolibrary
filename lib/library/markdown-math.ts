/**
 * Equations in a Markdown book (M41 R1): LaTeX between dollar signs becomes MathML, the standard markup for
 * mathematics that browsers draw themselves, so a paper's equations read as equations, not as code.
 *
 * Rules (the ones Pandoc, a widely used document converter, follows):
 * - `$$ … $$` on lines of their own is a display equation; `$…$` inside a line is an inline one.
 * - An inline `$` opens only when the next character is not a space, and closes only when the character before it is
 *   not a space and the next one is not a digit, so prices stay text: "$100 million and $200" is not mathematics.
 *   One more rule for prices: a formula that starts with a digit holds no space, and no formula runs into `code`.
 * - `\$` is a dollar sign, and nothing inside `code` is mathematics.
 * - LaTeX that KaTeX cannot read stays as it was written, as text: nothing is lost, and nothing breaks the book.
 *
 * KaTeX runs with `trust: false`, so a formula cannot add links, pictures or anything else from outside the book.
 * KaTeX's copy of the LaTeX source (its `annotation` element) is taken out, because a paragraph's words are what
 * Listen reads aloud and what search finds; the source is kept in the `alttext` attribute, where neither looks.
 */
import katex from "katex";

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The LaTeX as MathML, or null when KaTeX cannot read it. */
export function mathMl(tex: string, display: boolean): string | null {
  let html: string;
  try {
    html = katex.renderToString(tex, { output: "mathml", displayMode: display, throwOnError: true, trust: false, strict: "ignore" });
  } catch {
    return null;
  }
  const math = /<math[\s\S]*<\/math>/.exec(html)?.[0];
  if (!math) return null;
  return math
    .replace(/<annotation encoding="application\/x-tex">[\s\S]*?<\/annotation>/, "")
    // A function, not a string: in a replacement string "$'" and "$&" stand for parts of the match.
    .replace(/^<math /, () => `<math alttext="${escAttr(tex.trim())}" `);
}

export type MathSpan = { start: number; end: number; tex: string };

/** The inline `$…$` spans of a line (Pandoc's rule above), skipping `\$` and code spans. */
export function inlineMathSpans(text: string): MathSpan[] {
  const spans: MathSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") {
      const close = text.indexOf("`", i + 1);
      i = close < 0 ? text.length : close + 1;
      continue;
    }
    if (c === "$" && text[i + 1] !== "$" && text[i + 1] !== undefined && !/\s/.test(text[i + 1])) {
      let j = i + 1;
      let end = -1;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === "`") break;
        if (text[j] === "$") {
          if (!/\s/.test(text[j - 1]) && !/\d/.test(text[j + 1] ?? "")) end = j;
          break;
        }
        j += 1;
      }
      // A price opens like a formula that starts with a digit; such a formula holds no space ("$10^{-3}$", not "$200 more …$").
      if (end > i + 1 && /\d/.test(text[i + 1]) && /\s/.test(text.slice(i + 1, end))) end = -1;
      if (end > i + 1) {
        spans.push({ start: i, end: end + 1, tex: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    i += 1;
  }
  return spans;
}
