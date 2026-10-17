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
 *   npx tsx scripts/text-edition-on-subscription.ts check <scan.pdf> <folder>
 *   npx tsx scripts/text-edition-on-subscription.ts pictures <scan.pdf> <out folder> <pages, e.g. 51 160-165>
 *   npx tsx scripts/text-edition-on-subscription.ts reread <scan.pdf> <folder> <pages>
 *   npx tsx scripts/text-edition-on-subscription.ts preview <folder> <out.epub> [--title T] [--author A]
 *   npx tsx scripts/text-edition-on-subscription.ts send <folder> <site> <book id>
 *
 * The whole workflow, with what to look at between steps: .claude/skills/scan-to-text/SKILL.md.
 *
 * `read` keeps one JSON file per page in <folder> (keep it out of git: it holds
 * the book's text) and skips pages already read, so it can be stopped and run
 * again. `send` needs an API token of the library's owner (made at /agents) in
 * NEOLIBRARY_AGENT_TOKEN.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { batchCostUsd, TRANSCRIBE_MODEL } from "@/lib/ai/batch";
import { readPrompt, sha256 } from "@/lib/ai/prompts";
import { strFromU8, unzipSync } from "fflate";
import { assessPage, DECLINED } from "@/lib/library/page-check";
import { extractPdfSections } from "@/lib/library/pdf-sections";
import { buildTextEdition, evenHeadings, type EditionPage } from "@/lib/library/text-epub";
import { BLANK_INK, MAX_PICTURE_TOKENS, openPdfForPictures, pictureTokens } from "@/lib/library/page-pictures";
import { PROMPT_NAME, type ReadElsewherePage } from "@/lib/library/text-edition";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

type PageFile = ReadElsewherePage & { at: string; seconds: number; apiBatchUsd: number };
type Manifest = { pdfSha256: string; pageCount: number; blankPages: number[]; model: string; promptHash: string };

/** One page through `claude -p`: the picture and the instructions as one message, no tools, no system prompt of Claude Code's own. */
/** Effort for every page, set explicitly so the laptop's `claude -p` and the server's batch read alike (Sonnet 5.5's API default). */
export const EFFORT = "high";

export function readPage(model: string, base64: string, instructions: string): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number }> {
  const message = {
    type: "user",
    message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: base64 } }, { type: "text", text: instructions }] },
  };
  const args = ["-p", "--model", model, "--effort", EFFORT, "--system-prompt", "", "--tools", "", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", ""];
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

async function read(pdf: string, folder: string, pages?: string) {
  const model = arg("model", TRANSCRIBE_MODEL);
  const jobs = Math.max(1, Number(arg("jobs", "4")));
  mkdirSync(folder, { recursive: true });
  const bytes = new Uint8Array(readFileSync(pdf));
  const instructions = await readPrompt(PROMPT_NAME);
  const promptHash = sha256(instructions);
  const doc = await openPdfForPictures(bytes);
  const [from, to] = (pages ?? arg("pages", `1-${doc.pageCount}`)).split("-").map(Number);
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
  // The site takes only pages read with its own instructions: pages read with an earlier version are already there,
  // or are to be read again.
  const current = sha256(await readPrompt(PROMPT_NAME));
  const all = readdirSync(folder).filter((f) => /^page-\d+\.json$/.test(f)).length;
  const pages = readdirSync(folder)
    .filter((f) => /^page-\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(folder, f), "utf8")) as PageFile)
    .sort((a, b) => a.page - b.page)
    .filter((p) => p.promptHash === current)
    .map(({ page, markdown, model, promptHash, inputHash, inputTokens, outputTokens }): ReadElsewherePage => ({ page, markdown, model, promptHash, inputHash, inputTokens, outputTokens }));
  if (pages.length < all) console.log(`${all - pages.length} pages were read with earlier instructions: not sent (the site keeps what it has of them).`);
  if (!pages.length) console.log("No page here was read with the current instructions: the site makes the edition again from the pages it has.");
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

