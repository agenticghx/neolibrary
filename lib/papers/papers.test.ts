import { describe, expect, it } from "vitest";
import { CataloguePapers, fromCrossref, fromPubmed } from "./catalogues";
import { authorLine, byline, parsePaperId, PaperLookupUnreachable } from "./model";

// M41 R3. The Greco record below is what Crossref and PubMed returned for the real paper (2026-11-02), cut down.
const CROSSREF_GRECO = {
  DOI: "10.1016/S0031-6997(25)06847-4",
  title: ["The search for synergy: a critical review from a response surface perspective."],
  author: [
    { given: "W R", family: "Greco" },
    { given: "G", family: "Bravo" },
    { given: "J C", family: "Parsons" },
  ],
  "container-title": ["Pharmacological Reviews"],
  "short-container-title": ["Pharmacological Reviews"],
  issued: { "date-parts": [[1995, 6]] },
};
const PUBMED_GRECO = {
  title: "The search for synergy: a critical review from a response surface perspective.",
  authors: [
    { name: "Greco WR", authtype: "Author" },
    { name: "Bravo G", authtype: "Author" },
    { name: "Parsons JC", authtype: "Author" },
  ],
  source: "Pharmacol Rev",
  pubdate: "1995 Jun",
  articleids: [
    { idtype: "pubmed", value: "7568331" },
    { idtype: "pii", value: "S0031-6997(25)06847-4" },
  ],
};

describe("a paper's id as pasted (M41 R3)", () => {
  it("reads a DOI in its usual forms, lower case, without a trailing full stop", () => {
    for (const s of ["10.1016/S0031-6997(25)06847-4", "doi:10.1016/s0031-6997(25)06847-4", " https://doi.org/10.1016/S0031-6997(25)06847-4. ", "https://dx.doi.org/10.1016/s0031-6997(25)06847-4"])
      expect(parsePaperId(s)).toEqual({ doi: "10.1016/s0031-6997(25)06847-4" });
  });
  it("reads a PubMed ID, alone, after PMID, or in a PubMed address", () => {
    for (const s of ["7568331", "PMID 7568331", "pmid:7568331", "https://pubmed.ncbi.nlm.nih.gov/7568331/"]) expect(parsePaperId(s)).toEqual({ pmid: "7568331" });
  });
  it("refuses anything else", () => {
    for (const s of ["", "search for synergy", "11.1016/x", "10.12/x", "PMID", "https://example.com/7568331"]) expect(parsePaperId(s)).toBeNull();
  });
});

describe("a paper's card line", () => {
  const a = (family: string) => ({ family, given: "" });
  it("names up to three authors, then the first and 'et al.'", () => {
    expect(authorLine([])).toBe("");
    expect(authorLine([a("Greco")])).toBe("Greco");
    expect(authorLine([a("Greco"), a("Bravo")])).toBe("Greco and Bravo");
    expect(authorLine([a("Greco"), a("Bravo"), a("Parsons")])).toBe("Greco, Bravo and Parsons");
    expect(authorLine([a("Greco"), a("Bravo"), a("Parsons"), a("Smith")])).toBe("Greco et al.");
  });
  it("joins authors, year and journal, leaving out what is missing", () => {
    expect(byline({ authors: [a("Greco"), a("Bravo"), a("Parsons")], year: 1995, journal: "Pharmacol Rev" })).toBe("Greco, Bravo and Parsons · 1995 · Pharmacol Rev");
    expect(byline({ authors: [], year: null, journal: "Nature" })).toBe("Nature");
  });
});

describe("Crossref and PubMed records", () => {
  it("reads Crossref's record", () => {
    expect(fromCrossref(CROSSREF_GRECO)).toEqual({
      title: "The search for synergy: a critical review from a response surface perspective",
      authors: [
        { family: "Greco", given: "W R" },
        { family: "Bravo", given: "G" },
        { family: "Parsons", given: "J C" },
      ],
      journal: "Pharmacological Reviews",
      year: 1995,
      doi: "10.1016/s0031-6997(25)06847-4",
      pmid: null,
      source: "crossref",
    });
    expect(fromCrossref({ title: [] })).toBeNull();
  });
  it("reads PubMed's record: family names before initials, the journal's short name", () => {
    expect(fromPubmed("7568331", PUBMED_GRECO)).toMatchObject({
      authors: [
        { family: "Greco", given: "WR" },
        { family: "Bravo", given: "G" },
        { family: "Parsons", given: "JC" },
      ],
      journal: "Pharmacol Rev",
      year: 1995,
      doi: null,
      pmid: "7568331",
    });
    expect(fromPubmed("1", { title: "X", authors: [{ name: "WHO Study Group", authtype: "CollectiveName" }, { name: "van der Berg A" }], articleids: [{ idtype: "doi", value: "10.1/ABC" }] })).toMatchObject({
      authors: [{ family: "van der Berg", given: "A" }],
      doi: "10.1/abc",
    });
  });
});

describe("the catalogues, asked through a stand-in fetch (no network)", () => {
  const respond = (routes: Record<string, unknown>, fail?: string) =>
    (async (url: string | URL | Request) => {
      const u = String(url);
      if (fail && u.includes(fail)) throw new TypeError("fetch failed");
      for (const [part, body] of Object.entries(routes)) if (u.includes(part)) return new Response(JSON.stringify(body), { status: 200 });
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

  it("asks PubMed for a PubMed ID", async () => {
    const lookup = new CataloguePapers(respond({ "esummary.fcgi": { result: { "7568331": PUBMED_GRECO } } }));
    expect(await lookup.find({ pmid: "7568331" })).toMatchObject({ journal: "Pharmacol Rev", source: "pubmed" });
  });

  it("asks Crossref for a DOI, and takes PubMed's ID and journal name when PubMed knows the DOI", async () => {
    const lookup = new CataloguePapers(
      respond({ "api.crossref.org": { message: CROSSREF_GRECO }, "esearch.fcgi": { esearchresult: { idlist: ["7568331"] } }, "esummary.fcgi": { result: { "7568331": PUBMED_GRECO } } }),
    );
    expect(await lookup.find({ doi: "10.1016/s0031-6997(25)06847-4" })).toMatchObject({ pmid: "7568331", journal: "Pharmacol Rev", source: "crossref" });
  });

  it("keeps Crossref's answer when PubMed has nothing or cannot be reached", async () => {
    const none = new CataloguePapers(respond({ "api.crossref.org": { message: CROSSREF_GRECO }, "esearch.fcgi": { esearchresult: { idlist: [] } } }));
    expect(await none.find({ doi: "10.1016/s0031-6997(25)06847-4" })).toMatchObject({ pmid: null, journal: "Pharmacological Reviews" });
    const down = new CataloguePapers(respond({ "api.crossref.org": { message: CROSSREF_GRECO } }, "eutils"));
    expect(await down.find({ doi: "10.1016/s0031-6997(25)06847-4" })).toMatchObject({ pmid: null });
  });

  it("says when a paper is not there, and when a catalogue cannot be reached", async () => {
    expect(await new CataloguePapers(respond({})).find({ doi: "10.5555/none" })).toBeNull();
    await expect(new CataloguePapers(respond({}, "crossref")).find({ doi: "10.5555/none" })).rejects.toBeInstanceOf(PaperLookupUnreachable);
  });
});
