import { describe, expect, it } from "vitest";
import type { AgentXrayEntry } from "@/lib/agent/library";
import { type BookFindings, readXrayAnswer, report, xrayQuestion, xraySample } from "./live-check";

const entry = (name: string, mentions: number, facts = 6): AgentXrayEntry => ({
  name,
  kind: "person",
  aliases: [],
  mentions,
  facts: Array.from({ length: facts }, (_, i) => ({ chapter: i, fact: `${name} fact ${i}`, quote: `${name} said ${i}`, cfi: "epubcfi(/6/2)" })),
});

describe("the live-site check (M40 S5)", () => {
  it("judges the most mentioned entries, with a few facts each", () => {
    const entries = Array.from({ length: 30 }, (_, i) => entry(`N${i}`, i));
    const sample = xraySample(entries);
    expect(sample).toHaveLength(20);
    expect(sample[0].name).toBe("N29");
    expect(sample.at(-1)!.name).toBe("N10");
    expect(sample[0].facts).toHaveLength(4);
    expect(sample[0].facts[0]).toEqual({ fact: "N29 fact 0", quote: "N29 said 0" });
    const q = xrayQuestion({ title: "A Book", author: "An Author" }, entries);
    expect(q).toContain("Book: A Book by An Author");
    expect(q).toContain('"name": "N29"');
    expect(q).not.toContain("N9");
  });

  it("reads the answer, keeps only well-formed problems about names it asked about, and refuses a non-JSON answer", () => {
    const answer = '```json\n{"problems":[{"name":"Utterson","what":"kind","why":"A person, not a place."},{"name":"Nobody","what":"name","why":"x"},{"name":"Poole","what":"fact","fact":"Poole is a doctor","why":"The quote says he is a butler."},{"name":"Poole","what":"colour","why":"?"},{"name":"Poole","what":"name","why":"  "}]}\n```';
    expect(readXrayAnswer(answer, ["Utterson", "Poole"])).toEqual([
      { name: "Utterson", what: "kind", why: "A person, not a place." },
      { name: "Poole", what: "fact", fact: "Poole is a doctor", why: "The quote says he is a butler." },
    ]);
    expect(readXrayAnswer('{"problems":[]}', ["A"])).toEqual([]);
    expect(() => readXrayAnswer("All entries look fine.", ["A"])).toThrow(/not JSON/);
    expect(() => readXrayAnswer('{"ok":true}', ["A"])).toThrow(/no problems list/);
  });

  it("reports only what looks wrong, grouped, and one line on what was checked", () => {
    const base = (title: string, over: Partial<BookFindings> = {}, book: Partial<BookFindings["book"]> = {}): BookFindings => ({
      book: { id: title, title, author: "", kind: "epub", scan: false, textEdition: null, cover: { has: true, source: "file", catalogue: null, checkedAt: null }, ...book },
      fileOk: true,
      xrayEntries: 0,
      xrayChecked: 0,
      xrayProblems: [],
      ...over,
    });
    const all = report("2026-11-01", "site", [
      base("Fine"),
      base("Broken file", { fileOk: false, fileStatus: 404 }),
      base("Scan", {}, { kind: "pdf", scan: true }),
      base("Scan with edition", {}, { kind: "pdf", scan: true, textEdition: "e" }),
      base("No cover", {}, { cover: { has: false, source: null, catalogue: null, checkedAt: null } }),
      base("X", { xrayEntries: 40, xrayChecked: 20, xrayProblems: [{ name: "Poole", what: "fact", fact: "a doctor", why: "He is a butler." }] }),
    ]);
    expect(all).toContain("## Books whose file does not open\n\n- Broken file: the file answered 404");
    expect(all).toContain("## Scanned books with no text edition yet\n\n- Scan\n");
    expect(all).not.toContain("- Scan with edition");
    expect(all).toContain("## Books with no cover picture\n\n- No cover\n");
    expect(all).toContain('- **Poole** (fact: "a doctor"): He is a butler.');
    expect(all).not.toContain("- Fine");
    expect(all).toContain("Checked on site: 6 books' files; 20 X-ray entries in 1 book.");
    expect(report("2026-11-01", "site", [base("Fine")])).toContain("Nothing looks wrong.");
  });
});
