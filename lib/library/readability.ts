/**
 * How hard a passage is to read (M21), by two classic formulas from the 1940s-70s that count only
 * sentence length and word length. Written for: Claude sessions and Samuel. English text only.
 *
 * - **Flesch-Kincaid grade level**: 0.39 × (words per sentence) + 11.8 × (syllables per word) − 15.59.
 *   Roughly the US school grade a reader needs to read the text comfortably: 6 is age 11 to 12, 8 is
 *   age 13 to 14, 12 is the last year of high school, 16 a university degree. It can go below 0 for
 *   very short, simple text and has no top (a 60-word sentence of long words scores over 25).
 * - **Flesch reading ease**: 206.835 − 1.015 × (words per sentence) − 84.6 × (syllables per word).
 *   Higher is easier: 60 to 70 is ordinary adult prose, below 30 is academic writing.
 *
 * Limits, which matter when reading the numbers: both formulas count, they do not understand. A
 * sentence of short words in a muddled order scores as easy; one long, clear sentence scores as hard;
 * a rare short word ("qua", "ergo") counts as easy, a common long one ("everybody") as hard. Syllables
 * here are estimated from spelling, not looked up in a dictionary: right for most words, off by one
 * for some ("created", "science"). So use it to compare versions of the same passage, not to judge
 * whether a text is good. STE (Simplified Technical English) asks for short sentences and simple
 * words, which is exactly what these formulas reward.
 *
 * This file has no imports on purpose: `scripts/readability-report.mjs` loads it directly with Node.
 */

export type Readability = {
  words: number;
  sentences: number;
  syllables: number;
  /** Flesch-Kincaid grade level (unrounded). */
  grade: number;
  /** Flesch reading ease (unrounded; higher is easier). */
  ease: number;
};

/**
 * Words that end a word but not a sentence when followed by a full stop: titles, "e.g.", "No. 5".
 * Lowercase, without the full stop. "etc." is left out: it ends sentences as often as not.
 */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "capt", "col", "gen", "lt", "sgt", "rev", "hon", "gov", "sen",
  "rep", "pres", "vs", "eg", "ie", "cf", "al", "approx", "fig", "figs", "vol", "vols", "ch", "pp", "ed", "eds", "dept",
  "est", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

