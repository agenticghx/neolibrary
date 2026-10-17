/**
 * Side by side: the same AI jobs on two Claude models, on a copy of the live
 * library, for choosing each feature's model (2026-10-17). Paid: it calls the
 * real API and stops itself before `--budget` dollars (default 0.90).
 *
 * Loads users, books and sections from a backup (`pg_dump` plain SQL) into an
 * in-memory database, picks `--books` (default 5) of the first reader's EPUBs
 * and PDFs, most recently opened first, one chapter (a PDF: one page) and one
 * paragraph in each, and runs
 * the app's own code: a rewrite of the paragraph in the book's style, then
 * Test yourself and Need to know for the chapter, while the budget allows.
 * Writes report.html and results.json to the output folder, which holds book
 * text: keep it out of git (ground rule 1).
 *
 * Usage (from the repository root, ANTHROPIC_API_KEY set):
 *   npx tsx scripts/compare-models.ts <backup.sql> <output folder> [--budget 0.9] [--books 5]
 * Or on the reader's Claude subscription instead of the API (no key; the
 * costs shown are what the API would have charged, and --budget is ignored):
 *   npx tsx scripts/compare-models.ts <backup.sql> <output folder> --cli
 * `claude -p` adds about 1,400 tokens of its own to each prompt, and replies
 * with JSON through a tool, so its token counts run a little above the API's.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { ClaudeModel } from "@/lib/ai/claude";
import type { Caps, Generation } from "@/lib/ai/generate";
import { AiError, type TextModel, type TextRequest, type TextResult } from "@/lib/ai/model";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Db } from "@/lib/db/client";
import { migrateUp } from "@/lib/db/migrate";
import * as schema from "@/lib/db/schema";
import { books, sections, users } from "@/lib/db/schema";
import { getStyles } from "@/lib/library/ai-style";
import { rewriteFor } from "@/lib/library/levels";
import { estimateNeedToKnow, needToKnow } from "@/lib/library/prerequisites";
import { estimateQuestionBank, questionBank } from "@/lib/library/questions";
import { estimateRewrite, rewriteParagraph } from "@/lib/library/rewrite";

const MODELS = ["claude-opus-5-5", "claude-haiku-5-5"];
const TABLES = ["users", "books", "sections"];
// Our own budget guard is the real limit; the app's caps would count the copy's past spending.
const NO_CAPS: Caps = { perBookUsd: 1e6, perMonthUsd: 1e6 };

const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};

/** The data of one table's COPY block in a plain-SQL dump, and its column list. */
function copyBlock(dump: string, table: string) {
  const m = new RegExp(`^COPY public\\.${table} \\(([^)]*)\\) FROM stdin;\\n([\\s\\S]*?)^\\\\\\.$`, "m").exec(dump);
  if (!m) throw new Error(`No data for ${table} in the backup.`);
  return { columns: m[1], data: m[2] };
}

/**
 * A model reached through `claude -p` on the reader's subscription: the same
 * system prompt, prompt, effort and JSON schema, no tools, run in an empty
 * folder so no project instructions are read.
 */
class ClaudeCliModel implements TextModel {
  readonly provider = "anthropic";
  private static dir = mkdtempSync(join(tmpdir(), "compare-models-"));
  constructor(readonly model: string) {}