const loadPages = (folder: string) =>
  readdirSync(folder)
    .filter((f) => /^page-\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(folder, f), "utf8")) as PageFile)
    .sort((a, b) => a.page - b.page);
const loadManifest = (folder: string) => JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as Manifest;

/**
 * What to look at before sending: each page checked against the scan's hidden text (the server's own check), answers
 * where Claude declined, pages neither read nor blank, and the chapter headings with any gap in their numbers. Writes
 * check.json in the folder.
 */
async function check(pdf: string, folder: string) {
  const sections = await extractPdfSections(new Uint8Array(readFileSync(pdf)));
  const hidden = (page: number) => sections.filter((s) => s.kind === "paragraph" && s.chapterIndex === page - 1).map((s) => s.text).join("\n");
  const manifest = loadManifest(folder);
  const pages = loadPages(folder);
  const results = pages.map((p) => ({ page: p.page, ...assessPage(p.markdown, hidden(p.page)) }));
  const flagged = results.filter((r) => r.flagged);
  const read = new Set(pages.map((p) => p.page));
  const missing = Array.from({ length: manifest.pageCount }, (_, i) => i + 1).filter((p) => !read.has(p) && !manifest.blankPages.includes(p));
  const headings = pages.flatMap((p) => (p.markdown.match(/^#{1,2} .+$/gm) ?? []).map((h) => ({ page: p.page, heading: h })));
  const numbers = headings.flatMap((h) => (/^# (\d+)\./.exec(h.heading) ? [Number(/^# (\d+)\./.exec(h.heading)![1])] : []));
  const gaps = numbers.length ? Array.from({ length: Math.max(...numbers) }, (_, i) => i + 1).filter((n) => !numbers.includes(n)) : [];
  const twice = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  // Headings the EPUB builder will move to level 2 (shaped like their neighbours' subheadings): fine, but worth seeing.
  const evened = evenHeadings(pages.map((p) => ({ page: p.page, kind: "read" as const, markdown: p.markdown })));
  const moved = pages.flatMap((p, i) => {
    const after = evened[i].kind === "read" ? (evened[i] as { markdown: string }).markdown : "";
    return after === p.markdown ? [] : (p.markdown.match(/^# .+$/gm) ?? []).filter((h) => after.includes(`#${h}`)).map((h) => ({ page: p.page, heading: h.slice(2) }));
  });
  const unreadable = pages.map((p) => ({ page: p.page, count: (p.markdown.match(/\[\?\]/g) ?? []).length })).filter((u) => u.count);
  // Unflagged pages to look at by eye (the check misses a few words reworded): five at random, one a chapter opening.
  const quiet = results.filter((r) => !r.flagged).map((r) => r.page);
  const openings = quiet.filter((p) => /^# /m.test(pages.find((x) => x.page === p)!.markdown));
  const pick = (from: number[]) => from[Math.floor(Math.random() * from.length)];
  const sample = [...new Set([pick(openings), ...Array.from({ length: 8 }, () => pick(quiet))])].filter(Boolean).slice(0, 5).sort((a, b) => a - b);
  writeFileSync(join(folder, "check.json"), JSON.stringify({ flagged, missing, headings, gaps, twice, moved, unreadable, sample }, null, 1));
  console.log(`${pages.length} pages read, ${manifest.blankPages.length} blank, ${missing.length} neither${missing.length ? ` (${missing.join(", ")})` : ""}.`);
  console.log(`Declined: ${results.filter((r) => r.why === "Claude declined").map((r) => r.page).join(", ") || "none"}.`);
  console.log(`To look at (${flagged.length}; the number is the share of the words read that the scan's hidden text also has):`);
  for (const r of flagged) console.log(`  p. ${r.page} (${r.agreement ?? "-"}): ${r.why}`);
  console.log(`Chapter numbers: ${numbers.length ? `${Math.min(...numbers)} to ${Math.max(...numbers)}` : "none"}; missing ${gaps.join(", ") || "none"}; twice ${twice.join(", ") || "none"}.`);
  console.log(`Headings the builder makes level 2: ${moved.map((m) => `p. ${m.page} "${m.heading}"`).join(", ") || "none"}.`);
  console.log(`Words marked unreadable [?]: ${unreadable.map((u) => `p. ${u.page} (${u.count})`).join(", ") || "none"}.`);
  console.log(`Unflagged pages to look at too: ${sample.join(", ")}.`);
  console.log(`Level-1 headings (the chapters; see them all in the preview's contents): ${headings.filter((x) => x.heading.startsWith("# ")).length}. Written to ${join(folder, "check.json")}.`);
}

/** Saves pages as pictures, to compare a reading with the printed page by eye. */
async function pictures(pdf: string, out: string, pages: number[]) {
  mkdirSync(out, { recursive: true });
  const doc = await openPdfForPictures(new Uint8Array(readFileSync(pdf)));
  const from = arg("from", "");
  for (const p of pages) {
    writeFileSync(join(out, `page-${p}.png`), (await doc.picture(p)).png);
    // With --from <folder>, each page's reading beside its picture, to compare the two.
    if (from && existsSync(pageFile(from, p))) writeFileSync(join(out, `page-${p}.md`), (JSON.parse(readFileSync(pageFile(from, p), "utf8")) as PageFile).markdown);
  }
  await doc.close();
  console.log(`Saved ${pages.map((p) => join(out, `page-${p}.png`)).join(", ")}${from ? " (and page-N.md beside each)" : ""}`);
}

/** Reads pages again: their earlier readings are kept in <folder>-replaced, never deleted. */
async function reread(pdf: string, folder: string, pages: number[]) {
  const keep = `${folder.replace(/\/$/, "")}-replaced`;
  mkdirSync(keep, { recursive: true });
  for (const p of pages) {
    const file = pageFile(folder, p);
    if (existsSync(file)) renameSync(file, join(keep, `page-${String(p).padStart(4, "0")}-${Date.now()}.json`));
  }
  for (const p of pages) await read(pdf, folder, `${p}-${p}`);
}

/** The widths the over-text check lays chapters out at: a phone and a desktop reading column. */
const WIDTHS = [358, 700];

/**
 * Builds the text edition on the laptop, as the server will, and checks it: its contents list, and every chapter laid
 * out at a phone's and a desktop's column width, with any element wider than the column (text over text in a
 * paginated reader, as The Pay Off's table was on 2026-10-17) and tables that scroll sideways listed.
 */
async function preview(folder: string, out: string) {
  const manifest = loadManifest(folder);
  const read = new Map(loadPages(folder).map((p) => [p.page, p]));
  const pages: EditionPage[] = Array.from({ length: manifest.pageCount }, (_, i) => {
    const page = i + 1;
    const r = read.get(page);
    return r ? { page, kind: "read", markdown: r.markdown } : manifest.blankPages.includes(page) ? { page, kind: "blank" } : { page, kind: "unread" };
  });
  const title = arg("title", "Text edition");
  const model = [...new Set([...read.values()].map((p) => p.model))].join(" and ");
  // The pages to check, from the last `check`, as the server lists its own on the About page.
  const checked = existsSync(join(folder, "check.json")) ? (JSON.parse(readFileSync(join(folder, "check.json"), "utf8")) as { flagged: { page: number }[] }).flagged.map((f) => f.page) : [];
  const epub = buildTextEdition(pages, { bookId: "preview", title, author: arg("author", ""), language: "en", model, madeAt: new Date(), toCheck: checked });
  writeFileSync(out, epub);
  const files = unzipSync(epub);
  const nav = strFromU8(files["OEBPS/nav.xhtml"]).split('epub:type="page-list"')[0];
  console.log(`${out}: ${(epub.byteLength / 1024).toFixed(0)} KB. Contents:`);
  for (const m of nav.matchAll(/<a href="(c\d+)\.xhtml[^"]*">([^<]*)<\/a>/g)) console.log(`  ${m[2]}`);

  // Paragraphs that open mid-sentence (a lowercase first word), outside an index: a sentence the builder could not
  // carry on (a boxed text running beside the main one, a page read in the wrong order). Each is worth a look.
  const midSentence: number[] = [];
  for (const name of Object.keys(files).filter((f) => /^OEBPS\/c\d+\.xhtml$/.test(f))) {
    const html = strFromU8(files[name]);
    if (/<title>Index/i.test(html)) continue;
    let page = 0;
    for (const m of html.matchAll(/id="page-(\d+)"|<p>([a-z])/g)) {
      if (m[1]) page = Number(m[1]);
      else midSentence.push(page);
    }
  }
  console.log(`Paragraphs that open mid-sentence (look at the page and the one before): ${midSentence.length ? midSentence.map((p) => `p. ${p}`).join(", ") : "none"}.`);

  const css = strFromU8(files["OEBPS/style.css"]);
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const problems: string[] = [];
  let scrolling = 0;
  try {
    const page = await browser.newPage();
    for (const name of Object.keys(files).filter((f) => /^OEBPS\/c\d+\.xhtml$/.test(f))) {
      const html = strFromU8(files[name]).replace(/<link[^>]*stylesheet[^>]*\/>/, `<style>${css}</style>`).replace(/^<\?xml[^>]*>\s*/, "");
      for (const width of WIDTHS) {
        await page.setViewportSize({ width: width + 32, height: 800 });
        await page.setContent(html.replace("<body>", `<body style="margin: 0 16px">`));
        const found = await page.evaluate(() => {
          const body = document.body.getBoundingClientRect();
          const over = [...document.body.querySelectorAll("*")].filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.right > body.right + 1 || r.left < body.left - 1) && !el.parentElement?.closest("table"); // a table itself counts; what is inside it moves with it
          });
          const tables = [...document.querySelectorAll("table")].filter((t) => t.scrollWidth > t.clientWidth + 1).length;
          return { over: over.map((el) => `<${el.tagName.toLowerCase()}> ${(el.textContent ?? "").replace(/\s+/g, " ").slice(0, 70)}`), tables };
        });
        for (const o of found.over) problems.push(`${name.slice(6)} at ${width} px: ${o}`);
        if (width === WIDTHS[0]) scrolling += found.tables;
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`Over-text check at ${WIDTHS.join(" and ")} px: ${problems.length ? `${problems.length} elements wider than the column:` : "nothing wider than the column."}`);
  for (const p of problems.slice(0, 40)) console.log(`  ${p}`);
  console.log(`Tables that scroll sideways on a phone: ${scrolling}.`);
  if (problems.length) process.exitCode = 2;
}

const pageList = (args: string[]) => args.flatMap((a) => (/^\d+-\d+$/.test(a) ? Array.from({ length: Number(a.split("-")[1]) - Number(a.split("-")[0]) + 1 }, (_, i) => Number(a.split("-")[0]) + i) : /^\d+$/.test(a) ? [Number(a)] : []));

async function main() {
  const [command, a, b, c, ...rest] = process.argv.slice(2);
  if (command === "read" && a && b) return read(a, b);
  if (command === "check" && a && b) return check(a, b);
  if (command === "pictures" && a && b && c) return pictures(a, b, pageList([c, ...rest]));
  if (command === "reread" && a && b && c) return reread(a, b, pageList([c, ...rest]));
  if (command === "preview" && a && b) return preview(a, b);
  if (command === "send" && a && b && c) return send(a, b, c);
  throw new Error(
    "Usage: text-edition-on-subscription.ts read <scan.pdf> <folder> | check <scan.pdf> <folder> | pictures <scan.pdf> <out> <pages> | reread <scan.pdf> <folder> <pages> | preview <folder> <out.epub> [--title T --author A] | send <folder> <site> <book id>",
  );
}

// Run as a command, not when another script imports readPage.
if (/text-edition-on-subscription\.ts$/.test(process.argv[1] ?? ""))
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