/** A sentence end: one or more of . ! ? … then any closing quotes or brackets, then a space or the end. */
const END = /[.!?…]+["'”’)\]]*(?=\s|$)/g;

/** Splits text into sentences. A blank line (a paragraph break) always ends one. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    let start = 0;
    for (const m of para.matchAll(END)) {
      const end = m.index + m[0].length;
      if (!endsSentence(para, m.index, m[0], end)) continue;
      out.push(para.slice(start, end));
      start = end;
    }
    out.push(para.slice(start));
  }
  return out.map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
}

function endsSentence(para: string, at: number, mark: string, end: number): boolean {
  const next = /\S/.exec(para.slice(end));
  if (!next) return true;
  // '"Stop!" she said.' and 'at 5 p.m. on Tuesday': a lowercase letter next means the sentence goes on.
  if (/\p{Ll}/u.test(next[0])) return false;
  if (!/^\.["'”’)\]]*$/.test(mark)) return true; // ! ? … or ..., before a capital: a new sentence
  const before = /(\S+)$/.exec(para.slice(0, at))?.[1] ?? "";
  const word = before.replace(/^["'“‘(\[]+/, "");
  // An initial ("J. R. R. Tolkien") or a dotted short form ("U.S. Army", "e.g. Ohm's law").
  if (/^\p{Lu}$/u.test(word) || /^(\p{L}\.)+\p{L}$/u.test(word)) return false;
  const lower = word.toLowerCase().replace(/\./g, "");
  if (lower === "no" || lower === "nos") return !/\p{N}/u.test(next[0]); // "No. 5"
  return !ABBREVIATIONS.has(lower);
}

/**
 * The words of a text: runs between spaces, split again at dashes and slashes, without the punctuation
 * around them. "don't", "well-known", "U.S.", "3.5" and "1,000" are one word each; a lone "—" is none.
 */
export function words(text: string): string[] {
  return text
    .split(/[\s—–/]+|--+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** A few common words the spelling rules below get wrong. */
const SPECIAL: Record<string, number> = {
  people: 2, business: 2, businesses: 3, every: 2, everyone: 3, everything: 3, everybody: 4, evening: 2,
  science: 2, sciences: 3, scientist: 3, element: 3, elements: 3, create: 2, created: 3, creates: 2, creating: 3,
  creation: 3, real: 1, really: 2, idea: 3, ideas: 3, area: 3, areas: 3, being: 2, poem: 2, poems: 2, quiet: 2,
  different: 3, interest: 3, interesting: 4, toward: 2, towards: 2, fire: 1, hour: 1, hours: 1, our: 1, ours: 1,
};

/**
 * An estimate of the syllables in one word, from its spelling: one per group of vowels, less a silent
 * final "e" (and the "e" of "-es" and "-ed" when it is not said), plus one for vowel pairs said apart
 * ("radio", "media", "medium") and for "-le" after a consonant ("table"). After the rules of
 * Lingua::EN::Syllable (Greg Fast), adapted. Numbers count one syllable per digit (a rough guess).
 */
export function syllables(word: string): number {
  const digits = (word.match(/\p{N}/gu) ?? []).length;
  const letters = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return Math.max(1, digits);
  // "1950s", "3rd": the number, plus nothing for the letters after it.
  if (digits && !/[aeiouy]/.test(letters)) return digits;
  return digits + letterSyllables(letters);
}

function letterSyllables(w: string): number {
  if (SPECIAL[w] !== undefined) return SPECIAL[w];
  if (!/[aeiouy]/.test(w)) return w.length; // "PJM", "BBC": said letter by letter
  const base = w.length > 2 ? w.replace(/e$/, "") : w; // a silent final e ("make"); "-le" is put back below
  let n = (base.match(/[aeiouy]+/g) ?? []).length;
  const add = [
    /[^aeiouy]le$/, // table, middle, simple
    /(^|[^cts])ia/, // media, giant, India (not social, potential, Christian)
    /(^|[^cgstx])io/, // radio, biology, curious (not nation, vision, region, precious)
    /iu/, // medium, premium
    /eo(?!u)/, // video, theory, geography
    /[^gq]ua/, // actual, usual (not language, quality)
    /[^aeiou]ie(r|st)$/, // earlier, easiest
    /[^aeiou]iet/, // society, variety
    /[^aeiouct]ien/, // audience, client, experience
    /(?!eau|eou|iou)[aeiou]{3}/, // agreeable
    /yings?$/, // playing, flying
    /[aeiou]ings?$/, // doing, going, seeing
    /ism$/, // capitalism
    /^mc/, // McCarthy
    /[dsz]nt$/, // couldn't, wasn't (after the apostrophe is dropped)
  ];
  const sub = [
    /[^aeiouyszxhcgl]es$/, // makes, lives (not boxes, places, changes, tables)
    /[^aeiouytd]ed$/, // jumped, called (not wanted, needed)
    /[aeiouy][^aeiouy]e(ful|less|ness|ly|ments?)$/, // careful, lately, statement
    /llion/, // million, billion
  ];
  for (const r of add) if (r.test(w)) n++;
  for (const r of sub) if (r.test(w)) n--;
  return Math.max(1, n);
}

/** Both measures for a text, or null when it has no words. */
export function measure(text: string): Readability | null {
  const ws = words(text);
  if (!ws.length) return null;
  const sentences = Math.max(1, splitSentences(text).length);
  const syll = ws.reduce((sum, w) => sum + syllables(w), 0);
  return { words: ws.length, sentences, syllables: syll, ...formulas(ws.length, sentences, syll) };
}

/** The two formulas, from counts. */
export function formulas(words: number, sentences: number, syllables: number): { grade: number; ease: number } {
  const wps = words / sentences;
  const spw = syllables / words;
  return { grade: 0.39 * wps + 11.8 * spw - 15.59, ease: 206.835 - 1.015 * wps - 84.6 * spw };
}

/** A grade as shown: a whole number, never below 0. */
export const shownGrade = (grade: number) => Math.max(0, Math.round(grade));

/**
 * What the reader sees beside a rewrite: the two grades (shown as "Grade 14, arrow, 8"), their spoken
 * label, and a one-line note on what the grade means. Null when either text has no words.
 */
export function compareReadability(original: string, rewrite: string) {
  const a = measure(original);
  const b = measure(rewrite);
  if (!a || !b) return null;
  const from = shownGrade(a.grade);
  const to = shownGrade(b.grade);
  return {
    from,
    to,
    label: `Reading level: original grade ${from}, this rewrite grade ${to}`,
    note:
      "Flesch-Kincaid grade: about the years of school needed to read it comfortably (US grades: 8 is age 13 to 14, 12 the end of high school). " +
      "It counts sentence and word length only, not meaning.",
  };
}
