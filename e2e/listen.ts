import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cpus } from "node:os";
import { expect, test, type Page } from "@playwright/test";

/**
 * Plays the open "Read aloud" bar for 3 seconds of audio and checks that the
 * highlight moved to every word of `text` (the paragraph's opening) in order,
 * each within a tenth of a second of when the voice starts it. The fake voice
 * gives 0.03 s per character, so a word starts at 0.03 s × its offset.
 * Logs how often the browser fired "timeupdate", the event the highlight
 * used to follow (Samuel, 2026-10-04: the highlight did not keep up).
 */
export async function expectHighlightKeepsUp(page: Page, text: string) {
  const bar = page.getByRole("region", { name: "Read aloud" });
  // Record each word the highlight moves to, with the audio's clock at that moment.
  await page.evaluate(() => {
    const w = window as unknown as { seen: [string, number][]; ticks: number[] };
    w.seen = [];
    w.ticks = [];
    const a = document.querySelector("audio")!;
    a.addEventListener("timeupdate", () => w.ticks.push(performance.now()));
    const el = document.querySelector('[aria-label="Read aloud"]')!;
    new MutationObserver(() => {
      const word = el.getAttribute("data-word") ?? "";
      if (word) w.seen.push([word, a.currentTime]);
    }).observe(el, { attributes: true, attributeFilter: ["data-word"] });
  });
  await bar.getByRole("button", { name: "Play" }).click();
  await page.waitForFunction(() => document.querySelector("audio")!.currentTime > 3, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.querySelector("audio")!.pause());
  const { seen, ticks } = await page.evaluate(() => {
    const w = window as unknown as { seen: [string, number][]; ticks: number[] };
    return { seen: w.seen, ticks: w.ticks };
  });
  const gaps = ticks
    .slice(1)
    .map((t, i) => t - ticks[i])
    .sort((a, b) => a - b);
  console.log(`timeupdate fired every ${Math.round(gaps[gaps.length >> 1])} ms (median); highlight moved ${seen.length} times`);

  const words = [...text.matchAll(/\S+/g)].map((m) => ({ word: m[0], startMs: m.index! * 30 }));
  const reached = seen[seen.length - 1][1] * 1000;
  const expected = words.filter((w) => w.startMs <= reached);
  expect(expected.length).toBeGreaterThan(15);
  // Every word, in order: none skipped.
  expect(seen.map(([w]) => w)).toEqual(expected.map((w) => w.word));
  // Each shown within a tenth of a second of when the voice starts it.
  for (let i = 0; i < seen.length; i++) expect(seen[i][1] * 1000 - expected[i].startMs, `"${seen[i][0]}"`).toBeLessThan(100);
}

/**
 * One frame of an audiobook playing: the audio's time (s), the bar's word and
 * paragraph, the text lit in the book, whether paused, which audio file (the
 * number at the end of its address), where the reader is (its CFI), the
 * clock (ms, performance.now()), whether the lit word is inside the page on
 * screen (null when nothing is lit), and how long the recorder itself took
 * to read it (ms; WebKit's clock counts whole milliseconds).
 */
export type Frame = [time: number, word: string, passage: string, lit: string | null, paused: boolean, file: number, where: string, clock: number, onScreen: boolean | null, cost: number];

/** A value the page wrote to the bar ("data-word", "data-passage") or the reader ("data-cfi"), at the moment it wrote it: the clock (ms), the audio's time (s) and file then. */
export type Change = [attr: string, value: string, clock: number, time: number, file: number];

/** A timing mark the app made (lib/perf-marks.ts): its name, its time on the page's clock (ms), and its detail. */
export type Mark = { name: string; t: number; detail: Record<string, unknown> | null };

/** A font pdf.js asked the page to load (FontFace.load): when, how long the call itself held the page's thread, when it settled (-1: never), and whether it loaded. */
export type FontLoad = { family: string; style: string; t0: number; sync: number; settled: number; ok: boolean };

