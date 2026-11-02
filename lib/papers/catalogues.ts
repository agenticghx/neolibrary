import type { PaperAuthor } from "@/lib/db/schema";
import { PaperLookupUnreachable, type PaperDetails, type PaperId, type PaperLookup } from "./model";

/**
 * Crossref (a DOI) and PubMed (a PubMed ID), both free and keyless. A DOI's paper is also looked for in PubMed, for its
 * PubMed ID and the journal's short name ("Pharmacol Rev"); if PubMed has nothing or cannot be reached, Crossref's
 * answer stands alone.
 */
const CROSSREF = "https://api.crossref.org/works/";
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
// Crossref asks callers to say who they are (its "polite pool"); no personal address in this public repository.
const HEADERS = { "User-Agent": "Neolibrary/1.0 (https://github.com/agenticghx/neolibrary)", Accept: "application/json" };
const TIMEOUT_MS = 10_000;

type Fetch = typeof fetch;

export class CataloguePapers implements PaperLookup {
  constructor(private readonly get: Fetch = fetch) {}

  async find(id: PaperId): Promise<PaperDetails | null> {
    if ("pmid" in id) return this.pubmed(id.pmid);
    const found = await this.crossref(id.doi);
    if (!found) return null;
    const pmid = await this.pmidForDoi(id.doi).catch(() => null);
    const pm = pmid ? await this.pubmed(pmid).catch(() => null) : null;
    return pm ? { ...found, pmid, journal: pm.journal ?? found.journal } : found;
  }

  private async json(url: string, what: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.get(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new PaperLookupUnreachable(what);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new PaperLookupUnreachable(what);
    return res.json();
  }

  private async crossref(doi: string): Promise<PaperDetails | null> {
    const body = (await this.json(CROSSREF + encodeURIComponent(doi), "Crossref")) as { message?: CrossrefWork } | null;
    return body?.message ? fromCrossref(body.message) : null;
  }

  private async pmidForDoi(doi: string): Promise<string | null> {
    const body = (await this.json(`${EUTILS}esearch.fcgi?db=pubmed&retmode=json&term=${encodeURIComponent(`${doi}[doi]`)}`, "PubMed")) as {
      esearchresult?: { idlist?: string[] };
    } | null;
    const ids = body?.esearchresult?.idlist ?? [];
    return ids.length === 1 ? ids[0] : null;
  }

  private async pubmed(pmid: string): Promise<PaperDetails | null> {
    const body = (await this.json(`${EUTILS}esummary.fcgi?db=pubmed&retmode=json&id=${encodeURIComponent(pmid)}`, "PubMed")) as {
      result?: Record<string, PubmedSummary>;
    } | null;
    const r = body?.result?.[pmid];
    return r && !r.error && r.title ? fromPubmed(pmid, r) : null;
  }
}

export type CrossrefWork = {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  "container-title"?: string[];
  "short-container-title"?: string[];
  issued?: { "date-parts"?: (number | null)[][] };
};

export function fromCrossref(w: CrossrefWork): PaperDetails | null {
  const title = tidyTitle(w.title?.[0] ?? "");
  if (!title) return null;
  const authors: PaperAuthor[] = (w.author ?? [])
    .map((a) => ({ family: (a.family ?? a.name ?? "").trim(), given: (a.given ?? "").trim() }))
    .filter((a) => a.family);
  const year = w.issued?.["date-parts"]?.[0]?.[0] ?? null;
  return {
    title,
    authors,
    journal: w["short-container-title"]?.[0] || w["container-title"]?.[0] || null,
    year: typeof year === "number" ? year : null,
    doi: w.DOI ? w.DOI.toLowerCase() : null,
    pmid: null,
    source: "crossref",
  };
}

export type PubmedSummary = {
  error?: string;
  title?: string;
  authors?: { name: string; authtype?: string }[];
  source?: string;
  pubdate?: string;
  articleids?: { idtype: string; value: string }[];
};

export function fromPubmed(pmid: string, r: PubmedSummary): PaperDetails | null {
  const title = tidyTitle(r.title ?? "");
  if (!title) return null;
  // PubMed writes "Greco WR": the family name, then the initials. A group author ("WHO Study Group") stays whole.
  const authors = (r.authors ?? [])
    .filter((a) => !a.authtype || a.authtype === "Author")
    .map((a) => {
      const m = /^(.*\S)\s+([A-Z]{1,4})$/.exec(a.name.trim());
      return m ? { family: m[1], given: m[2] } : { family: a.name.trim(), given: "" };
    })
    .filter((a) => a.family);
  const year = Number(/\d{4}/.exec(r.pubdate ?? "")?.[0]);
  const doi = r.articleids?.find((a) => a.idtype === "doi")?.value ?? null;
  return { title, authors, journal: r.source || null, year: year || null, doi: doi ? doi.toLowerCase() : null, pmid, source: "pubmed" };
}

/** A catalogue title without its closing full stop, its markup (<i>…</i>) or doubled spaces. */
export function tidyTitle(t: string): string {
  return t
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
}
