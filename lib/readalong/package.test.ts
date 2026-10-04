import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { strFromU8, strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildPackage } from "./fixture";
import { checkPackage, isForBook, PackageError, parsePackage, readPackageZip } from "./package";

/**
 * M13 (a): reading and checking a read-along package. The TypeScript checker
 * must give the same verdict as the skill's Python one
 * (`tools/readalong/validate_package.py`) on the same packages, good and
 * broken. Needs python3 (present on GitHub's runners).
 */
const book = strToU8("pretend this is the EPUB");

const good = () =>
  buildPackage({
    bookBytes: book,
    chapters: [
      {
        title: "Chapter V",
        paragraphs: ["Chapter Five.", "It was on a dreary night of November, that I beheld the accomplishment of my toils.", "“Like one who, on a lonely road, doth walk in fear and dread.”"],
        notSpoken: [18, 19, 20],
        inBook: [null, 0, 1],
      },
      { title: "Chapter VI", paragraphs: ["Clerval then put the following letter into my hands."], inBook: [2] },
    ],
  });

type Files = Record<string, Uint8Array>;
const edit = (files: Files, name: string, change: (v: never) => unknown): Files => ({
  ...files,
  [name]: strToU8(JSON.stringify(change(JSON.parse(strFromU8(files[name])) as never))),
});

/** The Python checker's verdict: ok, or the list of errors it printed. */
function pythonVerdict(files: Files) {
  const dir = mkdtempSync(join(tmpdir(), "readalong-"));
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), bytes);
  }
  try {
    const out = execFileSync("python3", ["tools/readalong/validate_package.py", dir], { encoding: "utf8" });
    return { ok: true, errors: [] as string[], summary: out.trim() };
  } catch (e) {
    const out = String((e as { stdout?: string }).stdout ?? "");
    return { ok: false, errors: out.split("\n").filter((l) => l.startsWith("ERROR: ")).map((l) => l.slice(7)), summary: null };
  }
}

function typescriptVerdict(files: Files) {
  return checkPackage(parsePackage(files), { audio: Object.fromEntries(Object.entries(files).filter(([n]) => n.startsWith("audio/"))), requireAudio: true });
}

const pyNumberish = (s: string) => s.replace(/(\d+)\.0\b/g, "$1"); // Python prints 0.0 where JavaScript prints 0

describe("read-along packages", () => {
  it("reads a zip with the files at its root or in one folder", () => {
    const { files } = good();
    for (const zip of [zipSync(files), zipSync(Object.fromEntries(Object.entries(files).map(([n, b]) => [`frankenstein-readalong/${n}`, b])))]) {
      const read = readPackageZip(zip);
      expect(Object.keys(read).sort()).toEqual(Object.keys(files).sort());
    }
    expect(() => readPackageZip(strToU8("not a zip"))).toThrow(PackageError);
    expect(() => readPackageZip(zipSync({ "readme.txt": strToU8("hi") }))).toThrow("No manifest.json in this package.");
  });

  it("accepts a good package, says how many words were not spoken, and knows which book it is for", () => {
    const { files } = good();
    const v = typescriptVerdict(files);
    expect(v.errors).toEqual([]);
    expect(v.summary).toBe("Package OK: 2 chapters, 40 words (3 not spoken); warnings: 1 of 4 paragraphs not found in the book (spoken headings are expected here)");
    expect(isForBook(parsePackage(files), book)).toBe(true);
    expect(isForBook(parsePackage(files), strToU8("another book"))).toBe(false);
    // The audio may come later (signed upload): without it the rest still checks.
    expect(checkPackage(parsePackage(files)).ok).toBe(true);
    expect(checkPackage(parsePackage(files), { requireAudio: true }).errors).toEqual(["missing audio/01.wav", "missing audio/02.wav"]);
  });

  const broken: [string, (f: Files) => Files][] = [
    ["wrong format name", (f) => edit(f, "manifest.json", (m: { format: string }) => ({ ...m, format: "something-else/9" }))],
    ["audio swapped after packaging", (f) => ({ ...f, "audio/01.wav": f["audio/02.wav"] })],
    ["a word missing from the timings", (f) => edit(f, "timings/01.json", (t: { words: unknown[] }) => ({ words: t.words.slice(1) }))],
    ["offsets pointing at the wrong word", (f) => edit(f, "timings/01.json", (t: { words: { from: number }[] }) => ({ words: t.words.map((w, i) => (i === 4 ? { ...w, from: w.from + 1 } : w)) }))],
    ["a word marked not spoken that has a time", (f) => edit(f, "timings/01.json", (t: { words: { source: string }[] }) => ({ words: t.words.map((w, i) => (i === 2 ? { ...w, source: "not_spoken" } : w)) }))],
    ["a time past the end of the chapter", (f) => edit(f, "timings/02.json", (t: { words: { start: number; end: number }[] }) => ({ words: t.words.map((w, i) => (i === 3 ? { ...w, start: 99, end: 99.5 } : w)) }))],
    ["a word starting before the one before it", (f) => edit(f, "timings/01.json", (t: { words: { start: number }[] }) => ({ words: t.words.map((w, i) => (i === 6 ? { ...w, start: 0 } : w)) }))],
  ];

  it.each(broken)("refuses a package with %s, exactly as the Python checker does", (_, breakIt) => {
    const files = breakIt(good().files);
    const ts = typescriptVerdict(files);
    const py = pythonVerdict(files);
    expect(ts.ok).toBe(false);
    expect(py.ok).toBe(false);
    expect(ts.errors.map(pyNumberish)).toEqual(py.errors.map(pyNumberish));
  });

  it("gives the same verdict and summary as the Python checker on a good package", () => {
    const { files } = good();
    const py = pythonVerdict(files);
    expect(py.ok).toBe(true);
    expect(typescriptVerdict(files).summary).toBe(py.summary);
  });

  it("counts characters as Python does, so curly quotes and emoji do not shift the offsets", () => {
    const { files } = buildPackage({ bookBytes: book, chapters: [{ title: "One", paragraphs: ["“Quoted” words 🙂 then more words after the emoji."] }] });
    // The fixture counts UTF-16 units; rewrite its offsets in code points, as the skill writes them.
    const text = strFromU8(files["scripts/01.txt"]);
    const points = [...text];
    let at = 0;
    const fixed = edit(files, "timings/01.json", (t: { words: { w: string }[] }) => ({
      words: t.words.map((w) => {
        while (points.slice(at, at + [...w.w].length).join("") !== w.w) at++;
        const out = { ...w, from: at, to: at + [...w.w].length };
        at += [...w.w].length;
        return out;
      }),
    }));
    expect(typescriptVerdict(fixed).ok).toBe(true);
    expect(pythonVerdict(fixed).ok).toBe(true);
  });
});
