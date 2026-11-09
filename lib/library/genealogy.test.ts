import { describe, expect, it } from "vitest";
import { applyChecks, checkDates, checkLife, checkLinks, checkYears, lastObject, mergeNames, numberChapters, PDF_CHAPTER_CHARS, readNames, slug, type Chapter, type Link } from "./genealogy";

const ch: Chapter = {
  key: "ch-3",
  number: 3,
  title: "The Integrated Circuit",
  paragraphs: [
    { id: "p1", text: "In 1957, eight engineers left Shockley Semiconductor and decided to found their own company, Fairchild Semiconductor." },
    { id: "p2", text: "Three years later, Robert Noyce was running Fairchild’s research." },
  ],
};
const answer = (links: unknown[]) => JSON.stringify({ links });
const fairchild = { from: "Fairchild Semiconductor", from_kind: "organisation", to: "Shockley Semiconductor", to_kind: "organisation", relation: "spun_out_of", role: null, year: 1957, passage: 1, quote: "left Shockley Semiconductor and decided to found their own company, Fairchild Semiconductor", note: "x" };

describe("lastObject", () => {
  it("takes the model's last word when it corrects itself, and ignores braces in prose", () => {
    const text = `{"links":[{"a":1}]}\n\nCorrection: that {one} was wrong.\n{"links":[{"a":2}]}`;
    expect(lastObject(text, "links")).toEqual({ links: [{ a: 2 }] });
  });
  it("reads braces inside strings as text", () => {
    expect(lastObject(`{"links":[{"quote":"a } b { c"}]}`, "links")).toEqual({ links: [{ quote: "a } b { c" }] });
  });
  it("is null when no object has the key", () => {
    expect(lastObject(`{"other":1} no json here`, "links")).toBeNull();
  });
});

describe("checkLinks", () => {
  it("keeps a link whose quote is in its paragraph, with the book's own characters", () => {
    const { kept, dropped } = checkLinks(answer([{ ...fairchild, quote: "Fairchild's research", passage: "2", from: "Robert Noyce", from_kind: "person", to: "Fairchild Semiconductor", relation: "led" }]), ch);
    expect(dropped).toEqual([]);
    expect(kept[0]).toMatchObject({ passage: 2, paragraph: "p2", chapter: 3, quote: "Fairchild’s research" });
  });
  it("drops a changed quote, a quote from the wrong paragraph, an unknown relation and a self-link", () => {
    const { kept, dropped } = checkLinks(
      answer([
        { ...fairchild, quote: "left Shockley Semiconductor and chose to found" },
        { ...fairchild, passage: 2 },
        { ...fairchild, relation: "descended_from" },
        { ...fairchild, to: "Fairchild Semiconductor" },
        fairchild,
      ]),
      ch,
    );
    expect(kept).toHaveLength(1);
    expect(dropped.map((d) => d.why)).toEqual(["quote not in the paragraph", "quote not in the paragraph", "relation not in the list: descended_from", "a name linked to itself"]);
  });
});

const link = (from: string, relation: Link["relation"], to: string, extra: Partial<Link> = {}): Link => ({
  from,
  from_kind: "organisation",
  to,
  to_kind: "organisation",
  relation,
  role: null,
  year: null,
  chapter: 1,
  passage: 1,
  paragraph: "p1",
  quote: "q",
  note: null,
  origin: `${from}|${relation}|${to}|p1`,
  ...extra,
});

describe("names", () => {
  it("groups only names that were read, keeps the first group for a name, and sets aside vague ones", () => {
    const names = ["TSMC", "Taiwan Semiconductor Manufacturing Company", "Fairchild", "Fairchild Semiconductor", "China's semiconductor efforts"];
    const r = readNames(
      JSON.stringify({ same: [{ name: "TSMC", others: ["Taiwan Semiconductor Manufacturing Company", "Made Up Inc"] }, { name: "Fairchild Semiconductor", others: ["Fairchild", "TSMC"] }], vague: ["China's semiconductor efforts", "Nowhere"] }),
      names,
    );
    expect([...r.alias]).toEqual([
      ["Taiwan Semiconductor Manufacturing Company", "TSMC"],
      ["Fairchild", "Fairchild Semiconductor"],
    ]);
    expect([...r.vague]).toEqual(["China's semiconductor efforts"]);
    expect(r.ignored).toBe(3);
    const merged = mergeNames([link("Taiwan Semiconductor Manufacturing Company", "supplied", "Apple"), link("Fairchild", "spun_out_of", "Fairchild Semiconductor"), link("China's semiconductor efforts", "funded", "SMIC")], r.alias, r.vague);
    expect(merged.links.map((l) => `${l.from} ${l.to}`)).toEqual(["TSMC Apple"]);
    expect(merged.removed).toBe(2);
  });
});

