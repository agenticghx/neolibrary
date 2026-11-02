import type { PaperAuthor } from "@/lib/db/schema";

/**
 * Where a paper's details come from (M41 R3, ground rule 3: an interface with a fake). Crossref answers for a DOI
 * (the permanent identifier a journal gives each article) and PubMed for a PubMed ID; both are free and need no key.
 * The fake answers in tests.
 */
export type PaperId = { doi: string } | { pmid: string };

export type PaperDetails = {
  title: string;
  authors: PaperAuthor[];
  /** The journal, short form when the catalogue has one ("Pharmacol Rev"). */
  journal: string | null;
  year: number | null;
  doi: string | null;
  pmid: string | null;
  /** Which catalogue answered (for the page's credit line). */
  source: "crossref" | "pubmed" | "fake";
};

export interface PaperLookup {
  /** The paper with this id; null when the catalogue has no such paper. Throws PaperLookupUnreachable when it cannot be asked. */
  find(id: PaperId): Promise<PaperDetails | null>;
}

export class PaperLookupUnreachable extends Error {
  constructor(what: string) {
    super(`${what} could not be reached. Try again in a minute.`);
  }
}

/**
 * A DOI or a PubMed ID as a reader may paste it: "10.1016/…", "doi:10.1016/…", "https://doi.org/10.1016/…",
 * "PMID: 7568331", "7568331", or a PubMed address. Null for anything else.
 */
export function parsePaperId(input: string): PaperId | null {
  const s = input.trim();
  const doi = /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i.exec(s)?.[1];
  if (doi) return { doi: doi.replace(/[.,;]+$/, "").toLowerCase() };
  const pmid = /^(?:pmid:?\s*|https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/)?(\d{1,9})\/?$/i.exec(s)?.[1];
  if (pmid) return { pmid: String(Number(pmid)) };
  return null;
}

/**
 * How a paper is named on its card: "Greco, Bravo and Parsons", "Smith and Jones", "Lee et al." (four or more
 * authors), then the year and the journal, joined by " · ". Empty parts are left out.
 */
export function byline(p: { authors: PaperAuthor[]; year: number | null; journal: string | null }): string {
  return [authorLine(p.authors), p.year ? String(p.year) : "", p.journal ?? ""].filter(Boolean).join(" · ");
}

export function authorLine(authors: PaperAuthor[]): string {
  const names = authors.map((a) => a.family).filter(Boolean);
  if (names.length >= 4) return `${names[0]} et al.`;
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
