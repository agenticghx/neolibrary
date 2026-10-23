/**
 * M32 X5, on Samuel's Claude subscription: reads a book for X-ray on the
 * laptop with `claude -p` (no API key, no API spending), one chapter at a
 * time, and sends each answer to the live site, which stores it as its own
 * and checks it (a fact whose quote is not in the book is dropped).
 *
 * Written for Samuel and the Claude sessions that run it. The site's own way
 * (Who & what, "Build the X-ray") needs an Anthropic key on the server. This
 * does the same reading with the same instructions (prompts/xray.md, byte for
 * byte: the server hands out the exact request and refuses any other) and
 * records it as read through the subscription (cost $0 to the app's AI
 * limits; the API price it would have cost is printed).
 *
 *   npx tsx scripts/xray-on-subscription.ts read <site> <book id> [--model claude-haiku-5-5] [--effort medium] [--chapters 3]
 *   npx tsx scripts/xray-on-subscription.ts status <site> <book id>
 *   npx tsx scripts/xray-on-subscription.ts tidy <site> <book id>     (a book read before the alias rules of X7: aliases through them, mentions rebuilt)
 *
 * The whole workflow: .claude/skills/xray-on-subscription/SKILL.md. Needs an
 * API token of the library's owner (made at /agents) in NEOLIBRARY_AGENT_TOKEN.
 * Stopped part-way, the same command carries on from the next unread chapter.
 */
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { costUsd, PRICES } from "@/lib/ai/model";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

type Next = {
  done: number;
  total: number;
  chapter: { id: string; label: string; chapterIndex: number; system: string; prompt: string; promptHash: string; inputHash: string; style: string; schema: unknown } | null;
};

/** One chapter through `claude -p`: the server's system prompt as the system prompt, its user prompt as the one message, no tools. */
export function readChapter(model: string, effort: string, system: string, prompt: string, schema: unknown): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number }> {
  const asked = `${prompt}\n\nAnswer with one JSON object only, no words around it, matching this JSON Schema exactly:\n${JSON.stringify(schema)}`;
  const message = { type: "user", message: { role: "user", content: [{ type: "text", text: asked }] } };
  const args = ["-p", "--model", model, "--effort", effort, "--system-prompt", system, "--tools", "", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", ""];
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
      let text = String(result.result ?? "").trim();
      // A code fence around the JSON is tolerated; the server parses the object.
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      if (!text) return reject(new Error("claude -p gave no text."));
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

const token = () => {
  const t = process.env.NEOLIBRARY_AGENT_TOKEN;
  if (!t) throw new Error("NEOLIBRARY_AGENT_TOKEN is not set: make a token at /agents and run `keyadd NEOLIBRARY_AGENT_TOKEN` in Terminal, then run this in a login shell (zsh -ic).");
  return t;
};

async function api(site: string, bookId: string, init?: RequestInit) {
  const res = await fetch(`${site.replace(/\/$/, "")}/api/agent/books/${bookId}/xray`, { ...init, headers: { authorization: `Bearer ${token()}`, "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function status(site: string, bookId: string) {
  const next = (await api(site, bookId)) as Next;
  console.log(`${next.done} of ${next.total} chapters read.${next.chapter ? ` Next: ${next.chapter.label}.` : " Every chapter is read."}`);
}

async function tidy(site: string, bookId: string) {
  const r = (await api(site, bookId, { method: "POST", body: JSON.stringify({ tidy: true }) })) as { entries: number; changed: number; mentions: number };
  console.log(`${r.entries} entries; ${r.changed} had their aliases changed by the rules${r.changed ? `; ${r.mentions} mentions rebuilt` : ""}.`);
}

async function read(site: string, bookId: string) {
  const model = arg("model", "claude-haiku-5-5");
  const effort = arg("effort", "medium");
  const atMost = Number(arg("chapters", "0")) || Infinity;
  const price = PRICES[model] ? model : "unknown";
  let did = 0;
  let apiUsd = 0;
  for (;;) {
    const next = (await api(site, bookId)) as Next;
    if (!next.chapter) {
      console.log(`Every chapter is read (${next.done} of ${next.total}). API price this run would have cost: $${apiUsd.toFixed(2)}.`);
      return;
    }
    if (did >= atMost) {
      console.log(`Stopped after ${did} chapters as asked; ${next.done} of ${next.total} read. API price this run would have cost: $${apiUsd.toFixed(2)}.`);
      return;
    }
    const c = next.chapter;
    const started = Date.now();
    process.stdout.write(`${next.done + 1} of ${next.total} · ${c.label} … `);
    const out = await readChapter(model, effort, c.system, c.prompt, c.schema);
    const saved = (await api(site, bookId, {
      method: "POST",
      body: JSON.stringify({ chapterId: c.id, output: out.text, model: out.model, promptHash: c.promptHash, inputHash: c.inputHash, inputTokens: out.inputTokens, outputTokens: out.outputTokens }),
    })) as { entries: number; facts: number; dropped: number };
    const usd = costUsd(price, out.inputTokens, out.outputTokens);
    apiUsd += usd;
    did += 1;
    console.log(`${saved.entries} entries, ${saved.facts} facts, ${saved.dropped} dropped (quotes not in the book), ${Math.round((Date.now() - started) / 1000)} s, API price $${usd.toFixed(3)}`);
  }
}

const [cmd, site, bookId] = process.argv.slice(2);
const usage = () => {
  console.error("Usage: xray-on-subscription.ts read|status|tidy <site> <book id> [--model m] [--effort e] [--chapters n]");
  process.exit(2);
};
if (!site || !bookId || !/^[0-9a-f-]{36}$/i.test(bookId)) usage();
(cmd === "read" ? read(site, bookId) : cmd === "status" ? status(site, bookId) : cmd === "tidy" ? tidy(site, bookId) : Promise.reject(new Error("read, status or tidy"))).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