/**
 * What recordPlayer() saw. `frames`: at the start of each frame, before the
 * app's own frame callback runs (what every check used until now). `after`:
 * once each frame's rendering is done, so it shows what that frame painted.
 * `changes`: each attribute at the moment it was written. Then the audio's
 * events, the app's timing marks and the fonts (instrument()).
 */
export type Recording = {
  frames: Frame[];
  after: Frame[];
  changes: Change[];
  events: [string, number][];
  marks: Mark[];
  fonts: FontLoad[];
  fontEvents: [type: string, clock: number, faces: string[]][];
};

/**
 * Before the page loads (call it before page.goto): turns on the app's timing
 * marks (lib/perf-marks.ts), and records each font pdf.js asks the page to
 * load and the page's font events, for reportTiming(). Readers never run this.
 */
export async function instrument(page: Page) {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const w = window as unknown as { __nlMarks: boolean; fonts_: FontLoad[]; fontEvents_: [string, number, string[]][] };
    w.__nlMarks = true;
    w.fonts_ = [];
    w.fontEvents_ = [];
    // pdf.js asks for a font the PDF does not carry by its local names (useSystemFonts):
    // how long the call itself holds the page's thread, and whether any name was found.
    const load = FontFace.prototype.load;
    FontFace.prototype.load = function (this: FontFace) {
      const t0 = performance.now();
      const loading = load.call(this);
      const entry: FontLoad = { family: this.family, style: this.style, t0, sync: performance.now() - t0, settled: -1, ok: false };
      w.fonts_.push(entry);
      loading.then(
        () => Object.assign(entry, { settled: performance.now(), ok: true }),
        () => Object.assign(entry, { settled: performance.now() }),
      );
      return loading;
    };
    for (const type of ["loading", "loadingdone", "loadingerror"] as const) {
      document.fonts.addEventListener(type, (e) => w.fontEvents_.push([type, performance.now(), e.fontfaces.map((f) => `${f.family} ${f.style} ${f.status}`)]));
    }
  });
}

/**
 * Records, on every frame from now on, where the open "Read aloud" bar's
 * audio is and what is lit up, reading the CSS Custom Highlight in the
 * book's own frame (so a browser without that API cannot pass), and every
 * event of the audio element (M13 (d)). Each frame is read twice: at its
 * start (`frames`) and once its rendering is done (`after`); and each change
 * of the bar's word or paragraph or the reader's place is noted when it is
 * written (`changes`).
 */
