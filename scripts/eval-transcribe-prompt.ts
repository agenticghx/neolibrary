/**
 * Compares versions of the page-reading instructions (prompts/transcribe-page.md) on chosen pages of a scan, read on
 * Samuel's Claude subscription (claude -p, $0), before a change to the instructions is kept. Written for the Claude
 * sessions that change those instructions (.claude/skills/scan-to-text/references/prompt.md says when and how).
 *
 *   npx tsx scripts/eval-transcribe-prompt.ts <scan.pdf> <out folder> <spec.json> <prompt A.md> <prompt B.md> [--repeats 2] [--jobs 6]
 *
 * spec.json (keep it beside the book's other files, out of git: it may quote the book):
 *   { "pages": [11, 23, 45], "truth": "<folder of pNNN.md, the checked text of some pages>",
 *     "headings": { "23": { "h1": ["1. What's a payment, anyway?"] }, "358": { "h1": [], "h2": ["Chapter 16"] } } }
 *
 * For each instruction file, page and repeat it records: Claude declining; the page check against the scan's hidden
 * text (flagged or not); words wrong against the checked text, where there is one; and whether the page's level-1
 * and level-2 headings are exactly the expected ones. Prints a summary per instruction file and writes results.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TRANSCRIBE_MODEL } from "@/lib/ai/batch";
import { checkPage, DECLINED, pageWords, wordEdits } from "@/lib/library/page-check";
import { openPdfForPictures } from "@/lib/library/page-pictures";
import { extractPdfSections } from "@/lib/library/pdf-sections";
import { readPage } from "./text-edition-on-subscription";

type Spec = { pages: number[]; truth?: string; headings?: Record<string, { h1?: string[]; h2?: string[] }> };
type Run = {
  prompt: string;
  page: number;
  repeat: number;
  declined: boolean;
  flagged: boolean;
  agreement: number | null;
  wordsWrong: number | null;
  truthWords: number | null;
  headingsRight: boolean | null;
  headings: string[];
  error?: string;
  markdown?: string;
};

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const level = (md: string, hashes: string) => (md.match(new RegExp(`^${hashes} (.+)$`, "gm")) ?? []).map((h) => h.slice(hashes.length + 1).trim());
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i].toLowerCase());

async function main() {
  const [pdf, out, specFile, ...prompts] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
  if (!pdf || !out || !specFile || prompts.length < 1) throw new Error("Usage: eval-transcribe-prompt.ts <scan.pdf> <out> <spec.json> <prompt.md>... [--repeats 2] [--jobs 6]");
  const spec = JSON.parse(readFileSync(specFile, "utf8")) as Spec;
  const repeats = Number(arg("repeats", "2"));
  const jobs = Number(arg("jobs", "6"));
  mkdirSync(out, { recursive: true });
  const bytes = new Uint8Array(readFileSync(pdf));
  const sections = await extractPdfSections(bytes);
  const hidden = (page: number) => sections.filter((s) => s.kind === "paragraph" && s.chapterIndex === page - 1).map((s) => s.text).join("\n");
  const doc = await openPdfForPictures(bytes);
  const pictures = new Map<number, string>();
  for (const p of spec.pages) pictures.set(p, (await doc.picture(p)).png.toString("base64"));
  await doc.close();
  const truth = (page: number) => {
    if (!spec.truth) return null;
    try {
      return readFileSync(join(spec.truth, `p${String(page).padStart(3, "0")}.md`), "utf8");
    } catch {
      return null;
    }
  };

  const tasks = prompts.flatMap((prompt) => spec.pages.flatMap((page) => Array.from({ length: repeats }, (_, repeat) => ({ prompt, page, repeat }))));
  const runs: Run[] = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const t = tasks[next++];
      const base: Omit<Run, "declined" | "flagged" | "agreement" | "wordsWrong" | "truthWords" | "headingsRight" | "headings"> = { prompt: t.prompt, page: t.page, repeat: t.repeat };
      try {
        const r = await readPage(arg("model", TRANSCRIBE_MODEL), pictures.get(t.page)!, readFileSync(t.prompt, "utf8"));
        const check = checkPage(r.text, hidden(t.page));
        const key = truth(t.page);
        const want = spec.headings?.[String(t.page)];
        const h1 = level(r.text, "#");
        const h2 = level(r.text, "##");
        runs.push({
          ...base,
          declined: DECLINED.test(r.text.slice(0, 200)),
          flagged: check.flagged,
          agreement: check.agreement,
          wordsWrong: key === null ? null : wordEdits(pageWords(r.text), pageWords(key)),
          truthWords: key === null ? null : pageWords(key).length,
          headingsRight: want ? (want.h1 === undefined || same(h1, want.h1)) && (want.h2 === undefined || same(h2, want.h2)) : null,
          headings: [...h1.map((h) => `# ${h}`), ...h2.map((h) => `## ${h}`)],
          markdown: r.text,
        });
      } catch (e) {
        runs.push({ ...base, declined: false, flagged: true, agreement: null, wordsWrong: null, truthWords: null, headingsRight: false, headings: [], error: e instanceof Error ? e.message : String(e) });
      }
      process.stdout.write(".");
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  console.log("");
  writeFileSync(join(out, "results.json"), JSON.stringify(runs, null, 1));

  for (const prompt of prompts) {
    const mine = runs.filter((r) => r.prompt === prompt);
    const keyed = mine.filter((r) => r.wordsWrong !== null);
    const headed = mine.filter((r) => r.headingsRight !== null);
    const wrong = keyed.reduce((n, r) => n + r.wordsWrong!, 0);
    const words = keyed.reduce((n, r) => n + r.truthWords!, 0);
    console.log(`\n${prompt}: ${mine.length} readings`);
    console.log(`  failed or declined: ${mine.filter((r) => r.error || r.declined).length}`);
    console.log(`  flagged by the page check: ${mine.filter((r) => r.flagged).length}`);
    console.log(`  words wrong against the checked text: ${wrong} of ${words} (${keyed.length} readings)`);
    console.log(`  headings as expected: ${headed.filter((r) => r.headingsRight).length} of ${headed.length}`);
    for (const r of headed.filter((x) => !x.headingsRight)) console.log(`    p. ${r.page} (try ${r.repeat + 1}): ${r.error ?? (r.headings.join(" | ") || "no headings")}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
