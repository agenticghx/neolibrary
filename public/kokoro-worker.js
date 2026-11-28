const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_CDN = "https://esm.sh/kokoro-js@1.2.1";

let ttsPromise = null;
let queue = Promise.resolve();

async function loadTts() {
  if (ttsPromise) return ttsPromise;
  ttsPromise = (async () => {
    const { KokoroTTS } = await import(KOKORO_CDN);
    const hasGpu = typeof navigator !== "undefined" && "gpu" in navigator;
    const progress_callback = (info) => {
      if (info && info.status === "progress" && typeof info.progress === "number") {
        self.postMessage({ type: "progress", percent: Math.min(99, Math.max(1, Math.round(info.progress))) });
      }
    };
    const load = (device) =>
      KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: device === "webgpu" ? "fp32" : "q8",
        device,
        progress_callback,
      });

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

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || msg.type !== "speak") return;
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