export async function recordPlayer(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { frames_: unknown[]; after_: unknown[]; changes_: unknown[]; events_: [string, number][] };
    w.frames_ = [];
    w.after_ = [];
    w.changes_ = [];
    w.events_ = [];
    const a = document.querySelector("audio")!;
    for (const e of ["loadstart", "emptied", "abort", "seeking", "seeked", "waiting", "playing", "play", "pause", "ended", "error", "stalled"]) {
      a.addEventListener(e, () => w.events_.push([e, a.currentTime]));
    }
    const bar = document.querySelector('[aria-label="Read aloud"]')!;
    const reader = document.querySelector('[data-testid="reader"]')!;
    const view = document.querySelector("foliate-view") as unknown as Element & { renderer: { getContents(): { doc: Document | null }[] } };
    /** The lit text, and whether its first part lies inside the reader's view (the page on screen). */
    const lit = (): [string | null, boolean | null] => {
      for (const { doc } of view.renderer.getContents()) {
        const win = doc?.defaultView as (Window & { CSS: { highlights?: Map<string, Set<Range>> } }) | null | undefined;
        const h = win?.CSS.highlights?.get("nl-spoken");
        if (!h) continue;
        const ranges = [...h];
        const r = ranges[0]?.getBoundingClientRect();
        const frame = win?.frameElement?.getBoundingClientRect();
        const box = view.getBoundingClientRect();
        const onScreen =
          !!r && !!frame && r.width > 0 && frame.left + r.left >= box.left - 1 && frame.left + r.right <= box.right + 1 && frame.top + r.top >= box.top - 1 && frame.top + r.bottom <= box.bottom + 1;
        return [ranges.map((x) => x.toString()).join(" "), onScreen];
      }
      return [null, null];
    };
    const fileNow = () => Number(/\/audio\/(\d+)$/.exec(a.getAttribute("src") ?? "")?.[1] ?? -1);
    const sample = () => {
      const [text, onScreen] = lit();
      return [a.currentTime, bar.getAttribute("data-word") ?? "", bar.getAttribute("data-passage") ?? "", text, a.paused, fileNow(), reader.getAttribute("data-cfi") ?? "", performance.now(), onScreen, 0];
    };
    // The moment React writes the bar's word or paragraph, or the reader's place:
    // the frames below see a change only at the start of the next frame.
    const written = new MutationObserver((records) => {
      const clock = performance.now();
      for (const r of records) {
        const attr = r.attributeName!;
        w.changes_.push([attr, (r.target as Element).getAttribute(attr) ?? "", clock, a.currentTime, fileNow()]);
      }
    });
    written.observe(bar, { attributes: true, attributeFilter: ["data-word", "data-passage"] });
    written.observe(reader, { attributes: true, attributeFilter: ["data-cfi"] });
    // A message posted during a frame is handled only once that frame's rendering is
    // done: the "after" sample shows what the frame painted.
    const timed = (into: unknown[]) => {
      const start = performance.now();
      const frame = sample();
      frame[9] = performance.now() - start;
      into.push(frame);
    };
    const painted = new MessageChannel();
    painted.port1.onmessage = () => timed(w.after_);
    requestAnimationFrame(function tick() {
      timed(w.frames_);
      painted.port2.postMessage(null);
      requestAnimationFrame(tick);
    });
  });
}

export async function recording(page: Page): Promise<Recording> {
  return page.evaluate(() => {
    const w = window as unknown as {
      frames_: Frame[];
      after_?: Frame[];
      changes_?: Change[];
      events_: [string, number][];
      fonts_?: FontLoad[];
      fontEvents_?: [string, number, string[]][];
    };
    const marks = performance
      .getEntriesByType("mark")
      .filter((m) => m.name.startsWith("nl:"))
      .map((m) => ({ name: m.name, t: m.startTime, detail: ((m as PerformanceMark).detail ?? null) as Record<string, unknown> | null }));
    return { frames: w.frames_, after: w.after_ ?? [], changes: w.changes_ ?? [], events: w.events_, marks, fonts: w.fonts_ ?? [], fontEvents: w.fontEvents_ ?? [] };
  });
}

/** A word the audiobook says on the page: its text, when it starts (ms in its audio file), its file, and its paragraph's CFI. */
export type Spoken = { word: string; startMs: number; file: number; cfi: string };

/** Each value a column took, in order, with the frame where it first showed (repeats collapsed). */
function changes(frames: Frame[], col: 1 | 2 | 3) {
  const out: { value: string; frame: Frame; at: number }[] = [];
  frames.forEach((f, at) => {
    const v = (f[col] as string | null) ?? "";
    if (v && out.at(-1)?.value !== v) out.push({ value: v, frame: f, at });
  });
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
};

/**
 * When a word starts on the page's clock (ms): its time in its audio file
 * minus the audio's lead over the clock, the median over the frames that
 * played that file within 1.5 s of it. One stale read of the audio's time
 * (CI run 37392862541: the audio's time moved 5 ms while the clock moved 48)
 * cannot move a median. NaN without five such frames.
 */
export function clockAt(frames: Frame[], w: Spoken) {
  const near = frames.filter((f) => !f[4] && f[5] === w.file && f[0] > 0.2 && Math.abs(f[0] * 1000 - w.startMs) < 1500);
  return near.length >= 5 ? w.startMs - median(near.map((f) => f[0] * 1000 - f[7])) : NaN;
}

