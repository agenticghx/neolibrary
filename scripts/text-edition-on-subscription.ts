/**
 * M25 on Samuel's Claude subscription: reads a scanned PDF's pages on the
 * laptop with `claude -p` (no API key, no API spending), then sends the pages
 * read to the live site, which makes the text edition from them.
 *
 * Written for Samuel and the Claude sessions that run it. The server's own
 * way (the book page's "Make a text edition", through the Batch API) needs an
 * Anthropic key on the server and costs about $3 a book; this does the same
 * reading with the same page pictures (drawn by the same code), the same
 * instructions (prompts/transcribe-page.md, byte for byte) and the same model,
 * and records it as read through the subscription (cost $0 to the app's AI
 * limits; the API price it would have cost is printed).
 *
 *   npx tsx scripts/text-edition-on-subscription.ts read <scan.pdf> <folder> [--model claude-sonnet-5-5] [--jobs 4] [--pages 1-388]
 *   npx tsx scripts/text-edition-on-subscription.ts send <folder> <site> <book id>
 *
 * `read` keeps one JSON file per page in <folder> (keep it out of git: it holds
 * the book's text) and skips pages already read, so it can be stopped and run
 * again. `send` needs an API token of the library's owner (made at /agents) in
 * NEOLIBRARY_AGENT_TOKEN.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { batchCostUsd, TRANSCRIBE_MODEL } from "@/lib/ai/batch";
import { readPrompt, sha256 } from "@/lib/ai/prompts";
import { DECLINED } from "@/lib/library/page-check";
import { BLANK_INK, MAX_PICTURE_TOKENS, openPdfForPictures, pictureTokens } from "@/lib/library/page-pictures";
import { PROMPT_NAME, type ReadElsewherePage } from "@/lib/library/text-edition";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

type PageFile = ReadElsewherePage & { at: string; seconds: number; apiBatchUsd: number };
type Manifest = { pdfSha256: string; pageCount: number; blankPages: number[]; model: string; promptHash: string };

/** One page through `claude -p`: the picture and the instructions as one message, no tools, no system prompt of Claude Code's own. */
function readPage(model: string, base64: string, instructions: string): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number }> {
  const message = {
    type: "user",
    message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: base64 } }, { type: "text", text: instructions }] },
  };
  const args = ["-p", "--model", model, "--system-prompt", "", "--tools", "", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", ""];
  args.push("--input-format", "stream-json", "--output-format", "stream-json", "--verbose");
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
      const result = out
        .trim()
        .split("\n")
        .flatMap((l) => {
          try {
            return [JSON.parse(l)];
          } catch {
            return [];
          }
        })
        .find((m) => m.type === "result");
      if (code !== 0 || !result || result.is_error || result.num_turns !== 1) return reject(new Error(`claude -p (${code}): ${String(result?.result ?? err ?? out).slice(0, 300)}`));
      const u = result.usage ?? {};
      const text = String(result.result ?? "").trim();
      if (!text) return reject(new Error("claude -p gave no text."));
      // Once in The Pay Off's 360 pages (page 213, 2026-10-17) Claude declined and wrote a summary instead: never keep that as the page.
      if (DECLINED.test(text.slice(0, 200))) return reject(new Error(`Claude declined: ${text.slice(0, 120)}`));
      if (result.stop_reason === "max_tokens") return reject(new Error("The answer was cut off before it finished."));
      resolve({
        text,
        model: Object.keys(result.modelUsage ?? {})[0] ?? model,
        inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
      });
    });
    child.stdin.end(JSON.stringify(message) + "\n");
  });
}

const pageFile = (folder: string, page: number) => join(folder, `page-${String(page).padStart(4, "0")}.json`);

