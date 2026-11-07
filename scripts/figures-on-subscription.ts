/**
 * M41 R6 on Samuel's Claude subscription: redraws a paper's figures cleanly, on
 * the laptop with `claude -p` (no API key, no API spending), checks each
 * redraw against its figure, and sends the ones that pass to the live site.
 *
 * Written for Samuel and the Claude sessions that run it.
 *
 *   npx tsx scripts/figures-on-subscription.ts redraw <book.epub> <folder> [--only p1,p2] [--jobs 3]
 *   npx tsx scripts/figures-on-subscription.ts recheck <book.epub> <folder>   (the marker check on figures redrawn before it)
 *   npx tsx scripts/figures-on-subscription.ts sheet <folder>          (a page to look at every result)
 *   npx tsx scripts/figures-on-subscription.ts send <folder> <site> <book id>
 *
 * The whole workflow, with what to look at between steps: .claude/skills/figures-on-subscription/SKILL.md.
 *
 * Each figure, in turn:
 * 1. Its words are read twice, by two models (prompts/figure-transcribe.md). A
 *    photograph, a shaded surface or a mesh too dense to redraw is kept as it is;
 *    so is a figure whose two readings disagree on any letter or digit.
 * 2. It is redrawn as an SVG (prompts/figure-redraw.md) with exactly those words.
 * 3. The SVG must hold only plain drawing (lib/library/figure-redraw.ts
 *    `checkSvg`), use exactly the words read, and lie over the figure when drawn
 *    into pixels (`compareInk`). Then a second model compares the two pictures
 *    and lists any difference of content, and a model lists every data point's
 *    symbol in both (prompts/figure-markers.md): filled and open must match, and
 *    a marker the print does not show for certain keeps the original. A problem
 *    goes back for a correction, at most three times; a figure that still fails
 *    keeps its original.
 *
 * <folder> keeps one JSON file per figure, a picture of its check, and the SVG
 * (keep it out of git: it is the paper's figure). A figure already done is
 * skipped, so the run can be stopped and started again. `send` needs an API
 * token of the library's owner (made at /agents) in NEOLIBRARY_AGENT_TOKEN.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fill, readPrompt } from "@/lib/ai/prompts";
import { boxOf, checkSvg, compareInk, FigureError, figuresOf, inkOf, onlyWord, REDRAW_PROMPT, splitSvg, svgTexts, TRANSCRIBE_PROMPT, wordDiff, type Found, type InkCheck, type Spot } from "@/lib/library/figure-redraw";
import { DECLINED } from "@/lib/library/page-check";

const MARKERS_PROMPT = "figure-markers";
type Marker = { where: string; figure: string; redraw: string };

/**
 * Filled and open markers stand for different data, and thinning lines (the pixel check) cannot tell them apart:
 * a model lists every data point's symbol in both pictures. Any that differ, or that the print does not show for
 * certain, fail the redraw. Returns the problems (none: it passed).
 */
async function markerProblems(call: (m: string, pics: Buffer[], t: string) => Promise<{ text: string }>, figure: Buffer, redrawn: Buffer, instructions: string): Promise<string[]> {
  const { markers } = jsonIn((await call(DRAWER, [figure, redrawn], instructions)).text) as { markers?: Marker[] };
  if (!Array.isArray(markers)) return ["The marker check gave no list."];
  const norm = (s: string) => String(s ?? "").trim().toLowerCase();
  return markers
    .filter((m) => norm(m.figure) === "uncertain" || norm(m.figure) !== norm(m.redraw))
    .map((m) => (norm(m.figure) === "uncertain" ? `The marker ${m.where} cannot be read for certain in the print.` : `The marker ${m.where} is a ${m.figure} in the figure but a ${m.redraw} in the redraw.`));
}

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const DRAWER = "claude-opus-5-5";
const SECOND = "claude-sonnet-5-5";
const FIXES = 3;
/** Claude reads a picture at most about this size without shrinking it; the check runs at the same size. */
const MAX_SIDE = 1568;
const MAX_PIXELS = 1_150_000;
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

