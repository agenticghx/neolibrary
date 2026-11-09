/**
 * M43 S1 on Samuel's Claude subscription: a book's genealogy (who founded, led, worked at, left, bought, funded or
 * supplied whom; which company came out of which; each person's life in the order it happened), read chapter by
 * chapter on the laptop with `claude -p` (no API key, no API spending), checked, and drawn as one private page.
 *
 * Written for Samuel and the Claude sessions that run it. The whole workflow: .claude/skills/genealogy-on-subscription/SKILL.md.
 *
 *   npx tsx scripts/genealogy-on-subscription.ts fetch <site> <book id> <folder>   (the book's EPUB, with the owner's token)
 *   npx tsx scripts/genealogy-on-subscription.ts read <folder> [--chapters 3] [--jobs 5] [--model m] [--years-model m] [--min-links 1] [--known names.txt]
 *   npx tsx scripts/genealogy-on-subscription.ts page <folder>                      (genealogy.html from what has been read)
 *   npx tsx scripts/genealogy-on-subscription.ts status <folder>
 *   npx tsx scripts/genealogy-on-subscription.ts send <folder> <site> <book id>    (M43 S2: store it on the site, checked again there)
 *   npx tsx scripts/genealogy-on-subscription.ts payload <folder>                   (what send would post, to <folder>/send.json)
 *
 * Six readings, each one after the last, each checked in lib/library/genealogy.ts before it is used:
 * 1. Links, per chapter (prompts/genealogy-links.md): every link the chapter states, with the paragraph and a quote.
 *    A quote not found word for word in its paragraph is dropped.
 * 2. Names, once (prompts/genealogy-names.md): spellings of one name grouped, vague groups set aside.
 * 3. Second reading, per chapter (prompts/genealogy-check.md): each link holds, is corrected, or is removed.
 * 4. Dates, per chapter (prompts/genealogy-dates.md): a year with the words that give it, checked like a quote.
 * 5. Lives, per person (prompts/genealogy-life.md): links merged into events in the order they happened.
 * 6. Years the book leaves out, per person (prompts/genealogy-years.md): from general knowledge, kept apart.
 *
 * <folder> keeps the book and every raw answer (keep it out of git: the answers quote the book). The checks are run
 * again from the raw answers each time, so a change to them needs no new reading. A reading already done is skipped,
 * so a run can be stopped and started again; delete a stage's folder to read it again (and every stage after it,
 * since they are built on it).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { fill, readPrompt, splitPrompt } from "@/lib/ai/prompts";
import { parseEpub } from "@/lib/library/ebook";
import { applyChecks, checkDates, checkLife, checkLinks, checkYears, lastObject, mergeNames, numberChapters, readNames, signature, slug, type Chapter, type Link } from "@/lib/library/genealogy";
import { genealogyPromptHash, type GenealogySend, type SentLink } from "@/lib/library/genealogy-store";
import type { GenealogyView, GenealogyViewEvent, GenealogyViewKind, GenealogyViewLink } from "@/lib/library/genealogy-view";
import { extractPdfSections } from "@/lib/library/pdf-sections";
import { extractSections, type Section } from "@/lib/library/sections";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 1));
/** A chapter's answer file: named by the chapter's own id, so a change to which chapters are read never mixes answers up. */
const fileOf = (c: Chapter) => `${slug(c.key)}.json`;

/** One reading through `claude -p` on the subscription: the prompt's system part, its message, no tools. */
function claude(model: string, effort: string, system: string, user: string): Promise<string> {
  const args = ["-p", "--model", model, "--effort", effort, "--system-prompt", system, "--tools", "", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "", "--output-format", "json"];
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // the subscription, never the API
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: tmpdir(), env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      let r: { result?: string; is_error?: boolean } = {};
      try {
        r = JSON.parse(out);
      } catch {
        // reported below
      }
      if (code !== 0 || r.is_error || typeof r.result !== "string") return reject(new Error(`claude -p (${code}): ${String(r.result ?? err ?? out).slice(0, 300)}`));
      resolve(r.result);
    });
    child.stdin.end(user);
  });
}

