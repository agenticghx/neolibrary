/**
 * The sentence around a place in a paragraph, for the mini-player (M14 step
 * 6b): it shows the sentence being read with the word lit. A sentence ends
 * at . ! ? or … (with any closing quotes or brackets after it) when a space
 * and a capital, a digit or an opening quote follow; not after a title or
 * a common abbreviation ("Mr.", "Dr.", "e.g."), an initial ("J."), or a
 * number's point. The last sentence needs no full stop.
 */

/** Words that end in a full stop without ending the sentence (compared in lower case, without the stop). */
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "st", "prof", "rev", "gen", "col", "capt", "lt", "sr", "jr", "mt", "messrs", "e.g", "i.e", "vs", "cf", "vol", "ch", "fig", "pp"]);

const END = /[.!?…]+["'”’)\]]*/gu;
const STARTS_SENTENCE = /[\p{Lu}\p{N}"'“‘([]/u;

/** Where each sentence of `text` ends (just after its punctuation and closing quotes). */
function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  for (const m of text.matchAll(END)) {
    const at = m.index;
    const after = at + m[0].length;
    // What follows: a space, then the next sentence's first character.
    const next = /^\s+(\S)/u.exec(text.slice(after));
    if (!next || !STARTS_SENTENCE.test(next[1])) continue;
    if (m[0].startsWith(".") && !m[0].startsWith("..")) {
      // The word just before the full stop: a title, an abbreviation or an initial does not end a sentence.
      const word = /(\S+)$/u.exec(text.slice(0, at))?.[1].replace(/^["'“‘([]+/u, "") ?? "";
      if (ABBREVIATIONS.has(word.toLowerCase()) || /^\p{Lu}$/u.test(word)) continue;
    }
    ends.push(after);
  }
  return ends;
}

/** The sentence of `text` that holds character `offset`: its start and end, without the spaces around it. */
export function sentenceAt(text: string, offset: number): { start: number; end: number } {
  const at = Math.max(0, Math.min(offset, text.length));
  let start = 0;
  let end = text.length;
  for (const e of sentenceEnds(text)) {
    if (e <= at) start = e;
    else {
      end = e;
      break;
    }
  }
  while (start < end && /\s/u.test(text[start])) start += 1;
  while (end > start && /\s/u.test(text[end - 1])) end -= 1;
  return { start, end };
}