type Calls = { model: string; inputTokens: number; outputTokens: number }[];
export type Result = {
  key: string;
  src: string;
  alt: string;
  spots: Spot[];
  inputHash: string;
  size: { w: number; h: number; workW: number; workH: number };
  status: "redrawn" | "kept";
  why: string;
  texts?: string[];
  rounds: number;
  check?: { tolerance: number; missed: number; extra: number; wordsAstray: number };
  calls: Calls;
  promptHash: string;
  /** The marker check's instructions it passed (figures redrawn before that check have none, and are not sent). */
  markersHash?: string;
  at: string;
  seconds: number;
};

/** One message to `claude -p`: pictures, then the instructions; no tools, no Claude Code system prompt, never the API key. */
function ask(model: string, pictures: Buffer[], instructions: string): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number }> {
  const message = {
    type: "user",
    message: {
      role: "user",
      content: [...pictures.map((p) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: p.toString("base64") } })), { type: "text", text: instructions }],
    },
  };
  const args = ["-p", "--model", model, "--effort", "high", "--system-prompt", "", "--tools", "", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", ""];
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
      if (code !== 0 || !result || result.is_error) return reject(new Error(`claude -p (${code}): ${String(result?.result ?? err ?? out).slice(0, 300)}`));
      const text = String(result.result ?? "").trim();
      if (!text) return reject(new Error("claude -p gave no text."));
      if (DECLINED.test(text.slice(0, 200))) return reject(new Error(`Claude declined: ${text.slice(0, 120)}`));
      if (result.stop_reason === "max_tokens") return reject(new Error("The answer was cut off before it finished."));
      const u = result.usage ?? {};
      resolve({
        text,
        model: Object.keys(result.modelUsage ?? {})[0] ?? model,
        inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
      });
    });
    child.stdin.end(`${JSON.stringify(message)}\n`);
  });
}

const jsonIn = (text: string) => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
const svgIn = (text: string) => {
  const a = text.indexOf("<svg");
  const b = text.lastIndexOf("</svg>");
  if (a < 0 || b < a) throw new FigureError("The answer holds no SVG.");
  return text.slice(a, b + 6);
};

type Pixels = { w: number; h: number; rgba: Uint8ClampedArray; png: Buffer };
async function draw(src: Buffer | Uint8Array, w: number, h: number): Promise<Pixels> {
  const img = await loadImage(Buffer.from(src));
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  return { w, h, rgba: g.getImageData(0, 0, w, h).data, png: c.toBuffer("image/png") };
}

type Checked = { ok: boolean; problems: string[]; ink: InkCheck | null; picture: Buffer | null };

/** Every check a redraw must pass before a second model looks at it. */
async function check(svgRaw: string, figure: Uint8Array, texts: string[], w: number, h: number): Promise<Checked & { svg: string }> {
  let svg: string;
  try {
    svg = checkSvg(svgRaw);
  } catch (e) {
    return { ok: false, problems: [(e as Error).message], ink: null, picture: null, svg: svgRaw };
  }
  const problems: string[] = [];
  const words = wordDiff(texts, svgTexts(svg));
  if (!words.same) problems.push(`The words differ from the figure's: missing ${words.missing.join(" ") || "nothing"}; added ${words.extra.join(" ") || "nothing"} (words counted, capitals included).`);
  const parts = splitSvg(svg);
  const ink = (s: string) => draw(Buffer.from(s), w, h).then((p) => inkOf(p.rgba, w, h));
  const boxes = [];
  for (let k = 0; k < svgTexts(svg).length + 20; k++) {
    const b = boxOf(await ink(onlyWord(svg, k)), w, h);
    if (b) boxes.push(b);
  }
  const result = compareInk({ figure, lines: await ink(parts.lines), words: await ink(parts.words), wordBoxes: boxes, w, h });
  problems.push(...result.reasons.map((r) => `${r[0].toUpperCase()}${r.slice(1)}.`));
  return { ok: problems.length === 0, problems, ink: result, picture: marks(figure, result, w, h), svg };
}