/** The bar's word as React wrote it, as frames (only the time, word, file and clock are filled in). */
const writtenFrames = (rec: Recording): Frame[] =>
  rec.changes.filter((c) => c[0] === "data-word").map(([, value, clock, time, file]) => [time, value, "", null, false, file, "", clock, null, 0]);

/**
 * The highlight landed on every word in order, none skipped and none extra,
 * each within a tenth of a second of when the audio starts it, both in the
 * bar's record and in the book's own highlight, up to where the audio got
 * to; with `onScreen`, each lit word was also inside the page on screen
 * within that tenth of a second (the page turned in time); and the
 * paragraphs followed one another. `expected` is in reading order; a word may
 * not repeat the one before it (a repeat would not show as a change, so the
 * test could not see it).
 */
export function expectEveryWordOnTime(frames: Frame[], expected: Spoken[], opts: { minWords: number; onScreen?: boolean }) {
  expected.forEach((w, i) => expect(w.word, `word ${i} repeats the one before it; choose other paragraphs`).not.toBe(expected[i - 1]?.word));
  // How far the audio got in each file.
  const reached = new Map<number, number>();
  for (const f of frames) if (f[5] >= 0) reached.set(f[5], Math.max(reached.get(f[5]) ?? 0, f[0] * 1000));
  // Every word that started at least 120 ms before the audio got there must have been shown.
  const due = expected.filter((w) => w.startMs <= (reached.get(w.file) ?? -Infinity) - 120).length;
  for (const col of [1, 3] as const) {
    const seen = changes(frames, col);
    const name = col === 1 ? "bar" : "book highlight";
    expect(seen.length, `${name}: words shown`).toBeGreaterThanOrEqual(opts.minWords);
    expect(seen.length, `${name}: words shown, of ${due} due`).toBeGreaterThanOrEqual(due);
    expect(
      seen.map((s) => s.value),
      name,
    ).toEqual(expected.slice(0, seen.length).map((w) => w.word));
    seen.forEach((s, i) => {
      expect(s.frame[5], `${name}: "${s.value}" (word ${i}) shown while another file played`).toBe(expected[i].file);
      const late = s.frame[0] * 1000 - expected[i].startMs;
      expect(late, `${name}: "${s.value}" (word ${i}) shown ${Math.round(late)} ms after it starts`).toBeLessThan(100);
      expect(late, `${name}: "${s.value}" (word ${i}) shown before it starts`).toBeGreaterThanOrEqual(-1);
      if (col === 3 && opts.onScreen) {
        const soon = frames.slice(s.at).filter((f) => f[3] === s.value && f[0] * 1000 < expected[i].startMs + 100);
        expect(soon.some((f) => f[8] === true), `"${s.value}" (word ${i}) was not on the page on screen within 0.1 s`).toBe(true);
      }
    });
  }
  // The bar moved through the paragraphs in order.
  const paragraphs = changes(frames, 2).map((s) => s.value);
  const order = [...new Set(expected.map((w) => w.cfi))];
  expect(paragraphs).toEqual(order.slice(0, paragraphs.length));
  return { paragraphs };
}

/**
 * The audio never stood still while playing: within each file, from shortly
 * after it starts, the audio's clock kept pace with the wall clock, losing at
 * most `maxLagMs` in all (a stall fires no "pause" event, so only this can
 * see it).
 */
export function expectNoStall(frames: Frame[], maxLagMs = 400) {
  for (const file of new Set(frames.map((f) => f[5]).filter((x) => x >= 0))) {
    const playing = frames.filter((f) => f[5] === file && !f[4]);
    if (playing.length < 2) continue;
    // From when the audio is moving on from its starting point: the first change of its time
    // is the jump to where it starts (or its first step), and loading there is not a stall.
    const k = Math.max(0, playing.findIndex((f, i) => i > 0 && f[0] !== playing[i - 1][0]));
    const begin = playing.slice(k).find((f) => f[0] > playing[k][0] + 0.1) ?? playing[k];
    const end = playing.at(-1)!;
    const lag = end[7] - begin[7] - (end[0] - begin[0]) * 1000;
    expect(lag, `file ${file}: the audio fell ${Math.round(lag)} ms behind the clock (stalled)`).toBeLessThan(maxLagMs);
  }
}