describe("names of people", () => {
  it("keeps a person's fullest name even when the reading chose a short one, and leaves organisations as chosen", () => {
    const r = readNames(JSON.stringify({ same: [{ name: "Bob Noyce", others: ["Robert Noyce"] }, { name: "TSMC", others: ["Taiwan Semiconductor Manufacturing Company"] }] }), ["Bob Noyce", "Robert Noyce", "TSMC", "Taiwan Semiconductor Manufacturing Company"], (n) => n.includes("Noyce"));
    expect([...r.alias]).toEqual([
      ["Bob Noyce", "Robert Noyce"],
      ["Taiwan Semiconductor Manufacturing Company", "TSMC"],
    ]);
  });
  it("keeps a link's origin through renaming and correction", () => {
    const [l] = mergeNames([link("Bob Noyce", "founded", "Intel", { from_kind: "person" })], new Map([["Bob Noyce", "Robert Noyce"]]), new Set()).links;
    const fixed = applyChecks([l], new Map([[0, { verdict: "fix", link: { from: "Robert Noyce", relation: "led", to: "Intel" } }]])).kept[0];
    expect([fixed.from, fixed.relation, fixed.origin]).toEqual(["Robert Noyce", "led", "Bob Noyce|founded|Intel|p1"]);
  });
});

describe("applyChecks", () => {
  it("keeps, corrects (turning a link round) or removes, and refuses a correction about other names", () => {
    const links = [link("AT&T", "part_of", "Bell Labs"), link("Intel", "spun_out_of", "Fairchild Semiconductor"), link("TI", "acquired", "Micron"), link("Nokia", "part_of", "Alcatel-Lucent"), link("Joe Davis", "funded", "TI")];
    const answers = new Map<number, Record<string, unknown>>([
      [0, { verdict: "fix", why: "AT&T owned Bell Labs.", link: { from: "Bell Labs", relation: "part_of", to: "AT&T" } }],
      [1, { verdict: "holds" }],
      [2, { verdict: "fix", link: { from: "Micron", relation: "bought_part_of", to: "TI" } }],
      [3, { verdict: "fix", link: { from: "Nokia", relation: "acquired", to: "Siemens" } }],
      [4, { verdict: "unsupported", why: "The passage does not say Davis paid." }],
    ]);
    const r = applyChecks(links, answers);
    expect(r.kept.map((l) => `${l.from} ${l.relation} ${l.to}`)).toEqual(["Bell Labs part_of AT&T", "Intel spun_out_of Fairchild Semiconductor", "Micron bought_part_of TI"]);
    expect(r.kept[0].was).toBe("AT&T part_of Bell Labs");
    expect(r.counts).toEqual({ holds: 1, fixed: 2, unsupported: 1, fix_unusable: 1, unchecked: 0 });
    expect(r.removed.map((l) => l.from)).toEqual(["Nokia", "Joe Davis"]);
  });
});

describe("checkDates", () => {
  it("keeps a year only with words found in the paragraph named, and ignores links it was not given", () => {
    const d = checkDates(
      JSON.stringify({
        dates: [
          { id: 7, year: 1957, basis: "stated", date_passage: 1, date_quote: "In 1957, eight engineers left" },
          { id: 8, year: 1960, basis: "worked_out", date_passage: "2", date_quote: "Three years later" },
          { id: 9, year: 1961, basis: "stated", date_passage: 2, date_quote: "In 1961 Noyce" },
          { id: 99, year: 1900, date_passage: 1, date_quote: "In 1957" },
        ],
      }),
      ch,
      new Set([7, 8, 9]),
    );
    expect(d.map((x) => [x.id, x.year, x.checked])).toEqual([
      [7, 1957, true],
      [8, 1960, true],
      [9, null, false],
    ]);
  });
});