async function read(pdf: string, folder: string) {
  const model = arg("model", TRANSCRIBE_MODEL);
  const jobs = Math.max(1, Number(arg("jobs", "4")));
  mkdirSync(folder, { recursive: true });
  const bytes = new Uint8Array(readFileSync(pdf));
  const instructions = await readPrompt(PROMPT_NAME);
  const promptHash = sha256(instructions);
  const doc = await openPdfForPictures(bytes);
  const [from, to] = arg("pages", `1-${doc.pageCount}`).split("-").map(Number);
  const blank: number[] = [];
  const failed: { page: number; message: string }[] = [];
  let read = 0;
  let apiUsd = 0;
  const going = new Set<Promise<void>>();
  const started = Date.now();
  for (let page = from; page <= Math.min(to, doc.pageCount); page++) {
    const picture = await doc.picture(page);
    if (picture.ink < BLANK_INK) {
      blank.push(page);
      continue;
    }
    if (pictureTokens(picture.width, picture.height) > MAX_PICTURE_TOKENS) throw new Error(`Page ${page} came out larger than Claude takes.`);
    const base64 = picture.png.toString("base64");
    const inputHash = sha256(base64);
    const file = pageFile(folder, page);
    if (existsSync(file)) {
      const before = JSON.parse(readFileSync(file, "utf8")) as PageFile;
      if (before.inputHash === inputHash && before.promptHash === promptHash && before.model === model) continue;
    }
    while (going.size >= jobs) await Promise.race(going);
    const t0 = Date.now();
    const task = (async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          const r = await readPage(model, base64, instructions);
          const usd = batchCostUsd(r.model, r.inputTokens, r.outputTokens);
          const saved: PageFile = { page, markdown: r.text, model: r.model, promptHash, inputHash, inputTokens: r.inputTokens, outputTokens: r.outputTokens, at: new Date().toISOString(), seconds: (Date.now() - t0) / 1000, apiBatchUsd: usd };
          writeFileSync(file, JSON.stringify(saved, null, 1));
          read++;
          apiUsd += usd;
          console.log(`Page ${page}: ${r.outputTokens} tokens out, ${saved.seconds.toFixed(0)} s (${read} read, ${((Date.now() - started) / 60000).toFixed(1)} min).`);
          return;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (attempt < 3) {
            console.log(`Page ${page}: try ${attempt} failed (${message.slice(0, 120)}); trying again.`);
            await new Promise((r) => setTimeout(r, 15_000 * attempt));
            continue;
          }
          failed.push({ page, message });
          console.log(`Page ${page}: NOT READ: ${message}`);
          return;
        }
      }
    })();
    going.add(task);
    void task.finally(() => going.delete(task));
  }
  await Promise.all(going);
  await doc.close();
  // Blank pages outside the pages asked for this time are kept from the last run.
  const before = existsSync(join(folder, "manifest.json")) ? (JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as Manifest).blankPages : [];
  const blankPages = [...new Set([...before.filter((p) => p < from || p > to), ...blank])].sort((a, b) => a - b);
  const manifest: Manifest = { pdfSha256: createHash("sha256").update(bytes).digest("hex"), pageCount: doc.pageCount, blankPages, model, promptHash };
  writeFileSync(join(folder, "manifest.json"), JSON.stringify(manifest, null, 1));
  console.log(`Done: ${read} pages read now, ${blank.length} blank, ${failed.length} not read${failed.length ? ` (${failed.map((f) => f.page).join(", ")})` : ""}. At the Batch API's price these pages would have cost $${apiUsd.toFixed(2)}; on the subscription, $0.`);
}

/** Sends the pages read to the live site in parts of about 200 KB; the last part makes the text edition. */
async function send(folder: string, site: string, bookId: string) {
  const token = process.env.NEOLIBRARY_AGENT_TOKEN?.trim();
  if (!token) throw new Error("Set NEOLIBRARY_AGENT_TOKEN: an API token of the library's owner, made at /agents (keyadd NEOLIBRARY_AGENT_TOKEN).");
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as Manifest;
  const pages = readdirSync(folder)
    .filter((f) => /^page-\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(folder, f), "utf8")) as PageFile)
    .sort((a, b) => a.page - b.page)
    .map(({ page, markdown, model, promptHash, inputHash, inputTokens, outputTokens }): ReadElsewherePage => ({ page, markdown, model, promptHash, inputHash, inputTokens, outputTokens }));
  const parts: ReadElsewherePage[][] = [[]];
  let size = 0;
  for (const p of pages) {
    if (size > 200_000) {
      parts.push([]);
      size = 0;
    }
    parts[parts.length - 1].push(p);
    size += p.markdown.length;
  }
  const url = `${site.replace(/\/$/, "")}/api/agent/books/${bookId}/text-edition`;
  for (const [i, part] of parts.entries()) {
    const last = i === parts.length - 1;
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ pages: part, blankPages: manifest.blankPages, pageCount: manifest.pageCount, finish: last }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Part ${i + 1} of ${parts.length}: ${res.status} ${JSON.stringify(body)}`);
    console.log(`Part ${i + 1} of ${parts.length}: ${part.length} pages sent.${last ? ` ${JSON.stringify(body)}` : ""}`);
  }
}

async function main() {
  const [command, a, b, c] = process.argv.slice(2);
  if (command === "read" && a && b) return read(a, b);
  if (command === "send" && a && b && c) return send(a, b, c);
  throw new Error("Usage: text-edition-on-subscription.ts read <scan.pdf> <folder> | send <folder> <site> <book id>");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
