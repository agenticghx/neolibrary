import type { PaperDetails, PaperId, PaperLookup } from "./model";

/**
 * Papers for tests (no network). The Greco, Bravo and Parsons review is a real record (Crossref and PubMed give
 * these details), so a check by eye on a local copy shows the real card; the "10.5555/" DOIs are Crossref's own
 * prefix for examples, with invented details.
 */
export const GRECO: PaperDetails = {
  title: "The search for synergy: a critical review from a response surface perspective",
  authors: [
    { family: "Greco", given: "W R" },
    { family: "Bravo", given: "G" },
    { family: "Parsons", given: "J C" },
  ],
  journal: "Pharmacol Rev",
  year: 1995,
  doi: "10.1016/s0031-6997(25)06847-4",
  pmid: "7568331",
  source: "fake",
};

export const EXAMPLE: PaperDetails = {
  title: "Lamplight and the reading of small print",
  authors: [
    { family: "Wick", given: "Iris" },
    { family: "Keeper", given: "Ann" },
  ],
  journal: "J Example Stud",
  year: 2021,
  doi: "10.5555/12345678",
  pmid: null,
  source: "fake",
};

export class FakePapers implements PaperLookup {
  readonly asked: PaperId[] = [];
  async find(id: PaperId): Promise<PaperDetails | null> {
    this.asked.push(id);
    for (const p of [GRECO, EXAMPLE]) if (("doi" in id && p.doi === id.doi) || ("pmid" in id && p.pmid === id.pmid)) return p;
    return null;
  }
}