/** The figure in grey, with the check's marks: red missing, orange added, green words astray (thickened to be seen). */
function marks(figure: Uint8Array, r: InkCheck, w: number, h: number): Buffer {
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  const im = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) im.data.set(figure[i] ? [200, 200, 200, 255] : [255, 255, 255, 255], i * 4);
  const paint = (m: Uint8Array, rgb: number[]) => {
    for (let i = 0; i < w * h; i++) {
      if (!m[i]) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h) im.data.set([...rgb, 255], ((y + dy) * w + x + dx) * 4);
    }
  };
  paint(r.marks.missed, [230, 0, 0]);
  paint(r.marks.extra, [255, 140, 0]);
  paint(r.marks.astray, [0, 160, 0]);
  g.putImageData(im, 0, 0);
  return c.toBuffer("image/png");
}

async function prompts() {
  const transcribe = await readPrompt(TRANSCRIBE_PROMPT);
  const redraw = await readPrompt(REDRAW_PROMPT);
  const [drawPart, rest] = redraw.split(/^---fix---$/m);
  const [fixPart, reviewPart] = rest.split(/^---review---$/m);
  // The marker check is a gate of its own (not part of the drawing's instructions, so not in their fingerprint).
  const markers = await readPrompt(MARKERS_PROMPT);
  return { transcribe, draw: drawPart.trim(), fix: fixPart.trim(), review: reviewPart.trim(), markers, markersHash: sha256(markers), hash: sha256(`${transcribe}\n${redraw}`) };
}

async function redrawOne(f: Found, folder: string, p: Awaited<ReturnType<typeof prompts>>): Promise<Result> {
  const t0 = Date.now();
  const original = await loadImage(Buffer.from(f.bytes));
  const s = Math.min(1, MAX_SIDE / Math.max(original.width, original.height), Math.sqrt(MAX_PIXELS / (original.width * original.height)));
  const w = Math.round(original.width * s);
  const h = Math.round(original.height * s);
  const work = await draw(f.bytes, w, h);
  const figure = inkOf(work.rgba, w, h);
  const calls: Calls = [];
  const call = async (model: string, pics: Buffer[], text: string) => {
    const r = await ask(model, pics, text);
    calls.push({ model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
    return r;
  };
  const base = { key: f.key, src: f.src, alt: f.alt, spots: f.spots, inputHash: sha256(f.bytes), size: { w: original.width, h: original.height, workW: w, workH: h }, calls, promptHash: p.hash };
  const done = (r: Pick<Result, "status" | "why" | "rounds"> & Partial<Result>): Result => ({ ...base, ...r, at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000) });

  const first = jsonIn((await call(DRAWER, [work.png], p.transcribe)).text) as { lineArt: boolean; texts: string[] };
  if (!first.lineArt) return done({ status: "kept", why: "not line art (a photograph, shaded surface or dense mesh)", rounds: 0, texts: first.texts });
  const second = jsonIn((await call(SECOND, [work.png], p.transcribe)).text) as { lineArt: boolean; texts: string[] };
  let texts = first.texts;
  if (!wordDiff(first.texts, second.texts).same) {
    // A third reading settles it: the words two of the three readings agree on, letter for letter; else the original stays.
    const third = jsonIn((await call(DRAWER, [work.png], p.transcribe)).text) as { lineArt: boolean; texts: string[] };
    const pair = [[first, third], [second, third]].find(([a, b]) => wordDiff(a.texts, b.texts).same);
    if (!pair) {
      const d = wordDiff(first.texts, second.texts);
      return done({ status: "kept", why: `three readings of its words disagree (${[...d.missing, ...d.extra].join(" ")})`, rounds: 0, texts: first.texts });
    }
    texts = pair[0].texts;
  }

  let svg = svgIn((await call(DRAWER, [work.png], fill(p.draw, { width: String(w), height: String(h), texts: texts.join("\n") }))).text);
  for (let round = 0; ; round++) {
    const c = await check(svg, figure, texts, w, h);
    svg = c.svg;
    writeFileSync(join(folder, `${f.key}.svg`), svg);
    const rendered = c.ink ? await draw(Buffer.from(svg), w, h) : null;
    if (rendered && c.picture) writeFileSync(join(folder, `${f.key}-check.png`), side([work.png, rendered.png, c.picture], w, h, await Promise.all([work.png, rendered.png, c.picture].map((b) => loadImage(b)))));
    let problems = c.problems;
    if (c.ok && rendered) {
      const review = jsonIn((await call(SECOND, [work.png, rendered.png], p.review)).text) as { differences: string[] };
      const markerIssues = review.differences?.length ? [] : await markerProblems(call, work.png, rendered.png, p.markers);
      if (!review.differences?.length && markerIssues.some((m) => m.includes("for certain"))) {
        return done({ status: "kept", why: `its markers cannot all be read for certain in the print: ${markerIssues.join(" ")}`, rounds: round, texts });
      }
      if (!review.differences?.length && markerIssues.length) {
        problems = markerIssues;
      } else if (!review.differences?.length) {
        const ink = c.ink!;
        return done({ status: "redrawn", why: round ? `passed after ${round} correction${round > 1 ? "s" : ""}` : "passed first time", rounds: round, texts, markersHash: p.markersHash, check: { tolerance: ink.tolerance, missed: ink.missed, extra: ink.extra, wordsAstray: ink.wordsAstray } });
      } else {
        problems = review.differences.map((d) => `A second look found: ${d}`);
      }
    }
    if (round >= FIXES) return done({ status: "kept", why: `still differs after ${FIXES} corrections: ${problems.join(" ")}`, rounds: round, texts });
    const pics = [work.png, ...(rendered ? [rendered.png] : []), ...(c.picture ? [c.picture] : [])];
    svg = svgIn((await call(DRAWER, pics, fill(p.fix, { problems: problems.map((x) => `- ${x}`).join("\n"), svg }))).text);
  }
}

/** Pictures side by side, for a person to look at. */
function side(_: Buffer[], w: number, h: number, imgs: Awaited<ReturnType<typeof loadImage>>[]): Buffer {
  const c = createCanvas(w * imgs.length + 20 * (imgs.length - 1), h);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, h);
  imgs.forEach((im, i) => g.drawImage(im, i * (w + 20), 0, w, h));
  return c.toBuffer("image/png");
}