/** One word's lateness (ms after the voice starts it) by each way of seeing it; null where it was not seen. */
export type WordTiming = {
  i: number;
  word: string;
  /** As checked today: the audio's time at the start of the first frame that showed it, in the bar and in the book. */
  barFrame: number | null;
  litFrame: number | null;
  /** The bar's word when React wrote it: by the audio's time then, and by the page's clock (clockAt). */
  barWritten: number | null;
  barWrittenClock: number | null;
  /** The book's highlight once the first frame that painted it was done: by the audio's time, and by the page's clock. */
  litPainted: number | null;
  litPaintedClock: number | null;
};

export function wordTimings(rec: Recording, expected: Spoken[]): WordTiming[] {
  const bar = changes(rec.frames, 1);
  const lit = changes(rec.frames, 3);
  const painted = changes(rec.after, 3);
  const written = changes(writtenFrames(rec), 1);
  const ms = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
  return expected.map((w, i) => {
    const start = clockAt(rec.frames, w);
    const at = (s: { value: string; frame: Frame } | undefined) => (s?.value === w.word ? s.frame : null);
    const [b, l, p, c] = [at(bar[i]), at(lit[i]), at(painted[i]), at(written[i])];
    return {
      i,
      word: w.word,
      barFrame: b && ms(b[0] * 1000 - w.startMs),
      litFrame: l && ms(l[0] * 1000 - w.startMs),
      barWritten: c && ms(c[0] * 1000 - w.startMs),
      barWrittenClock: c && ms(c[7] - start),
      litPainted: p && ms(p[0] * 1000 - w.startMs),
      litPaintedClock: p && ms(p[7] - start),
    };
  });
}

/** Everything recorded within `ms` of a word's start, in order: [ms from the word's start on the page's clock, what happened]. */
export function timelineAround(rec: Recording, w: Spoken, ms = 300): [number, string][] {
  const start = clockAt(rec.frames, w);
  const near = (t: number) => t >= start - ms && t <= start + ms;
  const rel = (t: number) => Math.round(t - start);
  const out: [number, string][] = [];
  for (const m of rec.marks) if (near(m.t)) out.push([rel(m.t), `${m.name.slice(3)} ${JSON.stringify(m.detail ?? {})}`]);
  for (const f of rec.fonts) {
    if (!near(f.t0)) continue;
    const end = f.settled < 0 ? "never settled" : `${f.ok ? "loaded" : "FAILED"} at ${rel(f.settled)}`;
    out.push([rel(f.t0), `font ${f.family} ${f.style}: load() held the page ${Math.round(f.sync)} ms; ${end}`]);
  }
  for (const [type, t, faces] of rec.fontEvents) if (near(t)) out.push([rel(t), `document.fonts ${type}: ${faces.join(", ")}`]);
  for (const [attr, value, t] of rec.changes) if (near(t)) out.push([rel(t), `${attr} written: "${value}"`]);
  rec.frames.forEach((f, k) => {
    const prev = rec.frames[k - 1];
    if (!prev || !near(f[7])) return;
    if (f[7] - prev[7] >= 25) out.push([rel(prev[7]), `no new frame for ${Math.round(f[7] - prev[7])} ms`]);
    if (prev[3] !== f[3]) out.push([rel(f[7]), f[3] === null ? "frame start: nothing lit" : `frame start: book shows "${f[3]}"`]);
    if (prev[1] !== f[1]) out.push([rel(f[7]), `frame start: bar shows "${f[1]}"`]);
    if (f[9] >= 2) out.push([rel(f[7]), `the recorder itself took ${Math.round(f[9])} ms`]);
  });
  rec.after.forEach((f, k) => {
    const prev = rec.after[k - 1];
    if (prev && near(f[7]) && prev[3] !== f[3]) out.push([rel(f[7]), f[3] === null ? "after paint: nothing lit" : `after paint: book shows "${f[3]}"`]);
  });
  return out.sort((a, b) => a[0] - b[0]);
}