  generate(req: TextRequest): Promise<TextResult> {
    const args = ["-p", "--model", this.model, "--system-prompt", req.system, "--tools", "", "--effort", req.effort];
    args.push("--no-session-persistence", "--strict-mcp-config", "--setting-sources", "", "--output-format", "json");
    if (req.schema) args.push("--json-schema", JSON.stringify(req.schema));
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    return new Promise((resolve, reject) => {
      const child = spawn("claude", args, { cwd: ClaudeCliModel.dir, env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => {
        try {
          const r = JSON.parse(stdout);
          if (code !== 0 || r.is_error) throw new AiError(`claude -p failed (${code}): ${String(r.result ?? stderr).slice(0, 300)}`);
          const u = r.usage ?? {};
          const text = r.structured_output !== undefined ? JSON.stringify(r.structured_output) : String(r.result ?? "").trim();
          if (!text) throw new AiError("claude -p returned no text.");
          resolve({
            text,
            model: Object.keys(r.modelUsage ?? {})[0] ?? this.model,
            inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
            outputTokens: u.output_tokens ?? 0,
          });
        } catch (e) {
          reject(e instanceof AiError ? e : new AiError(`claude -p (${code}): ${(stderr || stdout).slice(0, 300)}`));
        }
      });
      child.stdin.end(req.prompt);
    });
  }
}

type Job = { order: number; book: string; chapter: string; feature: string; original: string; results: Result[] };
type Result = { model: string; answeredBy?: string; output?: string; error?: string; inputTokens: number; outputTokens: number; costUsd: number; seconds: number };

async function main() {
  const [backup, out] = process.argv.slice(2);
  const cli = process.argv.includes("--cli");
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!backup || !out) throw new Error("Usage: npx tsx scripts/compare-models.ts <backup.sql> <output folder> [--cli]");
  if (!key && !cli) throw new Error("Set ANTHROPIC_API_KEY, or pass --cli to use the Claude subscription.");
  const budget = cli ? Infinity : Number(arg("budget", "0.9"));
  const makeModel = (name: string): TextModel => (cli ? new ClaudeCliModel(name) : new ClaudeModel(key!, name));
  const want = Number(arg("books", "5"));

  // An in-memory database with today's tables, then the backup's rows for the three tables used.
  const client = new PGlite();
  await client.waitReady;
  await migrateUp({
    exec: async (sql) => void (await client.exec(sql)),
    transaction: async (sql) => void (await client.transaction((tx) => tx.exec(sql))),
    query: async (sql, params = []) => (await client.query(sql, params)).rows as never,
    close: () => client.close(),
  });
  const dump = readFileSync(backup, "utf8");
  await client.exec("SET session_replication_role = replica");
  for (const t of TABLES) {
    const { columns, data } = copyBlock(dump, t);
    await client.query(`COPY public.${t} (${columns}) FROM '/dev/blob'`, [], { blob: new Blob([data]) });
  }
  await client.exec("SET session_replication_role = DEFAULT");
  const db = drizzle(client, { schema }) as unknown as Db;

  const [reader] = await db.select().from(users).orderBy(asc(users.createdAt)).limit(1);
  const shelf = await db
    .select()
    .from(books)
    .where(and(eq(books.ownerId, reader.id), inArray(books.fileType, ["epub", "pdf"]), isNull(books.deletedAt)))
    .orderBy(desc(books.lastOpenedAt));

  let spent = 0;
  const jobs: Job[] = [];
  const picked: { book: (typeof shelf)[number]; chapter: typeof sections.$inferSelect; paragraph: typeof sections.$inferSelect; text: string }[] = [];
  for (const book of shelf) {
    if (picked.length >= want) break;
    const all = await db.select().from(sections).where(eq(sections.bookId, book.id)).orderBy(asc(sections.position));
    // Past the front matter: an EPUB chapter of 4,000 to 40,000 characters, or a PDF page (its "chapter") of
    // at least 1,500 from page 16 on; with a paragraph of 400 to 2,000.
    const pdf = book.fileType === "pdf";
    for (const chapter of all.filter((s) => s.kind === "chapter" && s.chapterIndex >= (pdf ? 15 : 2))) {
      const paras = all.filter((s) => s.kind === "paragraph" && s.chapterIndex === chapter.chapterIndex);
      const text = paras.map((p) => p.text).join("\n");
      const paragraph = paras.find((p) => p.text.length >= 400 && p.text.length <= 2000);
      if (text.length >= (pdf ? 1500 : 4000) && text.length <= 40000 && paragraph) {
        picked.push({ book, chapter, paragraph, text });
        break;
      }
    }
  }
  console.log(`Picked ${picked.length} chapters from ${shelf.length} books (EPUB and PDF).`);

