/**
 * M40 S5 (Samuel, 2026-11-01: sessions take over the gates): checks the live site the way the ledger's "Waiting on
 * Samuel" list asked him to, and writes a report of what looks wrong only.
 *
 *   npx tsx scripts/live-check.ts <site> [--model claude-sonnet-5-5] [--books <id>,<id>] [--no-ai] [--out <folder>]
 *
 * For every book of the token's owner: the file opens (its first byte is served); a scan has its text edition; it has
 * a cover picture. For every book with an X-ray read by Claude (facts): its 20 most mentioned entries are judged on
 * Samuel's Claude subscription with `claude -p` (no API key, no API spending): is the name a real one, is its kind
 * right, does each fact's quote say it.
 *
 * Needs the owner's API token (made at /agents) in NEOLIBRARY_AGENT_TOKEN; run it in a login shell (zsh -ic) so the
 * Keychain's keys are loaded. The report holds book text, so it goes to ~/Documents/neolibrary-live-check/ (never into
 * git: the repository is public). Written for Claude sessions; the report is written for Samuel.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentBook, AgentBookDetails, AgentXrayEntry } from "@/lib/agent/library";
import { type BookFindings, readXrayAnswer, report, XRAY_JUDGE_SYSTEM, xrayQuestion, xraySample } from "@/lib/live-check";

const flag = (name: string) => process.argv.includes(`--${name}`);
const option = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

const token = () => {
  const t = process.env.NEOLIBRARY_AGENT_TOKEN;
  if (!t) throw new Error("NEOLIBRARY_AGENT_TOKEN is not set: make a token at /agents and run `keyadd NEOLIBRARY_AGENT_TOKEN` in Terminal, then run this in a login shell (zsh -ic).");
  return t;
};

async function get(site: string, path: string, headers: Record<string, string> = {}) {
  return fetch(`${site.replace(/\/$/, "")}${path}`, { headers: { authorization: `Bearer ${token()}`, ...headers } });
}

async function json<T>(site: string, path: string): Promise<T> {
  const res = await get(site, path);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(`${path}: ${res.status} ${body.error ?? ""}`.trim());
  return body;
}

/** One question to Claude on the subscription, no tools, one turn; the answer's text. */
function askClaude(model: string, system: string, text: string): Promise<string> {
  const args = ["-p", "--model", model, "--system-prompt", system, "--tools", "", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", ""];
  args.push("--output-format", "json");
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
      let result: { result?: string; is_error?: boolean } = {};
      try {
        result = JSON.parse(out);
      } catch {
        // falls through to the error below
      }
      if (code !== 0 || result.is_error || !result.result) return reject(new Error(`claude -p (${code}): ${String(result.result ?? err ?? out).slice(0, 200)}`));
      resolve(result.result);
    });
    child.stdin.end(text);
  });
}

async function main() {
  const site = process.argv[2];
  if (!site || site.startsWith("--")) throw new Error("Usage: npx tsx scripts/live-check.ts <site> [--model claude-sonnet-5-5] [--books <id>,<id>] [--no-ai] [--out <folder>]");
  const model = option("model", "claude-sonnet-5-5")!;
  const only = option("books")?.split(",");
  const out = option("out", join(homedir(), "Documents", "neolibrary-live-check"))!;
  const books = (await json<{ books: AgentBook[] }>(site, "/api/agent/books")).books.filter((b) => !only || only.includes(b.id));
  const found: BookFindings[] = [];
  for (const b of books) {
    const book = (await json<{ book: AgentBookDetails }>(site, `/api/agent/books/${b.id}`)).book;
    const f: BookFindings = { book, fileOk: true, xrayEntries: 0, xrayChecked: 0, xrayProblems: [] };
    if (book.kind) {
      const res = await get(site, `/api/agent/books/${b.id}/file`, { range: "bytes=0-0" });
      f.fileOk = res.status === 200 || res.status === 206;
      f.fileStatus = res.status;
      await res.body?.cancel();
    }
    if (!flag("no-ai") && book.kind) {
      try {
        const entries = (await json<{ entries: AgentXrayEntry[] }>(site, `/api/agent/books/${b.id}/xray/entries`)).entries;
        f.xrayEntries = entries.length;
        const read = entries.filter((e) => e.facts.length);
        if (read.length) {
          const sample = xraySample(read);
          f.xrayChecked = sample.length;
          const answer = await askClaude(model, XRAY_JUDGE_SYSTEM, xrayQuestion(book, read));
          f.xrayProblems = readXrayAnswer(answer, sample.map((e) => e.name));
        }
      } catch (e) {
        f.xrayError = (e as Error).message;
      }
    }
    found.push(f);
    console.log(`${book.title}: file ${f.fileOk ? "ok" : `NOT ok (${f.fileStatus})`}${f.xrayChecked ? `, X-ray ${f.xrayChecked} judged, ${f.xrayProblems.length} problems` : ""}${f.xrayError ? `, X-ray error: ${f.xrayError}` : ""}`);
  }
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(out, { recursive: true });
  const file = join(out, `${date}.md`);
  writeFileSync(file, report(date, new URL(site).host, found));
  console.log(`\nReport: ${file}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