/** Runs `fn` over `items`, `jobs` at a time; a failure is printed and the rest go on. */
async function pool<T>(items: T[], jobs: number, fn: (t: T) => Promise<string>) {
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < items.length) {
      const t = items[next++];
      try {
        console.log(await fn(t));
      } catch (e) {
        failed++;
        console.log(`FAILED ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, worker));
  return failed;
}

async function prompt(name: string) {
  return splitPrompt(await readPrompt(name));
}

/** Pages about the edition, not the book: their names are publishers and editors, not the book's people. */

/** The book's chapters as the app splits them (same paragraph ids), numbered by the rule the site uses (numberChapters). */
function chaptersOf(folder: string): { chapters: Chapter[]; parts: [number, string, string][] } {
  // A PDF's sections were split at fetch time (extractPdfSections is async) and saved beside it.
  const pdf = join(folder, "sections.json");
  const sections: Section[] = existsSync(pdf)
    ? readJson<Section[]>(pdf)
    : (() => {
        const bytes = new Uint8Array(readFileSync(join(folder, "book.epub")));
        return extractSections(bytes, parseEpub(bytes).toc as { label: string; href: string }[]);
      })();
  const byChapter = new Map<number, { key: string; label: string; paragraphs: { id: string; text: string }[] }>();
  for (const s of sections) {
    if (s.kind === "chapter") byChapter.set(s.chapterIndex, { key: s.id, label: s.label, paragraphs: [] });
    else if (s.kind === "paragraph" && s.text.trim() && s.form !== "equation") byChapter.get(s.chapterIndex)?.paragraphs.push({ id: s.id, text: s.text.replace(/\s+/g, " ").trim() });
  }
  const list = [...byChapter].sort((a, b) => a[0] - b[0]).map(([, c]) => ({ ...c, size: c.paragraphs.reduce((n, p) => n + p.text.length, 0) }));
  const { chapters, parts } = numberChapters(list);
  return { chapters: chapters.map((c) => ({ key: c.key, number: c.number, title: c.title, paragraphs: c.items.flatMap((i) => i.paragraphs) })), parts };
}

const passages = (c: Chapter) => c.paragraphs.map((p, i) => `<passage n="${i + 1}">${p.text}</passage>`).join("\n");
const said = (l: Link) => `${l.from} ${l.relation} ${l.to}`;

/** Everything read so far, checked again from the raw answers. Missing stages give empty results. */
function build(folder: string, chapters: Chapter[]) {
  const ans = (stage: string, name: string) => (existsSync(join(folder, stage, name)) ? readJson<{ answer: string }>(join(folder, stage, name)).answer : null);
  // Answers that refer to links by number are saved with what each number meant (a link's signature), so they still
  // match after an earlier stage is read again.
  let offered = 0;
  let dropped = 0;
  let read = 0;
  const firstLinks: Link[] = [];
  for (const c of chapters) {
    const a = ans("1-links", fileOf(c));
    if (a === null) continue;
    read++;
    const r = checkLinks(a, c);
    offered += r.kept.length + r.dropped.length;
    dropped += r.dropped.filter((d) => d.why.startsWith("quote")).length;
    firstLinks.push(...r.kept);
  }
  const namesAnswer = existsSync(join(folder, "2-names.json")) ? readJson<{ answer: string }>(join(folder, "2-names.json")).answer : null;
  const people = new Set(firstLinks.flatMap((l) => [l.from_kind === "person" ? l.from : "", l.to_kind === "person" ? l.to : ""]));
  const names = namesAnswer ? readNames(namesAnswer, new Set(firstLinks.flatMap((l) => [l.from, l.to])), (n) => people.has(n)) : { alias: new Map<string, string>(), vague: new Set<string>(), ignored: 0 };
  const merged = mergeNames(firstLinks, names.alias, names.vague);
  const answers = new Map<number, Record<string, unknown>>();
  const mergedAt = new Map(merged.links.map((l, i) => [signature(l), i]));
  for (const c of chapters) {
    const f = join(folder, "3-check", fileOf(c));
    if (!existsSync(f)) continue;
    const { answer, ids } = readJson<{ answer: string; ids: string[] }>(f);
    const obj = lastObject(answer, "checks");
    for (const x of Array.isArray(obj?.checks) ? (obj.checks as Record<string, unknown>[]) : []) {
      const at = mergedAt.get(ids[Number(String(x.id).replace(/^L/, ""))] ?? "");
      if (at !== undefined) answers.set(at, x);
    }
  }
  const checked = applyChecks(merged.links, answers, names.alias);
  const links = checked.kept;
  const dates = new Map<number, ReturnType<typeof checkDates>[number]>();
  const linkAt = new Map(links.map((l, i) => [signature(l), i]));
  for (const c of chapters) {
    const f = join(folder, "4-dates", fileOf(c));
    if (!existsSync(f)) continue;
    const { answer, ids } = readJson<{ answer: string; ids: string[] }>(f);
    for (const d of checkDates(answer, c, new Set(ids.map((_, k) => k)))) {
      const at = linkAt.get(ids[d.id]);
      if (d.checked && at !== undefined) dates.set(at, { ...d, id: at });
    }
  }
  const paragraph = (ch: number, p: number) => chapters[ch - 1]?.paragraphs[p - 1]?.text ?? null;
  const lives: Record<string, ReturnType<typeof checkLife>["events"]> = {};
  const lifeDropped = { year_without_fact: 0, order_quote_not_found: 0 };
  for (const p of peopleOf(links)) {
    const f = join(folder, "5-lives", `${slug(p.name)}.json`);
    if (!existsSync(f)) continue;
    const saved = readJson<{ answer: string; links: Record<string, string>; facts: Record<string, string> }>(f);
    // The answer's L… and D… ids, as they were when it was read, matched to today's list by what each link says.
    const now = (table: Record<string, string>, prefix: string) => (x: unknown) => {
      const at = linkAt.get(table[`${prefix}${String(x).replace(prefix, "")}`] ?? "");
      return at === undefined ? null : at;
    };
    const obj = lastObject(saved.answer, "events");
    const events = (Array.isArray(obj?.events) ? (obj.events as Record<string, unknown>[]) : []).map((e) => ({
      ...e,
      links: (Array.isArray(e.links) ? e.links : []).map(now(saved.links, "L")).filter((x) => x !== null),
      date_ids: (Array.isArray(e.date_ids) ? e.date_ids : []).map(now(saved.facts, "D")).filter((x) => x !== null),
    }));
    const { facts } = lifeInput(p.name, links, dates);
    const r = checkLife(JSON.stringify({ events }), new Set(p.ids), new Map(facts.map((i) => [i, dates.get(i)!.year!])), paragraph);
    lives[p.name] = r.events;
    lifeDropped.year_without_fact += r.dropped.year_without_fact;
    lifeDropped.order_quote_not_found += r.dropped.order_quote_not_found;
    const y = ans("6-years", `${slug(p.name)}.json`);
    if (y !== null) for (const g of checkYears(y, r.events)) Object.assign(r.events[g.i], { gk: { start_year: g.start_year, end_year: g.end_year, confidence: g.confidence, note: g.note } });
  }
  return { read, offered, dropped, names, merged, checked, links, dates, lives, lifeDropped };
}

/** People in the links, most linked first, with the ids of their links. */
function peopleOf(links: Link[]) {
  const m = new Map<string, number[]>();
  links.forEach((l, i) => {
    for (const [n, k] of [
      [l.from, l.from_kind],
      [l.to, l.to_kind],
    ] as const)
      if (k === "person") m.set(n, [...(m.get(n) ?? []), i]);
  });
  return [...m].map(([name, ids]) => ({ name, ids })).sort((a, b) => b.ids.length - a.ids.length);
}

/** What the lives reading is given for one person: their links, and the checked years of those links and of the founding, buying or spin-out of the organisations they were part of. */
function lifeInput(name: string, links: Link[], dates: Map<number, { year: number | null; end_year: number | null; quote: string | null }>) {
  const mine = links.map((l, i) => ({ l, i })).filter(({ l }) => l.from === name || l.to === name);
  const orgs = new Set(mine.map(({ l }) => (l.from === name ? l.to : l.from)));
  const facts = [...dates.keys()].filter((i) => {
    const l = links[i];
    return l.from === name || l.to === name || (["founded", "acquired", "spun_out_of"].includes(l.relation) && (orgs.has(l.from) || orgs.has(l.to)));
  });
  return { mine, facts };
}

async function read(folder: string) {
  const model = arg("model", "claude-sonnet-5-5");
  const yearsModel = arg("years-model", "claude-opus-5-5");
  const effort = arg("effort", "medium");
  const jobs = Number(arg("jobs", "5")) || 5;
  const minLinks = Number(arg("min-links", "1")) || 1;
  const atMost = Number(arg("chapters", "0")) || Infinity;
  const known = existsSync(arg("known", "")) ? readFileSync(arg("known", ""), "utf8").trim() : "none";
  const meta = existsSync(join(folder, "meta.json")) ? readJson<{ title: string }>(join(folder, "meta.json")) : { title: "the book" };
  const { chapters: all } = chaptersOf(folder);
  const chapters = all.slice(0, atMost === Infinity ? all.length : atMost);
  for (const d of ["1-links", "3-check", "4-dates", "5-lives", "6-years"]) mkdirSync(join(folder, d), { recursive: true });
  const todo = (stage: string, name: string) => !existsSync(join(folder, stage, name));
  let failed = 0;

  console.log(`1. Links: ${chapters.length} chapters.`);
  const p1 = await prompt("genealogy-links");
  failed += await pool(
    chapters.filter((c) => todo("1-links", fileOf(c))),
    jobs,
    async (c) => {
      const answer = await claude(model, effort, p1.system, fill(p1.user, { book: meta.title, chapter: `${c.number}. ${c.title}`, known, passages: passages(c) }));
      writeJson(join(folder, "1-links", fileOf(c)), { answer });
      const r = checkLinks(answer, c);
      return `  ${c.number}. ${c.title}: ${r.kept.length} links kept, ${r.dropped.length} dropped`;
    },
  );
  if (failed) return console.log(`${failed} readings failed: run again to retry them before going on.`);

  console.log("2. Names.");
  if (!existsSync(join(folder, "2-names.json"))) {
    const b = build(folder, chapters);
    const count = new Map<string, { kind: string; n: number }>();
    for (const l of b.merged.links)
      for (const [n, k] of [
        [l.from, l.from_kind],
        [l.to, l.to_kind],
      ])
        count.set(n, { kind: k, n: (count.get(n)?.n ?? 0) + 1 });
    const list = [...count].sort((a, b2) => a[0].localeCompare(b2[0])).map(([n, v]) => `${n} (${v.kind}, ${v.n} links)`);
    const p2 = await prompt("genealogy-names");
    const answer = await claude(model, effort, p2.system, fill(p2.user, { book: meta.title, names: list.join("\n") }));
    writeJson(join(folder, "2-names.json"), { answer });
    const r = readNames(answer, count.keys());
    console.log(`  ${r.alias.size} spellings grouped, ${r.vague.size} vague names set aside, ${r.ignored} suggestions ignored (names not read).`);
  }

  console.log("3. Second reading.");
  const b3 = build(folder, chapters);
  const p3 = await prompt("genealogy-check");
  failed += await pool(
    chapters.filter((c) => todo("3-check", fileOf(c)) && b3.merged.links.some((l) => l.chapter === c.number)),
    jobs,
    async (c) => {
      const mine = b3.merged.links.filter((l) => l.chapter === c.number).map((l, i) => ({ l, i }));
      const text = mine.map(({ l, i }) => `<link id="${i}">\n${l.from} (${l.from_kind}) —${l.relation}→ ${l.to} (${l.to_kind})\nquote: ${l.quote}\n<passage>${c.paragraphs[l.passage - 1].text}</passage>\n</link>`).join("\n\n");
      const answer = await claude(model, effort, p3.system, fill(p3.user, { book: meta.title, chapter: `${c.number}. ${c.title}`, links: text }));
      writeJson(join(folder, "3-check", fileOf(c)), { answer, ids: mine.map(({ l }) => signature(l)) });
      return `  ${c.number}. checked ${mine.length} links`;
    },
  );
  if (failed) return console.log(`${failed} readings failed: run again to retry them before going on.`);

  console.log("4. Dates.");
  const b4 = build(folder, chapters);
  const p4 = await prompt("genealogy-dates");
  failed += await pool(
    chapters.filter((c) => todo("4-dates", fileOf(c)) && b4.links.some((l) => l.chapter === c.number)),
    jobs,
    async (c) => {
      const mine = b4.links.filter((l) => l.chapter === c.number).map((l, i) => ({ l, i }));
      const text = mine.map(({ l, i }) => `id ${i}: ${said(l)} (passage ${l.passage}: "${l.quote}")`).join("\n");
      const answer = await claude(model, effort, p4.system, fill(p4.user, { book: meta.title, chapter: `${c.number}. ${c.title}`, passages: passages(c), links: text }));
      writeJson(join(folder, "4-dates", fileOf(c)), { answer, ids: mine.map(({ l }) => signature(l)) });
      const d = checkDates(answer, c, new Set(mine.map(({ i }) => i)));
      return `  ${c.number}. ${d.filter((x) => x.checked).length} of ${mine.length} links dated`;
    },
  );
  if (failed) return console.log(`${failed} readings failed: run again to retry them before going on.`);

  const b5 = build(folder, chapters);
  const people = peopleOf(b5.links).filter((p) => p.ids.length >= minLinks);
  console.log(`5. Lives: ${people.length} people with at least ${minLinks} link${minLinks === 1 ? "" : "s"}.`);
  const p5 = await prompt("genealogy-life");
  failed += await pool(
    people.filter((p) => todo("5-lives", `${slug(p.name)}.json`)),
    jobs,
    async (p) => {
      const { mine, facts } = lifeInput(p.name, b5.links, b5.dates);
      const keys = [...new Set(mine.map(({ l }) => `${l.chapter}:${l.passage}`))].map((k) => k.split(":").map(Number));
      const answer = await claude(
        model,
        effort,
        p5.system,
        fill(p5.user, {
          person: p.name,
          links: mine.map(({ l, i }) => `L${i}: ${said(l)} (chapter ${l.chapter}, passage ${l.passage})`).join("\n"),
          facts: facts.map((i) => `D${i}: ${said(b5.links[i])}: ${b5.dates.get(i)!.year}${b5.dates.get(i)!.end_year ? `–${b5.dates.get(i)!.end_year}` : ""} ("${b5.dates.get(i)!.quote}")`).join("\n") || "none",
          passages: keys.map(([c, n]) => `<passage chapter="${c}" n="${n}">${chapters[c - 1].paragraphs[n - 1].text}</passage>`).join("\n"),
        }),
      );
      const table = (ids: number[], prefix: string) => Object.fromEntries(ids.map((i) => [`${prefix}${i}`, signature(b5.links[i])]));
      writeJson(join(folder, "5-lives", `${slug(p.name)}.json`), { person: p.name, answer, links: table(mine.map(({ i }) => i), "L"), facts: table(facts, "D") });
      return `  ${p.name}: read`;
    },
  );
  if (failed) return console.log(`${failed} readings failed: run again to retry them before going on.`);

  console.log("6. Years the book leaves out (general knowledge).");
  const b6 = build(folder, chapters);
  const p6 = await prompt("genealogy-years");
  failed += await pool(
    Object.entries(b6.lives).filter(([n, evs]) => todo("6-years", `${slug(n)}.json`) && evs.some((e) => !e.start_year)),
    jobs,
    async ([name, evs]) => {
      const lines = evs.map((e, i) => {
        const l = b6.links[e.links[0]];
        return `${i}. ${said(l)}${e.role ? ` (${e.role})` : ""}: ${e.start_year ? `${e.start_year}${e.end_year ? `–${e.end_year}` : ""} (from the book)` : "no year in the book"}`;
      });
      const answer = await claude(yearsModel, effort, p6.system, fill(p6.user, { book: meta.title, person: name, events: lines.join("\n") }));
      writeJson(join(folder, "6-years", `${slug(name)}.json`), { person: name, answer });
      return `  ${name}: ${checkYears(answer, evs).filter((y) => y.start_year).length} years filled`;
    },
  );
  console.log(failed ? `${failed} readings failed: run again to retry them.` : "Every reading is done. Next: page.");
}

function page(folder: string) {
  const meta = existsSync(join(folder, "meta.json")) ? readJson<{ title: string }>(join(folder, "meta.json")) : { title: "Book" };
  const { chapters, parts } = chaptersOf(folder);
  const b = build(folder, chapters);
  const kinds = new Map<string, Map<GenealogyViewKind, number>>();
  for (const l of [...b.links, ...b.checked.removed])
    for (const [n, k] of [
      [l.from, l.from_kind],
      [l.to, l.to_kind],
    ] as const) {
      const m = kinds.get(n) ?? new Map<GenealogyViewKind, number>();
      m.set(k, (m.get(k) ?? 0) + 1);
      kinds.set(n, m);
    }
  const nodes = Object.fromEntries([...kinds].map(([n, m]) => [n, [...m].sort((x, y) => y[1] - x[1])[0][0]]));
  const count = new Map<string, number>();
  for (const l of b.links) for (const n of [l.from, l.to]) count.set(n, (count.get(n) ?? 0) + 1);
  const top = (pred: (n: string) => boolean) => [...count].filter(([n]) => pred(n)).sort((x, y) => y[1] - x[1]).map(([n]) => n).slice(0, 8);
  const lineage = new Set(b.links.filter((l) => l.from_kind === "organisation" && l.to_kind === "organisation" && ["spun_out_of", "acquired", "part_of"].includes(l.relation)).flatMap((l) => [l.from, l.to]));
  const usedDates = new Set(Object.values(b.lives).flatMap((evs) => evs.flatMap((e) => e.date_ids)));
  // The site's own view data (GenealogyView), so the page below is drawn by the site's own code: one copy of it.
  const shape = (l: (typeof b.links)[number]): GenealogyViewLink => ({ from: l.from, from_kind: l.from_kind, to: l.to, to_kind: l.to_kind, relation: l.relation, role: l.role, chapter: l.chapter, quote: l.quote, cfi: null, check: l.check ?? null, was: l.was ?? null, why: l.why ?? null, year: l.year });
  const data: GenealogyView = {
    book: meta.title,
    n: chapters.length,
    chapters: Object.fromEntries(chapters.map((c) => [c.number, c.title])),
    parts,
    at: chapters.length,
    model: `${arg("model", "claude-sonnet-5-5")}, on the subscription`,
    sentAt: new Date().toISOString(),
    nodes,
    links: b.links.map(shape),
    doubted: b.checked.removed.map(shape),
    lives: Object.fromEntries(
      Object.entries(b.lives).map(([n, evs]) => [
        n,
        evs.map((e) => ({ what: e.what, with: e.with, role: e.role, links: e.links, start_year: e.start_year, end_year: e.end_year, date_ids: e.date_ids, basis: e.basis, order_chapter: e.order_chapter, order_quote: e.order_quote, order_cfi: null, why: e.why, gk: (e as { gk?: GenealogyViewEvent["gk"] }).gk ?? null })),
      ]),
    ),
    dates: Object.fromEntries([...usedDates].filter((i) => b.dates.has(i)).map((i) => [i, { year: b.dates.get(i)!.year!, end_year: b.dates.get(i)!.end_year, quote: b.dates.get(i)!.quote!, chapter: b.links[i].chapter, cfi: null }])),
    top: { tree: top((n) => nodes[n] === "organisation" && lineage.has(n)), org: top((n) => nodes[n] === "organisation"), person: top((n) => nodes[n] === "person") },
  };
  const c = b.checked.counts as Record<string, number>;
  const stats = `How this page was made: ${b.read} chapters read; ${b.offered} links offered, ${b.dropped} left out because the quote is not in the book, ${b.names.alias.size} spellings grouped, ${b.merged.removed} links to vague names removed. The second reading kept ${c.holds ?? 0}, corrected ${c.fixed ?? 0} and removed ${(c.unsupported ?? 0) + (c.fix_unusable ?? 0)}. ${b.links.length} links shown, ${b.dates.size} with a year, ${Object.keys(b.lives).length} lives rebuilt.`;
  const out = join(folder, "genealogy.html");
  writeFileSync(out, pageHtml(data, stats));
  console.log(`${out}: ${stats} (${JSON.stringify(b.lifeDropped)} taken away by the checks.)`);
}

/**
 * The laptop page: one private file drawn by the Genealogy tab's own code (genealogy-views.ts, its types stripped)
 * in the site's tokens and the tab's styles, so the page and the site cannot drift apart. Opens from disk, no server.
 */
function pageHtml(data: GenealogyView, stats: string) {
  const app = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const views = app("app/(reader)/books/[id]/read/genealogy-views.ts");
  const js = ts.transpileModule(views, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^export /gm, "");
  const css = app("app/tokens.css") + app("app/(reader)/books/[id]/read/GenealogyView.module.css");
  // Nothing inside may close the <style> or <script> it sits in.
  const safe = (s: string) => s.replace(/<\/(script|style)/gi, "<\\/$1");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.book)}: genealogy</title>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">
<style>${safe(css)}
:root{--font-serif:"Source Serif 4","Iowan Old Style",georgia,serif;--font-sans:"Source Sans 3","Segoe UI","Helvetica Neue",arial,sans-serif}
body{margin:0;background:var(--paper)}
.stats{color:var(--ink-500);font-size:var(--text-sm);border-top:var(--border-hair) solid var(--rule);padding-top:var(--space-3)}
</style>
</head>
<body>
<div class="overlay"><div class="root" id="root"></div><div class="root"><p class="stats">${esc(stats)}</p></div></div>
<script type="application/json" id="data">${safe(JSON.stringify(data))}</script>
<script type="module">
${safe(js)}
mountGenealogy(document.getElementById("root"), JSON.parse(document.getElementById("data").textContent), { onGo: () => {}, onClose: () => {} });
</script>
</body>
</html>
`;
}

/** M43 S2: what `send` posts: every link (those the second reading removed marked so), dates and lives, by paragraph id. */
async function sendable(folder: string): Promise<GenealogySend> {
  const { chapters } = chaptersOf(folder);
  const b = build(folder, chapters);
  const pid = (chapter: number | null, passage: number | null) => (chapter && passage ? (chapters[chapter - 1]?.paragraphs[passage - 1]?.id ?? null) : null);
  const kept: SentLink[] = b.links.map((l, i) => {
    const d = b.dates.get(i);
    const dp = d ? pid(l.chapter, d.passage) : null;
    return { from: l.from, from_kind: l.from_kind, to: l.to, to_kind: l.to_kind, relation: l.relation, role: l.role, paragraph: l.paragraph, quote: l.quote, check: l.check ?? null, was: l.was ?? null, why: l.why ?? null, date: d && dp && d.year && d.quote ? { year: d.year, end_year: d.end_year, paragraph: dp, quote: d.quote } : null };
  });
  const removed: SentLink[] = b.checked.removed.map((l) => ({ from: l.from, from_kind: l.from_kind, to: l.to, to_kind: l.to_kind, relation: l.relation, role: l.role, paragraph: l.paragraph, quote: l.quote, removed: true, why: l.why }));
  const lives: GenealogySend["lives"] = {};
  for (const [person, evs] of Object.entries(b.lives))
    lives[person] = evs.map((e) => {
      const op = pid(e.order_chapter, e.order_passage);
      const gk = (e as { gk?: { start_year: number | null; end_year: number | null; confidence: "high" | "medium"; note: string | null } }).gk;
      return { what: e.what, with: e.with, role: e.role, links: e.links, start_year: e.start_year, end_year: e.end_year, date_links: e.date_ids, basis: e.basis, order: op && e.order_quote ? { paragraph: op, quote: e.order_quote } : null, why: e.why, gk: gk ?? null };
    });
  return { model: arg("model", "claude-sonnet-5-5"), promptHash: await genealogyPromptHash(), links: [...kept, ...removed], lives };
}

async function send(folder: string, site: string, bookId: string) {
  const t = process.env.NEOLIBRARY_AGENT_TOKEN;
  if (!t) throw new Error("NEOLIBRARY_AGENT_TOKEN is not set: make a token at /agents and run `keyadd NEOLIBRARY_AGENT_TOKEN` in Terminal, then run this in a login shell (zsh -ic).");
  const body = await sendable(folder);
  const res = await fetch(`${site.replace(/\/$/, "")}/api/agent/books/${bookId}/genealogy`, { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(out)}`);
  console.log(out.unchanged ? `Nothing changed: the site already holds this genealogy (${out.links} links, ${out.events} life events).` : `Stored: ${out.links} links, ${out.removed} removed by the second reading, ${out.events} life events for ${out.people} people. Left out by the site's own checks: ${JSON.stringify(out.dropped)}.`);
}

function status(folder: string) {
  const { chapters } = chaptersOf(folder);
  const n = (d: string) => (existsSync(join(folder, d)) ? readdirSync(join(folder, d)).length : 0);
  console.log(`${chapters.length} chapters. Links ${n("1-links")}, names ${existsSync(join(folder, "2-names.json")) ? "done" : "not yet"}, second reading ${n("3-check")}, dates ${n("4-dates")}, lives ${n("5-lives")}, years ${n("6-years")}.`);
}

async function fetchBook(site: string, bookId: string, folder: string) {
  const t = process.env.NEOLIBRARY_AGENT_TOKEN;
  if (!t) throw new Error("NEOLIBRARY_AGENT_TOKEN is not set: make a token at /agents and run `keyadd NEOLIBRARY_AGENT_TOKEN` in Terminal, then run this in a login shell (zsh -ic).");
  const base = `${site.replace(/\/$/, "")}/api/agent/books/${bookId}`;
  const info = await fetch(base, { headers: { authorization: `Bearer ${t}` } });
  const body = (await info.json().catch(() => ({}))) as { book?: { title: string; kind: string; scan?: boolean } };
  if (!info.ok || !body.book) throw new Error(`${info.status} ${JSON.stringify(body)}`);
  const isPdf = body.book.kind === "pdf" && !body.book.scan;
  if (body.book.kind !== "epub" && !isPdf) throw new Error(`${body.book.title} is a ${body.book.kind}${body.book.scan ? " scan" : ""}: read its text edition instead.`);
  const file = await fetch(`${base}/file`, { headers: { authorization: `Bearer ${t}` } });
  if (!file.ok) throw new Error(`file: ${file.status}`);
  mkdirSync(folder, { recursive: true });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const saved = join(folder, isPdf ? "book.pdf" : "book.epub");
  writeFileSync(saved, bytes);
  // A PDF is split now, as the site split it at upload (the same function, so the same paragraph ids).
  if (isPdf) writeJson(join(folder, "sections.json"), await extractPdfSections(bytes));
  writeJson(join(folder, "meta.json"), { title: body.book.title, bookId });
  console.log(`${body.book.title}: saved to ${saved}.`);
}

const [cmd, a1, a2, a3] = process.argv.slice(2);
const run = cmd === "payload" && a1 ? sendable(a1).then((b) => writeJson(join(a1, "send.json"), b)) : cmd === "send" && a3 ? send(a1, a2, a3) : cmd === "fetch" && a3 ? fetchBook(a1, a2, a3) : cmd === "read" && a1 ? read(a1) : cmd === "page" && a1 ? Promise.resolve(page(a1)) : cmd === "status" && a1 ? Promise.resolve(status(a1)) : null;
if (!run) {
  console.error("Usage: genealogy-on-subscription.ts fetch <site> <book id> <folder> | send <folder> <site> <book id> | payload <folder> | read <folder> [--chapters n] [--jobs 5] [--model m] [--years-model m] [--min-links 1] [--known file] | page <folder> | status <folder>");
  process.exit(2);
}
run.catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
