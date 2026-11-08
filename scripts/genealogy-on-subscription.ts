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
import { fill, readPrompt, splitPrompt } from "@/lib/ai/prompts";
import { parseEpub } from "@/lib/library/ebook";
import { applyChecks, checkDates, checkLife, checkLinks, checkYears, lastObject, mergeNames, readNames, signature, slug, type Chapter, type Link } from "@/lib/library/genealogy";
import { extractSections } from "@/lib/library/sections";

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
const BACK_MATTER = /^(imprint|colophon|uncopyright|copyright|contents|table of contents|index|notes|endnotes|bibliography|acknowledg|about the (author|publisher)|also by|(more )?praise|dedication|title page|cover|half title)\b/i;

/** The book's chapters as the app splits them (same paragraph ids); chapters with almost no text are left out. */
function chaptersOf(folder: string): { chapters: Chapter[]; parts: [number, string, string][] } {
  const bytes = new Uint8Array(readFileSync(join(folder, "book.epub")));
  const toc = parseEpub(bytes).toc as { label: string; href: string }[];
  const sections = extractSections(bytes, toc);
  const byChapter = new Map<number, { key: string; label: string; paragraphs: { id: string; text: string }[] }>();
  for (const s of sections) {
    if (s.kind === "chapter") byChapter.set(s.chapterIndex, { key: s.id, label: s.label, paragraphs: [] });
    else if (s.kind === "paragraph" && s.text.trim() && s.form !== "equation") byChapter.get(s.chapterIndex)?.paragraphs.push({ id: s.id, text: s.text.replace(/\s+/g, " ").trim() });
  }
  const chapters: Chapter[] = [];
  const parts: [number, string, string][] = [];
  let pendingPart: string | null = null;
  for (const [, c] of [...byChapter].sort((a, b) => a[0] - b[0])) {
    const size = c.paragraphs.reduce((n, p) => n + p.text.length, 0);
    if (/^part\b/i.test(c.label) && size < 1500) pendingPart = c.label;
    if (size < 500 || BACK_MATTER.test(c.label.trim())) continue;
    chapters.push({ key: c.key, number: chapters.length + 1, title: c.label || `Chapter ${chapters.length + 1}`, paragraphs: c.paragraphs });
    if (pendingPart) {
      const m = pendingPart.match(/^part\s+([^\s:.]+)[\s:.]*(.*)$/i);
      parts.push([chapters.length, m?.[1] ?? String(parts.length + 1), m?.[2] || pendingPart]);
      pendingPart = null;
    }
  }
  if (!parts.length) for (let i = 1; i <= chapters.length; i += 10) parts.push([i, `${i}–${Math.min(i + 9, chapters.length)}`, `Chapters ${i} to ${Math.min(i + 9, chapters.length)}`]);
  return { chapters, parts };
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
  const kinds = new Map<string, Map<string, number>>();
  for (const l of [...b.links, ...b.checked.removed])
    for (const [n, k] of [
      [l.from, l.from_kind],
      [l.to, l.to_kind],
    ]) {
      const m = kinds.get(n) ?? new Map<string, number>();
      m.set(k, (m.get(k) ?? 0) + 1);
      kinds.set(n, m);
    }
  const nodes = Object.fromEntries([...kinds].map(([n, m]) => [n, [...m].sort((x, y) => y[1] - x[1])[0][0]]));
  const count = new Map<string, number>();
  for (const l of b.links) for (const n of [l.from, l.to]) count.set(n, (count.get(n) ?? 0) + 1);
  const top = (pred: (n: string) => boolean) => [...count].filter(([n]) => pred(n)).sort((x, y) => y[1] - x[1]).map(([n]) => n).slice(0, 8);
  const lineage = new Set(b.links.filter((l) => l.from_kind === "organisation" && l.to_kind === "organisation" && ["spun_out_of", "acquired", "part_of"].includes(l.relation)).flatMap((l) => [l.from, l.to]));
  const usedDates = new Set(Object.values(b.lives).flatMap((evs) => evs.flatMap((e) => e.date_ids)));
  const data = {
    book: meta.title,
    n: chapters.length,
    chapters: Object.fromEntries(chapters.map((c) => [c.number, c.title])),
    parts,
    stats: {
      chapters: b.read,
      offered: b.offered,
      dropped: b.dropped,
      merged: b.names.alias.size,
      vague: b.merged.removed,
      checked: b.checked.counts,
      dated: b.dates.size,
      lives: Object.keys(b.lives).length,
    },
    nodes,
    links: b.links,
    doubted: b.checked.removed,
    lives: b.lives,
    dates: Object.fromEntries([...usedDates].filter((i) => b.dates.has(i)).map((i) => [i, { year: b.dates.get(i)!.year, end_year: b.dates.get(i)!.end_year, quote: b.dates.get(i)!.quote, chapter: b.links[i].chapter, passage: b.dates.get(i)!.passage }])),
    top: { tree: top((n) => nodes[n] === "organisation" && lineage.has(n)), org: top((n) => nodes[n] === "organisation"), person: top((n) => nodes[n] === "person") },
  };
  const template = readFileSync(join(process.cwd(), "scripts", "genealogy-page.html"), "utf8");
  const out = join(folder, "genealogy.html");
  writeFileSync(out, template.replace("/*DATA*/null", JSON.stringify(data).replace(/<\//g, "<\\/")));
  console.log(`${out}: ${b.read} chapters, ${b.offered} links offered, ${b.dropped} quotes not in the book, ${b.names.alias.size} spellings grouped, ${b.merged.removed} links to vague names removed;`);
  console.log(`second reading ${JSON.stringify(b.checked.counts)}; ${b.links.length} links shown; ${b.dates.size} dated; ${data.stats.lives} lives (${JSON.stringify(b.lifeDropped)} taken away by the checks).`);
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
  if (body.book.kind !== "epub") throw new Error(`${body.book.title} is a ${body.book.kind}${body.book.scan ? " scan" : ""}: read its text edition (or an EPUB) instead.`);
  const file = await fetch(`${base}/file`, { headers: { authorization: `Bearer ${t}` } });
  if (!file.ok) throw new Error(`file: ${file.status}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "book.epub"), new Uint8Array(await file.arrayBuffer()));
  writeJson(join(folder, "meta.json"), { title: body.book.title, bookId });
  console.log(`${body.book.title}: saved to ${join(folder, "book.epub")}.`);
}

const [cmd, a1, a2, a3] = process.argv.slice(2);
const run = cmd === "fetch" && a3 ? fetchBook(a1, a2, a3) : cmd === "read" && a1 ? read(a1) : cmd === "page" && a1 ? Promise.resolve(page(a1)) : cmd === "status" && a1 ? Promise.resolve(status(a1)) : null;
if (!run) {
  console.error("Usage: genealogy-on-subscription.ts fetch <site> <book id> <folder> | read <folder> [--chapters n] [--jobs 5] [--model m] [--years-model m] [--min-links 1] [--known file] | page <folder> | status <folder>");
  process.exit(2);
}
run.catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