async function pool<T>(items: T[], jobs: number, work: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: jobs }, async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) await work(t);
  }));
}

async function redraw(epubPath: string, folder: string) {
  mkdirSync(folder, { recursive: true });
  const only = arg("only", "").split(",").filter(Boolean);
  const all = figuresOf(readFileSync(epubPath)).filter((f) => !only.length || only.includes(f.key));
  const p = await prompts();
  console.log(`${all.length} figures; instructions ${p.hash.slice(0, 12)}`);
  await pool(all, Number(arg("jobs", "3")), async (f) => {
    const out = join(folder, `${f.key}.json`);
    if (existsSync(out)) {
      const old = JSON.parse(readFileSync(out, "utf8")) as Result;
      if (old.promptHash === p.hash && old.inputHash === sha256(f.bytes)) return;
    }
    try {
      const r = await redrawOne(f, folder, p);
      writeFileSync(out, JSON.stringify(r, null, 2));
      console.log(`${f.key}: ${r.status} (${r.why}) ${r.seconds}s, ${r.calls.length} calls`);
    } catch (e) {
      console.log(`${f.key}: FAILED ${(e as Error).message}`);
    }
  });
}

/** The marker check on figures already redrawn (made before it existed): one that fails keeps its printed picture. */
async function recheck(epubPath: string, folder: string) {
  const p = await prompts();
  const found = new Map(figuresOf(readFileSync(epubPath)).map((f) => [f.key, f]));
  for (const n of readdirSync(folder).filter((x) => x.endsWith(".json"))) {
    const r = JSON.parse(readFileSync(join(folder, n), "utf8")) as Result;
    const f = found.get(r.key);
    if (r.status !== "redrawn" || r.markersHash === p.markersHash || !f) continue;
    const { workW: w, workH: h } = r.size;
    const work = await draw(f.bytes, w, h);
    const rendered = await draw(Buffer.from(readFileSync(join(folder, `${r.key}.svg`), "utf8")), w, h);
    const call = async (model: string, pics: Buffer[], text: string) => {
      const a = await ask(model, pics, text);
      r.calls.push({ model: a.model, inputTokens: a.inputTokens, outputTokens: a.outputTokens });
      return a;
    };
    const problems = await markerProblems(call, work.png, rendered.png, p.markers);
    if (problems.length) Object.assign(r, { status: "kept", why: `the marker check: ${problems.join(" ")}` });
    else r.markersHash = p.markersHash;
    writeFileSync(join(folder, n), JSON.stringify(r, null, 2));
    console.log(`${r.key}: ${r.status} (${problems.length ? r.why : "markers match"})`);
  }
}

