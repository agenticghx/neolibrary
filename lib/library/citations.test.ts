import { describe, expect, it } from "vitest";
import { findCitations, forReader, numberLabel, readEntry, type CitationParagraph } from "./citations";

// An invented paper (no real one is in the repository): prose, then a reference list in printed (alphabetical) order.
const P = (id: string, text: string, chapterIndex = 0, form = "prose"): CitationParagraph => ({ id, cfi: `/6/2!/4/${id}`, chapterIndex, position: 0, text, form });
const LIST = [
  "Ames, B., and Bell, C.: Two works in one. J. Test. 1: 1–2, 1971.",
  "Bell, C.: Alone. J. Test. 2: 3–4, 1980.",
  "Cole, D., Dunn, E., and Ford, G.: Three of us. J. Test. 3: 5–6, 1990a.",
  "Cole, D., Ford, G., and Dunn, E.: Three again. J. Test. 4: 7–8, 1990b.",
  "Dunn, E.: A reply to Cole et al. (1990), in J. Test. 3: 5–6. J. Test. 5: 9–10, 1992.",
  "Eden, F.: First of two. J. Test. 6: 1–2, 1985.",
  "Eden, F.: Second of two. J. Test. 7: 3–4, 1985.",
  "Sühnel, J.: Accents. J. Test. 8: 1–2, 1990.",
  "Wolf T., and Unkel, H. D.: No comma before the initials. J. Test. 9: 1–2, 1984.",
  "IMSL: (1989). User's Manual [computer program manual]. Houston, TX: IMSL.",
];
const paper = (prose: string[]) => [
  ...prose.map((t, i) => P(`p${i}`, t)),
  P("eq", "E = (Ames, 1971)", 0, "equation"),
  P("h", "XII. References", 1),
  ...LIST.map((t, i) => P(`r${i + 1}`, t, 1)),
];
const labels = (prose: string[]) => findCitations(paper(prose)).citations.map((c) => c.label);

describe("reference list", () => {
  it("numbers every entry in printed order, from the heading on", () => {
    const r = findCitations(paper(["Nothing cited."]));
    expect(r.references.map((x) => [x.n, x.sectionId])).toEqual(LIST.map((_, i) => [i + 1, `r${i + 1}`]));
  });

  it("reads authors and year in the colon style and the APA style", () => {
    expect(readEntry(LIST[0])).toEqual({ surnames: ["Ames", "Bell"], year: "1971", letter: "" });
    expect(readEntry(LIST[2])).toEqual({ surnames: ["Cole", "Dunn", "Ford"], year: "1990", letter: "a" });
    expect(readEntry("Waud, D. R., & Parker, R. B. (1971). Pharmacological estimation. J. Pharm. 177, 1990–2001.")).toEqual({ surnames: ["Waud", "Parker"], year: "1971", letter: "" });
    // A year in brackets inside a title is not the entry's year; the last one printed is.
    expect(readEntry(LIST[4])?.year).toBe("1992");
    expect(readEntry(LIST[8])?.surnames).toEqual(["Wolf", "Unkel"]);
    expect(readEntry(LIST[9])).toEqual({ surnames: ["IMSL"], year: "1989", letter: "" });
  });

  it("finds the list from a chapter called References when no paragraph says so", () => {
    const paras = [P("p0", "As shown (Bell, 1980)."), ...LIST.map((t, i) => P(`r${i + 1}`, t, 1))];
    expect(findCitations(paras, [{ chapterIndex: 1, label: "References", href: "c1.xhtml" }]).citations.map((c) => c.label)).toEqual(["[2]"]);
  });

  it("finds nothing in a book without a reference list", () => {
    expect(findCitations([P("p0", "As shown (Bell, 1980).")])).toEqual({ references: [], citations: [], unmatched: [] });
    expect(forReader(findCitations([P("p0", "As shown (Bell, 1980).")]))).toBeNull();
  });
});

describe("citations in the prose", () => {
  it("numbers a citation in brackets, the whole bracket", () => {
    const text = "Synergy is old (Ames and Bell, 1971; Bell, 1980).";
    const [c] = findCitations(paper([text])).citations;
    expect(c.label).toBe("[1, 2]");
    expect(text.slice(c.start, c.end)).toBe("(Ames and Bell, 1971; Bell, 1980)");
  });

  it("numbers only the bracket of a citation in the sentence: Bell [2]", () => {
    const text = "As Bell (1980) showed, and Ames and Bell's (1971) too.";
    const r = findCitations(paper([text]));
    expect(r.citations.map((c) => [text.slice(c.start, c.end), c.label])).toEqual([
      ["(1980)", "[2]"],
      ["(1971)", "[1]"],
    ]);
  });

  it("drops a word before the names that is not a name", () => {
    expect(labels(["However, Ames and Bell (1971) did not."])).toEqual(["[1]"]);
  });

  it("matches et al. to three or more authors, with the year's letter", () => {
    expect(labels(["Seen (Cole et al., 1990a, b) and by Cole et al. (1990b)."])).toEqual(["[3, 4]", "[4]"]);
  });

  it("gives letters in printed order when the list prints none", () => {
    expect(labels(["Twice (Eden, 1985a; Eden, 1985b)."])).toEqual(["[6, 7]"]);
  });

  it("keeps words that open a citation: (e.g., [2])", () => {
    expect(labels(["Many (e.g., Bell, 1980)."])).toEqual(["(e.g., [2])"]);
  });

  it("matches names with or without accents, and a company", () => {
    expect(labels(["Both (Suehnel, 1990) and (IMSL, 1989), and Wolf and Unkel (1984)."])).toEqual(["[8]", "[10]", "[9]"]);
  });

  it("leaves as written a work the list does not hold, or holds twice, and counts it", () => {
    const r = findCitations(paper(["Missing (Ames, 1971), (Zed, 1999) and Eden (1985), all kept (Bell, 1980; Zed, 1999)."]));
    expect(r.citations).toEqual([]);
    expect(r.unmatched.map((u) => [u.text, u.why])).toEqual([
      ["(Ames, 1971)", "no entry"],
      ["(Zed, 1999)", "no entry"],
      ["(1985)", "two entries"],
      ["(Bell, 1980; Zed, 1999)", "no entry"],
    ]);
  });

  it("ignores brackets that are not citations, and equations", () => {
    const r = findCitations(paper(["See (Table 1), (Fig. 3, 1990 data) and (1995), at 20 °C (n = 12)."]));
    expect(r.citations).toEqual([]);
  });

  it("writes a run of three or more numbers as a range", () => {
    expect(numberLabel([9, 3, 7, 8, 3])).toBe("[3, 7–9]");
    expect(numberLabel([1, 2])).toBe("[1, 2]");
  });

  it("gives the reader each citation's entries as its tooltip", () => {
    const out = forReader(findCitations(paper(["As shown (Bell, 1980)."])))!;
    expect(out.cites[0]).toMatchObject({ label: "[2]", title: `2. ${LIST[1]}`, chapterIndex: 0 });
    expect(out.refs).toHaveLength(LIST.length);
    expect(out.unmatched).toBe(0);
  });
});
