/**
 * Matching a catalogue record to a title in the library (M22), by title and
 * author only: Hidden Machinery's titles carry no ISBN, often only the
 * author's surname ("Bakke", "Leibbrandt & de Terán"). Pure, so it is unit
 * tested on real catalogue answers (fixtures/).
 */

/** Lower case, accents off ("Poincaré" is "poincare"), "&" as "and", punctuation dropped, spaces collapsed. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Without a leading "The", "A" or "An", which catalogues keep, drop or move to the end ("Grid, The"). */
const bare = (s: string) =>
  normalize(s.replace(/,\s*(the|a|an)\s*$/i, ""))
    .replace(/^(the|a|an) /, "");

/** The title before its subtitle: "Thinking in Systems: A Primer" is "Thinking in Systems". */
export function shortTitle(title: string): string {
  return title.split(/\s*[:(]\s*|\s+[—–]\s+/)[0].trim() || title.trim();
}

/**
 * The surname to search by: the last word of the first author, without "Jr." or initials.
 * "Leibbrandt & de Terán" is "Leibbrandt"; "Thomas Petzinger Jr." is "Petzinger"; "" stays "".
 */
export function surnameOf(author: string): string {
  const first = author.split(/\s*(?:&|\band\b|,|;)\s*/)[0] ?? "";
  const words = first
    .split(/\s+/)
    .map((w) => w.replace(/[.,]+$/, ""))
    .filter((w) => w && !/^(jr|sr|ii|iii|iv|phd|md)$/i.test(w) && !/^[A-Z]$/i.test(w));
  return words.at(-1) ?? "";
}

/** A catalogue record, as far as matching needs it. */
export type Record_ = { title: string; authors: string[] };

/** Several books sold together ("… 2 Books Collection Set"): its picture shows them all. */
const BUNDLE = /\b(box(ed)? set|collection set|books? (collection|set)|\d+ books?)\b/i;

/** The record's title is the wanted one with its subtitle run on without punctuation, three words or more of it. */
const runsOn = (got: string, want: string) => got.startsWith(`${want} `) && got.slice(want.length).trim().split(" ").length >= 3;

/**
 * Whether one of the record's authors has this last name. An entry may name several people ("Javier Blas & Jack
 * Farchy") or put the surname first ("Bakke, Gretchen"); a first name never counts ("Martin Amis" is not Felix Martin).
 */
function hasLastName(authors: string[], surname: string): boolean {
  return authors.some((entry) =>
    entry.split(/\s*(?:&|\band\b|,|;)\s*/).some((one) => {
      const last = normalize(surnameOf(one));
      return last === surname || last.endsWith(` ${surname}`) || surname.endsWith(` ${last}`);
    }),
  );
}

/**
 * Whether a record is the wanted book: the titles agree (one may add a subtitle the other leaves out), and when
 * the wanted title has an author, one of the record's authors has that last name. Without an author the whole
 * title must agree, since a short title alone ("Tubes") names many books. A bundle of several books never matches.
 */
export function isMatch(wanted: { title: string; author: string }, record: Record_): boolean {
  if (BUNDLE.test(record.title)) return false;
  const want = bare(wanted.title);
  const wantShort = bare(shortTitle(wanted.title));
  const got = bare(record.title);
  const gotShort = bare(shortTitle(record.title));
  if (!want || !got) return false;
  const surname = normalize(surnameOf(wanted.author));
  if (!surname) return got === want || gotShort === want;
  const titleAgrees = got === want || gotShort === wantShort || got === wantShort || gotShort === want || runsOn(got, wantShort);
  return titleAgrees && hasLastName(record.authors, surname);
}
