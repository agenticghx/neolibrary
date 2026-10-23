import { ADJECTIVES } from "./xray";

/**
 * Alias hygiene (M32 X7). Claude is asked for "every way this chapter writes"
 * a name. On Chip War (2026-10-23) its aliases also held quoted forms
 * (“chip,”), possessives (Intel’s), descriptions ("TSMC’s chairman", "the
 * island of Taiwan"), demonyms ("Japanese") and other entries' names ("Japan"
 * under Tokyo): counts swelled ("integrated circuit" 832 times, mostly "chip")
 * and different things merged. These rules keep an alias only when it is a
 * way of writing the name. The name itself is always kept.
 */
const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
const JOINERS = new Set(["of", "the", "and", "de", "du", "von", "van", "da", "di", "del", "la", "le", "for", "in", "on", "at", "to", "a", "an", "&"]);
const words = (s: string) => s.split(/\s+/).filter(Boolean);
const bare = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const capital = (w: string) => /^[\p{Lu}\p{N}]/u.test(bare(w));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rule 1: one way of writing, without wrapping quotes or brackets, trailing punctuation, a leading "the" or a possessive. */
export function normaliseAlias(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(/^[“”"'‘’«»([]+/, "").replace(/[“”"'‘’«»)\]]+$/, "");
  s = s.replace(/[,.;:!?]+$/, "");
  s = s.replace(/^the\s+/i, "");
  s = s.replace(/[’']s$/u, "");
  return s.replace(/\s+/g, " ").trim();
}

/** Whether `short` occurs in `long` as whole words. */
const partOf = (short: string, long: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(short)}(?![\\p{L}\\p{N}])`, "iu").test(long);
const stem = (w: string) => bare(w).toLowerCase().replace(/[’']s$/u, "");
/** Two words of one stem: "circuits" and "circuit", "lithographic" and "photolithography". */
function sameStem(x: string, y: string): boolean {
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && long.includes(short.slice(0, Math.max(4, short.length - 3)));
}

/** Rule 3's test: a lower-case alias shares a word with the name; plurals, compounds and an acronym's words count. */
function sharesWord(alias: string, name: string): boolean {
  const a = words(alias).map(stem).filter(Boolean);
  const n = words(name).map(stem).filter(Boolean);
  const initials = a
    .filter((w) => !JOINERS.has(w))
    .map((w) => w[0])
    .join("");
  if (n.length === 1 && initials === n[0]) return true; // "dynamic random access memory" is DRAM
  return a.some((x) => n.some((y) => sameStem(x, y)));
}

/**
 * Rule 2's test: an alias that has a word of the name and adds only lower-case
 * words ("TSMC’s chairman", "the island of Taiwan", "DRAM business") is a
 * description; the name matches the same place. A plural or a compound of a
 * name's word ("integrated circuits") adds nothing; added capitals ("Morris
 * Chang" over "Chang", "Bob Noyce") make a fuller name, kept.
 */
function describes(alias: string, name: string): boolean {
  const n = words(name).map(stem).filter(Boolean);
  const own = words(alias).filter((w) => bare(w) && !JOINERS.has(bare(w).toLowerCase()));
  const extra = own.filter((w) => !n.some((y) => sameStem(stem(w), y)));
  return extra.length < own.length && extra.length > 0 && extra.every((w) => !capital(w));
}

/**
 * The names an entry's aliases may not be (rule 5): the other entries' names,
 * except a shorter or fuller form of this name of the same kind ("Hyde" and
 * "Edward Hyde" are one man, to be joined), and the one it joins.
 */
export function namesToAvoid(name: string, kind: string, others: { name: string; kind: string }[]): string[] {
  return others.filter((o) => !same(o.name, name) && !(o.kind === kind && (partOf(o.name, name) || partOf(name, o.name)))).map((o) => o.name);
}

/**
 * The aliases worth keeping for an entry called `name`, given the names of
 * the book's other entries: the name first, then each alias that survives
 * the rules, in the order given, written as first met.
 */
export function tidyAliases(name: string, aliases: string[], otherNames: string[]): string[] {
  const seen = new Map<string, string>();
  const keep = (a: string) => {
    const k = a.toLowerCase();
    if (!seen.has(k)) seen.set(k, a);
  };
  keep(name);
  for (const raw of aliases) {
    const a = normaliseAlias(raw);
    if (!a || same(a, name)) continue;
    if (describes(a, name)) continue; // rule 2: "TSMC’s chairman" is not a way of writing TSMC
    if (!/\p{Lu}/u.test(a) && !sharesWord(a, name)) continue; // rule 3: "chip" is not a way of writing "integrated circuit"
    if (!a.includes(" ") && ADJECTIVES.has(a[0].toUpperCase() + a.slice(1))) continue; // rule 4: "Japanese" is not Japan
    if (otherNames.some((n) => same(n, a))) continue; // rule 5: "Japan" under Tokyo belongs to Japan
    keep(a);
  }
  return [...seen.values()];
}