/** The page turn and lighting around one word, in ms from its start on the page's clock (null: did not happen within 0.4 s). */
function phasesOf(rec: Recording, w: Spoken) {
  const start = clockAt(rec.frames, w);
  const within = (t: number) => t >= start - 400 && t <= start + 400;
  const first = (name: string, match: (d: Record<string, unknown>) => boolean = () => true) => rec.marks.find((m) => m.name === name && within(m.t) && match(m.detail ?? {}));
  const rel = (m: Mark | undefined) => (m ? Math.round(m.t - start) : null);
  const lit = first("nl:lit", (d) => d.text === w.word);
  const fonts = rec.fonts.filter((f) => within(f.t0));
  const gaps = rec.frames.flatMap((f, k) => (k && within(f[7]) ? [f[7] - rec.frames[k - 1][7]] : []));
  return {
    turnRequest: rel(first("nl:turn-request")),
    frameLoad: rel(first("nl:frame-load")),
    relocate: rel(first("nl:relocate")),
    textlayerStart: rel(first("nl:textlayer-start")),
    textAhead: (first("nl:textlayer-start")?.detail?.ahead as boolean | undefined) ?? null,
    textlayerReady: rel(first("nl:textlayer-ready")),
    drawStart: rel(first("nl:draw-start")),
    drawDone: rel(first("nl:draw-done")),
    litSet: rel(lit),
    litVia: (lit?.detail?.via as string | undefined) ?? null,
    waits: rec.marks.filter((m) => m.name === "nl:word-wait" && within(m.t)).length,
    barSet: rel(first("nl:bar-set", (d) => d.text === w.word)),
    fontLoads: fonts.length,
    fontFailed: fonts.filter((f) => f.settled >= 0 && !f.ok).length,
    fontHeldMs: Math.round(Math.max(0, ...fonts.map((f) => f.sync))),
    longestFrameMs: Math.round(Math.max(0, ...gaps)),
  };
}

const TIMING_COLUMNS = ["barFrame", "litFrame", "barWritten", "litPainted"] as const;
const later = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
/** A word's lateness in a column as the check reads it: for the bar written and the highlight painted, the later of the audio's time and the page's clock (the `timing` option). */
const checked = (r: WordTiming, k: (typeof TIMING_COLUMNS)[number]) =>
  k === "barWritten" ? later(r.barWritten, r.barWrittenClock) : k === "litPainted" ? later(r.litPainted, r.litPaintedClock) : r[k];

/**
 * Prints and attaches, before any check runs, how late each word was by each
 * way of seeing it, and for the word `focus` (an index into `expected`)
 * everything recorded within 0.3 s of it. One JSON line also goes to the log
 * (TIMING_JSON, so a CI log is enough to collect it) and, when NL_TIMING_LOG
 * names a file, to that file, for scripts/timing-summary.mjs.
 */
