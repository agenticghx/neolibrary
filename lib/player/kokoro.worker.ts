/// <reference lib="webworker" />

type KokoroInstance = {
  generate: (text: string, opts: { voice: string }) => Promise<{
    audio: Float32Array;
    sampling_rate: number;
    toBlob: () => Blob;
  }>;
};

type SpeakMessage = { type: "speak"; id: number; text: string; voice: string };

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let ttsPromise: Promise<KokoroInstance> | null = null;
let queue: Promise<void> = Promise.resolve();

async function loadTts(): Promise<KokoroInstance> {
  if (ttsPromise) return ttsPromise;
  ttsPromise = (async () => {
    const { KokoroTTS } = await import("kokoro-js");
    const hasGpu = typeof navigator !== "undefined" && "gpu" in navigator;
    const progress_callback = (info: { status?: string; progress?: number }) => {
      if (info.status === "progress" && typeof info.progress === "number") {
        self.postMessage({ type: "progress", percent: Math.min(99, Math.max(1, Math.round(info.progress))) });
      }
    };
    const load = (device: "webgpu" | "wasm") =>
      KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: device === "webgpu" ? "fp32" : "q8",
        device,
        progress_callback,
      }) as unknown as Promise<KokoroInstance>;

    if (hasGpu) {
      try {
        return await load("webgpu");
      } catch {
        // Fall back to WASM if WebGPU adapter initialization fails.
      }
    }
    return await load("wasm");
  })();
  ttsPromise.catch(() => {
    ttsPromise = null;
  });
  return ttsPromise;
}

self.onmessage = (ev: MessageEvent<SpeakMessage>) => {
  const msg = ev.data;
  if (msg.type !== "speak") return;
  // Serialize inference calls so prefetch and active playback never fight over the model.
  queue = queue.then(async () => {
    try {
      const tts = await loadTts();
      const out = await tts.generate(msg.text, { voice: msg.voice });
      const blob = out.toBlob();
      const wav = await blob.arrayBuffer();
      const durationMs = Math.max(200, Math.round((out.audio.length / out.sampling_rate) * 1000));
      self.postMessage({ type: "done", id: msg.id, wav, durationMs }, [wav]);
    } catch (e) {
      self.postMessage({ type: "error", id: msg.id, message: e instanceof Error ? e.message : "Local voice failed to speak." });
    }
  });
};
