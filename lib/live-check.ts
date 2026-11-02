/**
 * M40 S5: the live-site checks a session runs instead of asking Samuel ("open Chip War, check twenty X-ray entries by
 * eye; turn down poor covers; does every book open?"). The parts here are the ones that need no network: what to ask
 * Claude about a book's X-ray, how to read its answer, and the report. scripts/live-check.ts does the fetching.
 * Written for Claude sessions; the report is written for Samuel and lists only what looks wrong.
 */
import type { AgentBookDetails, AgentXrayEntry } from "@/lib/agent/library";

/** How many of a book's X-ray entries are judged: the most mentioned, as Samuel would look at the top of the list. */
export const XRAY_SAMPLE = 20;

export const XRAY_JUDGE_SYSTEM = `You check a book's index of people, places and terms (its "X-ray") for a reader.
You get the book's title and author, and entries as JSON: each has a name, a kind (person, place, organisation, term,
work, event, or name when unsure), aliases, and facts, each with the book's own words ("quote") it rests on.
For each entry, decide only from what is given (never from what you know of the book):
- "name": is it a real person, place, organisation, term, work or event of the book, not a fragment, a common word,
  a heading, or two names run together?
- "kind": is the kind right for the name, as the facts and quotes show?
- each fact: does its quote say it? A fact that adds what the quote does not say is unsupported.
Answer with JSON only, no prose: {"problems":[{"name":"<entry name>","what":"name"|"kind"|"fact","fact":"<the fact,
for a fact problem>","why":"<one plain sentence>"}]}. An entry with no problem is left out. {"problems":[]} if all is well.`;

export type XrayProblem = { name: string; what: "name" | "kind" | "fact"; fact?: string; why: string };

/** The entries sent for judging: the most mentioned, each with at most `facts` facts, so one answer stays short. */
export function xraySample(entries: AgentXrayEntry[], size = XRAY_SAMPLE, facts = 4) {
  return [...entries]
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, size)
    .map((e) => ({ name: e.name, kind: e.kind, aliases: e.aliases, facts: e.facts.slice(0, facts).map((f) => ({ fact: f.fact, quote: f.quote })) }));
}

export function xrayQuestion(book: { title: string; author: string }, entries: AgentXrayEntry[]) {
  return `Book: ${book.title}${book.author ? ` by ${book.author}` : ""}\n\nEntries:\n${JSON.stringify(xraySample(entries), null, 1)}`;
}

/** Reads Claude's answer: the problems it found, only for names that were asked about; anything else is an error. */
export function readXrayAnswer(text: string, asked: string[]): XrayProblem[] {
  const body = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`The answer is not JSON: ${body.slice(0, 120)}`);
  }
  const list = (parsed as { problems?: unknown }).problems;
  if (!Array.isArray(list)) throw new Error("The answer has no problems list.");
  const names = new Set(asked);
  return list.flatMap((p): XrayProblem[] => {
    const x = p as Partial<XrayProblem>;
    if (typeof x.name !== "string" || !names.has(x.name)) return [];
    if (x.what !== "name" && x.what !== "kind" && x.what !== "fact") return [];
    if (typeof x.why !== "string" || !x.why.trim()) return [];
    return [{ name: x.name, what: x.what, ...(typeof x.fact === "string" && x.what === "fact" ? { fact: x.fact } : {}), why: x.why.trim() }];
  });
}

export type BookFindings = {
  book: Pick<AgentBookDetails, "id" | "title" | "author" | "kind" | "scan" | "textEdition" | "cover">;
  fileOk: boolean;
  fileStatus?: number;
  xrayEntries: number;
  xrayChecked: number;
  xrayProblems: XrayProblem[];
  xrayError?: string;
};

/** Samuel's report: what looks wrong, by kind of problem, then one line on what was checked. Nothing else. */
export function report(date: string, site: string, found: BookFindings[]) {
  const lines: string[] = [`# Live-site check, ${date}`, "", `Written for Samuel by scripts/live-check.ts (M40 S5). Only what looks wrong is listed.`, ""];
  const files = found.filter((f) => !f.fileOk);
  const scans = found.filter((f) => f.book.scan && !f.book.textEdition);
  const covers = found.filter((f) => f.book.kind && !f.book.cover.has);
  const xray = found.filter((f) => f.xrayProblems.length || f.xrayError);
  if (files.length) {
    lines.push("## Books whose file does not open", "");
    for (const f of files) lines.push(`- ${f.book.title}: the file answered ${f.fileStatus ?? "nothing"}`);
    lines.push("");
  }
  if (xray.length) {
    lines.push("## X-ray entries that look wrong", "");
    for (const f of xray) {
      lines.push(`### ${f.book.title}`, "");
      if (f.xrayError) lines.push(`- Could not be checked: ${f.xrayError}`);
      for (const p of f.xrayProblems) lines.push(`- **${p.name}** (${p.what}${p.fact ? `: "${p.fact}"` : ""}): ${p.why}`);
      lines.push("");
    }
  }
  if (scans.length) {
    lines.push("## Scanned books with no text edition yet", "");
    for (const f of scans) lines.push(`- ${f.book.title}`);
    lines.push("");
  }
  if (covers.length) {
    lines.push("## Books with no cover picture", "");
    for (const f of covers) lines.push(`- ${f.book.title}`);
    lines.push("");
  }
  if (!files.length && !xray.length && !scans.length && !covers.length) lines.push("Nothing looks wrong.", "");
  const checked = found.filter((f) => f.xrayChecked).length;
  const entries = found.reduce((n, f) => n + f.xrayChecked, 0);
  lines.push(`Checked on ${site}: ${found.length} ${found.length === 1 ? "book's file" : "books' files"}; ${entries} X-ray ${entries === 1 ? "entry" : "entries"} in ${checked} ${checked === 1 ? "book" : "books"}.`);
  return lines.join("\n") + "\n";
}