export async function reportTiming(rec: Recording, expected: Spoken[], opts: { label: string; focus?: number }) {
  const info = test.info();
  const words = wordTimings(rec, expected);
  const latest = (k: (typeof TIMING_COLUMNS)[number]) =>
    words.reduce<WordTiming | null>((m, r) => (checked(r, k) !== null && (m === null || (checked(r, k) ?? 0) > (checked(m, k) ?? 0)) ? r : m), null);
  const count = (k: (typeof TIMING_COLUMNS)[number], limit: number) => words.filter((r) => (checked(r, k) ?? -Infinity) >= limit).length;
  // Whether the two new readings behave as they should (needed before the check uses them): each
  // after-paint sample should come before the next frame starts, and on ordinary words the frame
  // readings should be about one frame later than the readings where the change happens.
  const lag = (a: "barFrame" | "litFrame", b: "barWritten" | "litPainted") =>
    median(words.flatMap((r) => (r[a] !== null && r[b] !== null ? [r[a]! - r[b]!] : [])));
  const w = opts.focus === undefined ? null : expected[opts.focus];
  const summary = {
    label: opts.label,
    project: info.project.name,
    repeat: info.repeatEachIndex,
    sha: process.env.NL_SHA ?? process.env.GITHUB_SHA ?? null,
    machine: process.env.NL_MACHINE ?? null,
    trace: process.env.NL_TRACE ?? null,
    cpu: `${cpus().length} × ${cpus()[0]?.model ?? "?"}`,
    words: words.length,
    atLeast100: Object.fromEntries(TIMING_COLUMNS.map((k) => [k, count(k, 100)])),
    atLeast80: Object.fromEntries(TIMING_COLUMNS.map((k) => [k, count(k, 80)])),
    latest: Object.fromEntries(
      TIMING_COLUMNS.map((k) => {
        const r = latest(k);
        return [k, r && { i: r.i, word: r.word, ms: checked(r, k) }];
      }),
    ),
    focus: w && { ...words[opts.focus!], phases: phasesOf(rec, w) },
    fonts: {
      loads: rec.fonts.length,
      failed: rec.fonts.filter((f) => f.settled >= 0 && !f.ok).length,
      heldMaxMs: Math.round(Math.max(0, ...rec.fonts.map((f) => f.sync))),
    },
    afterMissing: rec.frames.length - rec.after.length,
    afterLate: rec.after.filter((f, k) => k + 1 < rec.frames.length && f[7] > rec.frames[k + 1][7]).length,
    barFrameMinusWritten: Math.round(lag("barFrame", "barWritten") * 10) / 10,
    litFrameMinusPainted: Math.round(lag("litFrame", "litPainted") * 10) / 10,
    recorderMaxMs: Math.round(Math.max(0, ...[...rec.frames, ...rec.after].map((f) => f[9] ?? 0))),
    recorderTotalMs: Math.round([...rec.frames, ...rec.after].reduce((sum, f) => sum + (f[9] ?? 0), 0)),
  };
  const lines = [`Timing, ${opts.label} [${info.project.name}]: ms after the voice starts each word (the check today reads barFrame and litFrame; limit 100)`];
  for (const k of TIMING_COLUMNS) {
    const r = summary.latest[k];
    lines.push(`  ${k.padEnd(10)} latest: ${r ? `"${r.word}" (word ${r.i}) ${Math.round(r.ms ?? NaN)} ms` : "none"}; words at 100+: ${summary.atLeast100[k]}, at 80+: ${summary.atLeast80[k]}`);
  }
  if (w && summary.focus) {
    const f = summary.focus;
    lines.push(`  "${w.word}" (word ${opts.focus}): barFrame ${f.barFrame}, litFrame ${f.litFrame}, barWritten ${f.barWritten}, litPainted ${f.litPainted} (page clock: ${f.barWrittenClock}, ${f.litPaintedClock})`);
    for (const [t, what] of timelineAround(rec, w)) lines.push(`    ${String(t).padStart(5)} ms  ${what}`);
  }
  console.log(lines.join("\n"));
  console.log(`TIMING_JSON ${JSON.stringify(summary)}`);
  const file = info.outputPath(`${opts.label}-timing.json`);
  writeFileSync(file, JSON.stringify({ summary, words, recording: rec }));
  await info.attach(`${opts.label}-timing.json`, { path: file, contentType: "application/json" });
  if (process.env.NL_TIMING_LOG) {
    mkdirSync(dirname(process.env.NL_TIMING_LOG), { recursive: true }); // a missing folder must not fail the test it measures
    appendFileSync(process.env.NL_TIMING_LOG, `${JSON.stringify(summary)}\n`);
  }
  return summary;
}