  // One job: estimate, then each model (at once on the subscription; one after another on the API, for the budget).
  const run = async (job: Job, estimate: (m: TextModel) => Promise<number>, call: (m: TextModel) => Promise<{ generation: Generation }>) => {
    const models = MODELS.map(makeModel);
    const est = (await Promise.all(models.map(estimate))).reduce((a, b) => a + b, 0);
    if (spent + est > budget) {
      console.log(`Skipped ${job.feature} on ${job.book}: estimate $${est.toFixed(3)} would pass the $${budget} budget ($${spent.toFixed(3)} spent).`);
      return;
    }
    const one = async (m: TextModel): Promise<Result> => {
      const started = Date.now();
      try {
        const { generation: g } = await call(m);
        const p = g.provenance;
        spent += p.costUsd;
        return { model: m.model, answeredBy: p.model, output: g.output, inputTokens: p.inputTokens, outputTokens: p.outputTokens, costUsd: p.costUsd, seconds: (Date.now() - started) / 1000 };
      } catch (e) {
        return { model: m.model, error: String((e as Error).message), inputTokens: 0, outputTokens: 0, costUsd: 0, seconds: (Date.now() - started) / 1000 };
      }
    };
    if (cli) job.results.push(...(await Promise.all(models.map(one))));
    else for (const m of models) job.results.push(await one(m));
    jobs.push(job);
    console.log(`${job.feature} on ${job.book}: ${job.results.map((r) => `${r.model} $${r.costUsd.toFixed(4)} ${r.seconds.toFixed(1)} s${r.error ? ` ERROR ${r.error}` : ""}`).join("; ")}. Spent $${spent.toFixed(3)}.`);
  };

  const tasks: (() => Promise<void>)[] = [];
  for (const p of picked) {
    const w = rewriteFor((await getStyles(db, reader.id, p.book.id)).effective);
    const level = w.level;
    const strictness = w.level === "ste" ? w.strictness : "standard";
    const order = tasks.length;
    tasks.push(() =>
      run(
        { order, book: p.book.title, chapter: p.chapter.label, feature: `Rewrite (${level}${level === "ste" ? `, ${strictness}` : ""})`, original: p.paragraph.text, results: [] },
        (m) => estimateRewrite(db, m, reader.id, p.book.id, p.paragraph.id, level, strictness),
        (m) => rewriteParagraph(db, m, reader.id, { bookId: p.book.id, sectionId: p.paragraph.id, level, strictness, fresh: true }, { caps: NO_CAPS }),
      ),
    );
  }
  // Alternating, so both features are tried before the budget runs out.
  for (const p of picked) {
    for (const [feature, estimate, call] of [
      ["Test yourself", estimateQuestionBank, questionBank],
      ["Need to know", estimateNeedToKnow, needToKnow],
    ] as const) {
      const order = tasks.length;
      tasks.push(() =>
        run(
          { order, book: p.book.title, chapter: p.chapter.label, feature, original: `${p.text.length.toLocaleString()} characters of chapter text`, results: [] },
          (m) => estimate(db, m, reader.id, p.book.id, p.chapter),
          (m) => call(db, m, reader.id, { bookId: p.book.id, chapterId: p.chapter.id, fresh: true }, { caps: NO_CAPS }),
        ),
      );
    }
  }
  // Four jobs at a time on the subscription; one at a time on the API, so the budget check sees every cost.
  const queue = [...tasks];
  await Promise.all(Array.from({ length: cli ? 4 : 1 }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) await t();
  }));
  jobs.sort((a, b) => a.order - b.order);

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "results.json"), JSON.stringify({ spentUsd: spent, budgetUsd: budget, jobs }, null, 2));
  writeFileSync(join(out, "report.html"), report(jobs, spent, cli));
  console.log(`Spent $${spent.toFixed(4)} of $${budget}. Report: ${join(out, "report.html")}`);
  process.exit(0);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** An answer as readable HTML: prose as paragraphs, Test yourself and Need to know as lists. */
