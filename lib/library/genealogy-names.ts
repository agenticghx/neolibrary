/**
 * M43 S3: which name in a book's genealogy an X-ray entry is, so the Who & what card can open its family tree or
 * life. Written for Claude sessions. The two indexes name people differently: the X-ray as the book writes them
 * ("Mr. Utterson", "Noyce"), the genealogy by the fullest name ("Gabriel John Utterson", "Robert Noyce"). No imports,
 * so the reader's page can use it.
 */
export type GenealogyName = { name: string; kind: "person" | "organisation"; links: number; tree: boolean };

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "sir", "lord", "lady", "dame", "professor", "prof", "rev", "the"]);
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !TITLES.has(w));

/**
 * The genealogy's name for an X-ray entry, or null. An exact name (any spelling the X-ray knows, any case) wins.
 * Otherwise a person matches by surname with every other word of theirs present ("Mr. Utterson", "Gabriel John
 * Utterson"), and an organisation when its words begin the genealogy's name ("Fairchild", "Fairchild
 * Semiconductor"). Of several that fit, the most linked; a place, term, work or event never matches a person.
 */
export function matchGenealogyName(entry: { name: string; kind: string; aliases: string[] }, names: GenealogyName[]): GenealogyName | null {
  const spellings = [...new Set([entry.name, ...entry.aliases])];
  const exact = new Map(names.map((n) => [n.name.toLowerCase(), n]));
  for (const s of spellings) {
    const hit = exact.get(s.toLowerCase());
    if (hit) return hit;
  }
  if (["place", "term", "work", "event"].includes(entry.kind)) return null;
  const fits = names.filter((n) => {
    if (entry.kind === "person" && n.kind !== "person") return false;
    if (entry.kind === "organisation" && n.kind !== "organisation") return false;
    const theirs = words(n.name);
    if (!theirs.length) return false;
    return spellings.some((s) => {
      const mine = words(s);
      if (!mine.length) return false;
      if (n.kind === "person") return mine[mine.length - 1] === theirs[theirs.length - 1] && mine.every((w) => theirs.includes(w));
      return mine.length <= theirs.length && mine.every((w, i) => theirs[i] === w);
    });
  });
  return fits.sort((a, b) => b.links - a.links)[0] ?? null;
}
