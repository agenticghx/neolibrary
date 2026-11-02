/**
 * M40 S6 (Samuel, 2026-11-01: sessions take over the gates): reads Samuel's scanned books into text editions
 * overnight, on his Claude subscription, and leaves each as a draft for his "send". Run by launchd on the laptop
 * (scripts/overnight-scans-install.sh); a session can run it by hand too.
 *
 *   npx tsx scripts/overnight-scans.ts <site> [--folder ~/Documents/neolibrary-text-edition] [--books 1] [--pages 1-3]
 *
 * For each of the owner's scanned books with no text edition (and no draft waiting already), up to --books a night:
 *   1. downloads the scan (the agent API's file route) into its own folder;
 *   2. reads its pages with scripts/text-edition-on-subscription.ts read (claude -p; pages already read are skipped,
 *      so a night cut short carries on the next night); if pages could not be read (most often the subscription's
 *      limit), it stops for the night;
 *   3. runs that script's check and preview, and writes DRAFT.md in the folder: what the check found, and the one
 *      command that sends it to the site once Samuel says "send".
 * It never sends anything itself. Book text stays in ~/Documents (the repository is public).
 * Needs NEOLIBRARY_AGENT_TOKEN (the owner's token); run in a login shell (zsh -ic) so the Keychain's keys are loaded.
 * Written for Claude sessions; DRAFT.md and the summary are written for Samuel.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentBook, AgentBookDetails } from "@/lib/agent/library";
import { draftNote, notReadCount, pickScans, slugFor } from "@/lib/overnight-scans";

const option = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const token = () => {
  const t = process.env.NEOLIBRARY_AGENT_TOKEN;
  if (!t) throw new Error("NEOLIBRARY_AGENT_TOKEN is not set: run this in a login shell (zsh -ic).");
  return t;
};
const get = (site: string, path: string) => fetch(`${site.replace(/\/$/, "")}${path}`, { headers: { authorization: `Bearer ${token()}` } });
async function json<T>(site: string, path: string): Promise<T> {
  const res = await get(site, path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** Runs the text-edition script; its output goes to the log and is returned. */
function edition(args: string[], log: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", "scripts/text-edition-on-subscription.ts", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const keep = (d: Buffer) => {
      out += d;
      writeFileSync(log, d, { flag: "a" });
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

async function main() {
  const site = process.argv[2];
  if (!site || site.startsWith("--")) throw new Error("Usage: npx tsx scripts/overnight-scans.ts <site> [--folder <folder>] [--books 1] [--pages 1-3]");
  const base = option("folder", join(homedir(), "Documents", "neolibrary-text-edition"))!;
  const most = Number(option("books", "1"));
  const pages = option("pages");
  mkdirSync(base, { recursive: true });

  const details: AgentBookDetails[] = [];
  for (const b of (await json<{ books: AgentBook[] }>(site, "/api/agent/books")).books) {
    details.push((await json<{ book: AgentBookDetails }>(site, `/api/agent/books/${b.id}`)).book);
  }
  const waiting = (book: AgentBookDetails) => existsSync(join(base, slugFor(book), "DRAFT.md")) && readFileSync(join(base, slugFor(book), "DRAFT.md"), "utf8").includes("Status: ready");
  const todo = pickScans(details, waiting).slice(0, most);
  const summary: string[] = [];
  if (!todo.length) summary.push("No scanned book is waiting to be read.");

  for (const book of todo) {
    const folder = join(base, slugFor(book));
    mkdirSync(folder, { recursive: true });
    const log = join(folder, "overnight.log");
    const pdf = join(folder, "scan.pdf");
    if (!existsSync(pdf)) {
      const res = await get(site, `/api/agent/books/${book.id}/file`);
      if (!res.ok) {
        summary.push(`${book.title}: the scan could not be downloaded (${res.status}).`);
        continue;
      }
      writeFileSync(pdf, new Uint8Array(await res.arrayBuffer()));
    }
    const read = await edition(["read", pdf, folder, ...(pages ? ["--pages", pages] : [])], log);
    const missing = notReadCount(read.out);
    if (read.code !== 0 || missing === null || missing > 0) {
      const why = read.code !== 0 ? `the reading stopped (exit ${read.code})` : missing === null ? "the reading did not say how it went" : `${missing} pages could not be read, most often the subscription's limit`;
      writeFileSync(join(folder, "DRAFT.md"), draftNote({ book, site, folder, status: "partial", why }));
      summary.push(`${book.title}: not finished: ${why}. It carries on next time.`);
      break; // the limit is shared: no point starting another book tonight
    }
    const check = await edition(["check", pdf, folder], log);
    await edition(["preview", folder, join(folder, "preview.epub"), "--title", book.title, "--author", book.author], log);
    writeFileSync(join(folder, "DRAFT.md"), draftNote({ book, site, folder, status: "ready", check: check.out, problems: check.code === 2 }));
    summary.push(`${book.title}: read; a draft waits for your "send"${check.code === 2 ? " (the check flagged pages to look at)" : ""}.`);
  }

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  writeFileSync(join(base, "overnight-summary.md"), `# Overnight scan reading, ${stamp} UTC\n\n${summary.map((s) => `- ${s}`).join("\n")}\n`);
  console.log(summary.join("\n"));
  if (process.platform === "darwin" && todo.length) {
    spawn("osascript", ["-e", `display notification ${JSON.stringify(summary.join(" "))} with title "Neolibrary: scanned books"`], { stdio: "ignore" });
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