function sheet(folder: string) {
  const results = readdirSync(folder)
    .filter((n) => n.endsWith(".json"))
    .map((n) => JSON.parse(readFileSync(join(folder, n), "utf8")) as Result)
    .sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const rows = results.map(
    (r) => `<section><h2>${esc(r.key)} · ${esc(r.alt)} · <b class="${r.status}">${r.status}</b></h2><p>${esc(r.why)}${r.check ? ` · missed ${(r.check.missed * 100).toFixed(1)} %, added ${(r.check.extra * 100).toFixed(1)} %, words astray ${(r.check.wordsAstray * 100).toFixed(1)} %` : ""} · ${r.calls.length} calls, ${r.seconds} s</p>${existsSync(join(folder, `${r.key}-check.png`)) ? `<img src="${r.key}-check.png">` : ""}</section>`,
  );
  const redrawn = results.filter((r) => r.status === "redrawn").length;
  writeFileSync(
    join(folder, "sheet.html"),
    `<!doctype html><meta charset="utf-8"><title>Figure redraws</title><style>body{font:14px system-ui;margin:16px}img{max-width:100%;border:1px solid #ccc}.redrawn{color:#060}.kept{color:#a00}</style><h1>${redrawn} of ${results.length} figures redrawn</h1><p>Each: the figure · the redraw · the check (grey figure; red missing, orange added, green words astray).</p>${rows.join("")}`,
  );
  console.log(`${redrawn} of ${results.length} redrawn; ${join(folder, "sheet.html")}`);
}

async function send(folder: string, site: string, bookId: string) {
  const token = process.env.NEOLIBRARY_AGENT_TOKEN;
  if (!token) throw new Error("Set NEOLIBRARY_AGENT_TOKEN (an owner's token from /agents).");
  const results = readdirSync(folder)
    .filter((n) => n.endsWith(".json"))
    .map((n) => JSON.parse(readFileSync(join(folder, n), "utf8")) as Result)
    .filter((r) => r.status === "redrawn" && r.markersHash);
  const figures = results.flatMap((r) =>
    r.spots.map((spot) => ({
      chapter: spot.chapter,
      nth: spot.nth,
      src: r.src,
      inputHash: r.inputHash,
      svg: readFileSync(join(folder, `${r.key}.svg`), "utf8"),
      model: r.calls.find((c) => c.model.startsWith("claude-opus"))?.model ?? DRAWER,
      promptHash: r.promptHash,
      inputTokens: r.calls.reduce((n, c) => n + c.inputTokens, 0),
      outputTokens: r.calls.reduce((n, c) => n + c.outputTokens, 0),
      check: { ...r.check!, rounds: r.rounds, reviewedBy: SECOND },
    })),
  );
  for (let i = 0; i < figures.length; ) {
    const part: typeof figures = [];
    let size = 0;
    while (i < figures.length && (part.length === 0 || size + figures[i].svg.length < 3_000_000)) {
      size += figures[i].svg.length;
      part.push(figures[i++]);
    }
    const res = await fetch(`${site.replace(/\/$/, "")}/api/agent/books/${bookId}/figure-redraws`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ figures: part }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`The site said ${res.status}: ${body.slice(0, 300)}`);
    console.log(`sent ${part.length}: ${body.slice(0, 200)}`);
  }
}

async function main() {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === "redraw" && a && b) return redraw(a, b);
  if (cmd === "sheet" && a) return sheet(a);
  if (cmd === "recheck" && a && b) return recheck(a, b);
  if (cmd === "send" && a && b && c) return send(a, b, c);
  console.log("Usage: figures-on-subscription.ts redraw <book.epub> <folder> [--only p1,p2] [--jobs 3] | sheet <folder> | send <folder> <site> <book id>");
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("figures-on-subscription.ts")) main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