describe("checkLife", () => {
  const para = (c: number, p: number) => (c === 3 && p === 1 ? ch.paragraphs[0].text : null);
  it("takes away a year with no dated fact, keeps an order quote found in its paragraph, and drops events with no known link", () => {
    const r = checkLife(
      JSON.stringify({
        events: [
          { what: "founded", with: "Fairchild Semiconductor", links: ["L1"], start_year: 1957, date_ids: ["D1"], basis: "stated" },
          { what: "left", with: "Shockley Semiconductor", links: [2], start_year: 1956, date_ids: [], basis: "stated" },
          { what: "worked_at", with: "Fairchild Semiconductor", links: [3], basis: "ordered", order_quote: "left Shockley Semiconductor", order_chapter: 3, order_passage: 1 },
          { what: "led", with: "Intel", links: [4], basis: "ordered", order_quote: "then ran Intel", order_chapter: 3, order_passage: 1 },
          { what: "led", with: "Nowhere", links: [55] },
        ],
      }),
      new Set([1, 2, 3, 4]),
      new Map([[1, 1957]]),
      para,
    );
    expect(r.events.map((e) => [e.with, e.start_year, e.basis])).toEqual([
      ["Fairchild Semiconductor", 1957, "stated"],
      ["Shockley Semiconductor", null, "unknown"],
      ["Fairchild Semiconductor", null, "ordered"],
      ["Intel", null, "unknown"],
    ]);
    expect(r.dropped).toEqual({ year_without_fact: 1, order_quote_not_found: 1 });
  });
});

describe("checkYears", () => {
  it("fills only years the book leaves out, and only with a stated confidence", () => {
    const events = [{ start_year: 1968 }, { start_year: null }, { start_year: null }, { start_year: null }];
    const r = checkYears(
      JSON.stringify({ years: [{ i: 0, start_year: 1970, confidence: "high" }, { i: 1, start_year: 1957, end_year: 1968, confidence: "high" }, { i: 2, start_year: 1959, confidence: "low" }, { i: 3, start_year: null, note: "Order looks wrong." }] }),
      events,
    );
    expect(r).toEqual([
      { i: 1, start_year: 1957, end_year: 1968, confidence: "high", note: null },
      { i: 3, start_year: null, end_year: null, confidence: "medium", note: "Order looks wrong." },
    ]);
  });
});

it("slug makes a file name of a person's name", () => {
  expect(slug("Morris Chang")).toBe("Morris-Chang");
  expect(slug("K. T. Li")).toBe("K-T-Li");
});

describe("numberChapters (one rule for the skill and the site)", () => {
  it("numbers an EPUB's chapters, leaving out short pages and the edition's own, and starts a part at a short Part page", () => {
    const { chapters, parts } = numberChapters([
      { label: "Copyright", size: 900 },
      { label: "Part I: Beginnings", size: 300 },
      { label: "The First", size: 9000 },
      { label: "A note", size: 200 },
      { label: "The Second", size: 8000 },
    ]);
    expect(chapters.map((c) => [c.number, c.title, c.items.length])).toEqual([
      [1, "The First", 1],
      [2, "The Second", 1],
    ]);
    expect(parts).toEqual([[1, "I", "Beginnings"]]);
  });

  it("leaves out About the author pages (one author or several, in any case) and lists of sources", () => {
    // The Pay Off's last page, "ABOUT THE AUTHORS", was numbered chapter 36 until 2026-11-09.
    const { chapters } = numberChapters([
      { label: "The Only Chapter", size: 9000 },
      { label: "About the Author", size: 900 },
      { label: "ABOUT THE AUTHORS", size: 1200 },
      { label: "About the Publishers", size: 700 },
      { label: "Sources", size: 40000 }, // The Pay Off's last numbered page after the fix above
      { label: "References", size: 30000 },
      { label: "Further Reading", size: 3000 },
    ]);
    expect(chapters.map((c) => c.title)).toEqual(["The Only Chapter"]);
  });

  it("groups a PDF's pages into chapters of about a book chapter's length, blank pages skipped, a short tail joined to the last", () => {
    const page = (n: number, size: number) => ({ label: `Page ${n}`, size, index: n - 1 });
    const pages = [page(1, 0), ...Array.from({ length: 18 }, (_, i) => page(i + 2, 3000)), page(20, 1000)];
    const { chapters, parts } = numberChapters(pages);
    expect(chapters.map((c) => c.title)).toEqual(["Pages 2–7", "Pages 8–13", "Pages 14–20"]);
    expect(chapters[0].size).toBeGreaterThanOrEqual(PDF_CHAPTER_CHARS);
    expect(chapters.flatMap((c) => c.items.map((i) => i.index))).toEqual(pages.slice(1).map((p) => p.index)); // every page with text, once, in order
    expect(parts).toEqual([[1, "1–3", "Chapters 1 to 3"]]);
  });
});
