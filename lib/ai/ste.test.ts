import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractSections } from "@/lib/library/sections";
import { steCheck } from "./ste";

/**
 * M6: the TypeScript STE checker must give the same results as Samuel's
 * Python one (`prompts/ste/ste_check.py`) on the same inputs. This runs the
 * Python script on a few thousand inputs and compares every field.
 * Needs python3 (present in the cloud container and on GitHub's runners).
 */
type Case = { text: string; procedural: boolean };

const DRIVER = `
import json, sys
sys.path.insert(0, "prompts/ste")
from dataclasses import asdict
import ste_check
out = []
for c in json.load(sys.stdin):
    r = ste_check.analyse(c["text"], procedural=c["procedural"])
    out.append({"mode": r.mode, "sentence_limit": r.sentence_limit, "paragraphs": r.n_paragraphs,
                "sentences": r.n_sentences, "words": r.n_words, "errors": r.n_errors,
                "warnings": r.n_warnings, "compliance": round(r.compliance, 1),
                "findings": [asdict(f) for f in r.findings]})
json.dump(out, sys.stdout)
`;

function python(cases: Case[]) {
  const out = execFileSync("python3", ["-c", DRIVER], { input: JSON.stringify(cases), maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(out.toString("utf8"));
}

function compare(cases: Case[]) {
  const expected = python(cases);
  cases.forEach((c, i) => expect(steCheck(c.text, c.procedural), JSON.stringify(c.text.slice(0, 200))).toEqual(expected[i]));
}

const HAND: string[] = [
  "Close the valve.",
  "",
  "   \n\n  ",
  "The valve must be closed by the operator before the pump is started.",
  "The pump has been operating since the filter was removed, and it is running hot.",
  "Utilizing the main landing gear door actuator seal, we commence the procedure in order to verify the result.",
  "Dr. Smith said e.g. 3.5 mL is approx. enough. No. 4 is next. It's fine; don't worry.",
  "Removing the cover, check the housing. Turning slowly, the shaft stops; Opening it, look inside.",
  "Use and/or the 3/4 inch bolt. See https://example.com/a/b for more.",
  "- First item is shown here.\n- Second item was taken away by the operator who was walking past the open door slowly.",
  "1. Do this. 2) Do that.\n\n## Heading for the section\n\nA paragraph follows.",
  "```\ncode is ignored. It is being run.\n```\nText `inline code here` stays. | a | b |\n| c | d |\n---\nAfter the rule.",
  "One. Two. Three. Four. Five. Six. Seven sentences make this paragraph too long.",
  "While the sample was being heated, as the temperature rose, once it boiled, following the protocol, we waited.",
  "The monitor shows the impact of the reference interface action.",
  "Café owners utilise naïve methods. Ünits are ﬁne.",
  "He said \"Stop.\" Then he left. (Really.) 'Yes.' 4 more.",
  "Mr. and Mrs. Jones met Prof. Brown at St. Paul's, cf. fig. 2, etc. Then they left.",
  "The non breaking space test. A ﻿BOM here. And \x1cfile separator\x1d there.",
  "Line one of a paragraph\nline two of it continues\n\nnew paragraph here.",
  "\ttabbed start. Next one\r\nwith a carriage return.\r\n\r\nAnother paragraph.",
  "Was written, were driven, is chosen, am broken, be spoken, been frozen, being grown.",
  "Had done, have made, has given, had seen it. Has found nothing.",
  "The 12.5 V supply and the 3.3 V rail are both under 25 W.",
  "It is necessary to note that care should be taken with regard to the majority of the samples due to the fact that they are hot.",
];

// A small deterministic random source (mulberry32), so the fuzz cases are the same every run.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  "the", "valve", "is", "was", "being", "has", "been", "closed", "running", "operating", "landing", "gear", "door", "actuator",
  "seal", "Utilize", "since", "while", "as", "once", "following", "monitor", "in order to", "prior to", "can't", "it's",
  "Dr.", "e.g.", "i.e.", "No.", "etc.", "3.5", "12", "and/or", "3/4", "https://x.y/z", "`code`", "```", "|", "---", "-", "1.",
  "#", "##", "Removing", "Turning", "slowly", "quickly", "heated", "done", "made", "café", "naïve", " ", "﻿", "\x1c",
  ".", ".", ",", ";", "!", "?", "(", ")", "\"", "'", "*", "_", ">", "[", "]", "\n", "\n", "\n\n", "  ", "\t", "\r\n", "A", "The",
  "Sample", "Protein", "binding", "assay", "buffer", "solution", "temperature", "data", "analysis", "pipeline", "output",
  "😀", "İstanbul", "ǅ", "²", "٣", "Ⅻ",
];

function fuzz(n: number, seed: number): string[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const len = 1 + Math.floor(r() * 60);
    let s = "";
    for (let i = 0; i < len; i++) s += (r() < 0.75 ? " " : "") + PIECES[Math.floor(r() * PIECES.length)];
    return s;
  });
}

function bookParagraphs(file: string) {
  return extractSections(new Uint8Array(readFileSync(new URL(`../../fixtures/books/${file}`, import.meta.url))))
    .filter((s) => s.kind === "paragraph")
    .map((s) => s.text);
}

describe("STE checker: TypeScript port matches ste_check.py", () => {
  it("hand-written cases, in both modes", () => {
    compare(HAND.flatMap((text) => [{ text, procedural: false }, { text, procedural: true }]));
  });

  it("the STE skill's own Markdown files (code, tables, lists, headings)", () => {
    const files = ["SKILL.md", "rules.md", "substitutions.md", "README.md"].map((f) => readFileSync(`prompts/ste/${f}`, "utf8"));
    compare(files.flatMap((text) => [{ text, procedural: false }, { text, procedural: true }]));
  });

  it("every paragraph of three public-domain novels, and each novel's chapters as one text", () => {
    const books = ["stevenson-jekyll-and-hyde.epub", "wells-the-time-machine.epub", "shelley-frankenstein.epub"].map(bookParagraphs);
    const cases = books.flatMap((paras) => paras.map((text) => ({ text, procedural: false })));
    expect(cases.length).toBeGreaterThan(1400);
    cases.push(...books.map((paras) => ({ text: paras.join("\n\n"), procedural: true })));
    compare(cases);
  }, 60_000);

  it("2,000 random texts built from tricky pieces", () => {
    compare(fuzz(2000, 20261004).map((text, i) => ({ text, procedural: i % 3 === 0 })));
  }, 60_000);
});

describe("STE checker: what it reports", () => {
  it("scores clean STE at 100% and flags the classic problems", () => {
    expect(steCheck("Close the valve. Then remove the filter.")).toMatchObject({ compliance: 100, errors: 0, sentences: 2 });
    const r = steCheck("The pump has been operating since the filter was removed, and it is running hot.");
    expect(r.findings.map((f) => f.kind)).toEqual(["continuous_tense", "passive_voice", "ambiguous_word"]);
    expect(r.compliance).toBe(0);
  });
});
