import type { WordTiming } from "@/lib/speech/timings";

/** Prefix for browser-local neural voices (Kokoro-82M via WebGPU/WASM, $0 cost). */
export const LOCAL_VOICE_PREFIX = "local:";

export const LOCAL_VOICES = [
  { id: "local:af_heart", name: "Heart (Local · free)" },
  { id: "local:af_bella", name: "Bella (Local · free)" },
  { id: "local:bm_george", name: "George (Local · free)" },
] as const;

export const isLocalVoice = (voice: string): boolean => voice.startsWith(LOCAL_VOICE_PREFIX);

export const localVoiceKey = (voice: string): string =>
  voice.startsWith(LOCAL_VOICE_PREFIX) ? voice.slice(LOCAL_VOICE_PREFIX.length) : "af_heart";

/**
 * Estimates per-word start/end timestamps (ms) across `durationMs` weighted by
 * character length and natural punctuation pauses. Used for browser-local
 * Kokoro audio so the reader's live word highlight glides smoothly across the
 * paragraph without needing a separate server-side aligner.
 */
export function estimateWordTimings(text: string, durationMs: number): WordTiming[] {
  const matches = [...text.matchAll(/\S+/g)];
  if (!matches.length || durationMs <= 0) return [];
  const weights = matches.map((m) => {
    const word = m[0];
    const base = Math.max(1.5, word.replace(/[^A-Za-z0-9]/g, "").length || word.length);
    const pause = /[.!?]["”’)\]]*$/.test(word) ? 4.5 : /[,;:]["”’)\]]*$/.test(word) ? 2.2 : 0;
    return base + pause;
  });
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const out: WordTiming[] = [];
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const from = m.index!;
    const to = from + m[0].length;
    const startMs = Math.round((cursor / total) * durationMs);
    cursor += weights[i];
    const endMs = i === matches.length - 1 ? Math.round(durationMs) : Math.max(startMs + 20, Math.round((cursor / total) * durationMs));
    out.push([startMs, endMs, from, to]);
  }
  return out;
}

export type LocalTrack = {
  audioUrl: string;
  durationMs: number;
  words: WordTiming[];
};

type WorkerReply =
  | { type: "progress"; percent: number }
  | { type: "done"; id: number; wav: ArrayBuffer; durationMs: number }
  | { type: "error"; id: number; message: string };

const MAX_CACHE = 16;
const cache = new Map<string, LocalTrack>();
const inflight = new Map<string, Promise<LocalTrack>>();
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: { wav: ArrayBuffer; durationMs: number }) => void; reject: (e: Error) => void }>();
const progressListeners = new Set<(pct: number | null) => void>();

function notifyProgress(pct: number | null) {
  for (const fn of progressListeners) fn(pct);
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker("/kokoro-worker.js", { type: "module" });
  worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
    const msg = ev.data;
    if (msg.type === "progress") {
      notifyProgress(msg.percent >= 100 ? null : msg.percent);
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.type === "done") {
      notifyProgress(null);
      p.resolve({ wav: msg.wav, durationMs: msg.durationMs });
    } else {
      notifyProgress(null);
      p.reject(new Error(msg.message));
    }
  };
  worker.onerror = () => {
    const err = new Error("Local voice could not start in this browser.");
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    notifyProgress(null);
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function cacheKey(voice: string, text: string) {
  return `${voice}\0${text}`;
}

function remember(key: string, track: LocalTrack) {
  cache.set(key, track);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) {
      const dropped = cache.get(oldest);
      cache.delete(oldest);
      if (dropped) URL.revokeObjectURL(dropped.audioUrl);
    }
  }
}

/** Synthesizes `text` locally in the browser via Kokoro-82M, returning a cached WAV Blob URL and word timings. */
export async function synthesizeLocal(
  text: string,
  voice: string,
  onProgress?: (pct: number | null) => void,
): Promise<LocalTrack> {
  const key = cacheKey(voice, text);
  const hit = cache.get(key);
  if (hit) return hit;

  if (onProgress) progressListeners.add(onProgress);
  try {
    let job = inflight.get(key);
    if (!job) {
      const id = nextId++;
      const w = getWorker();
      job = new Promise<{ wav: ArrayBuffer; durationMs: number }>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ type: "speak", id, text, voice: localVoiceKey(voice) });
      })
        .then(({ wav, durationMs }) => {
          const blob = new Blob([wav], { type: "audio/wav" });
          const track: LocalTrack = {
            audioUrl: URL.createObjectURL(blob),
            durationMs,
            words: estimateWordTimings(text, durationMs),
          };
          remember(key, track);
          return track;
        })
        .finally(() => {
          inflight.delete(key);
        });
      inflight.set(key, job);
    }
    return await job;
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
}

/** Silently prepares the next paragraph in the background so there is zero pause at paragraph boundaries. */
export function prefetchLocal(text: string, voice: string) {
  if (!text.trim() || !isLocalVoice(voice)) return;
  const key = cacheKey(voice, text);
  if (cache.has(key) || inflight.has(key)) return;
  void synthesizeLocal(text, voice).catch(() => {});
}