function show(output: string) {
  try {
    const j = JSON.parse(output);
    if (Array.isArray(j.questions)) return `<ol>${j.questions.map((q: Record<string, string>) => `<li><b>${esc(q.type ?? "")}</b> ${esc(q.question ?? "")}<br><i>${esc(q.answer ?? "")}</i></li>`).join("")}</ol>`;
    if (Array.isArray(j.concepts)) return `<ul>${j.concepts.map((c: Record<string, string>) => `<li><b>${esc(c.name ?? "")}</b>: ${esc(c.explanation ?? "")}</li>`).join("")}</ul>`;
    return `<pre>${esc(JSON.stringify(j, null, 2))}</pre>`;
  } catch {
    return output.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("");
  }
}

function report(jobs: Job[], spent: number, cli: boolean) {
  const totals = MODELS.map((m) => {
    const rs = jobs.flatMap((j) => j.results.filter((r) => r.model === m));
    return `<td>${m}</td><td>$${rs.reduce((a, r) => a + r.costUsd, 0).toFixed(4)}</td><td>${rs.filter((r) => r.error).length}</td>`;
  });
  const rows = jobs
    .map(
      (j) => `<section><h2>${esc(j.feature)}: <i>${esc(j.book)}</i>, ${esc(j.chapter)}</h2>
<details${j.feature.startsWith("Rewrite") ? " open" : ""}><summary>The book's text</summary><p class="orig">${esc(j.original)}</p></details>
<div class="cols">${j.results
        .map(
          (r) => `<div><h3>${r.model}${r.answeredBy && r.answeredBy !== r.model ? ` (answered by ${r.answeredBy})` : ""}</h3>
<p class="meta">$${r.costUsd.toFixed(4)} · ${r.inputTokens.toLocaleString()} in, ${r.outputTokens.toLocaleString()} out · ${r.seconds.toFixed(1)} s</p>
${r.error ? `<p class="err">${esc(r.error)}</p>` : show(r.output ?? "")}</div>`,
        )
        .join("")}</div></section>`,
    )
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Model comparison</title>
<style>
:root{--bg:#fbf8f2;--fg:#222;--muted:#666;--card:#fff;--line:#e3ddd2;--err:#a32}
@media (prefers-color-scheme:dark){:root{--bg:#1b1a18;--fg:#eee;--muted:#aaa;--card:#252421;--line:#3a3833;--err:#f88}}
body{background:var(--bg);color:var(--fg);font:16px/1.55 Georgia,serif;margin:0 auto;max-width:1200px;padding:16px}
h1{font-size:1.6rem}h2{font-size:1.15rem;margin-top:2rem}h3{font:600 .95rem system-ui;margin:0 0 .2rem}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media (max-width:720px){.cols{grid-template-columns:1fr}}
.cols>div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px}
.meta,summary,td,th{font:.85rem system-ui;color:var(--muted)}.orig{color:var(--muted)}.err{color:var(--err)}
table{border-collapse:collapse}td,th{padding:4px 12px;border-bottom:1px solid var(--line);text-align:left}
</style></head><body><h1>Opus 5.5 and Haiku 5.5, side by side</h1>
<p>The same jobs from your library, each run once on each model with the app's own prompts. ${cli ? `Run on your Claude subscription through <code>claude -p</code>; the dollars are what the API would have charged (list price): $${spent.toFixed(4)} in all.` : `Total spent: $${spent.toFixed(4)}.`}</p>
<table><tr><th>Model</th><th>Cost</th><th>Errors</th></tr>${totals.map((t) => `<tr>${t}</tr>`).join("")}</table>
${rows}</body></html>`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
