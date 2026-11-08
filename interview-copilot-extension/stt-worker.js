/**
 * Speech-to-text worker: runs Whisper locally with transformers.js (WebGPU when available,
 * otherwise WASM). Receives 16 kHz Float32 audio segments, replies with text.
 */
import { pipeline, env } from './vendor/transformers.min.js';

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/', self.location.href).href;
env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, (self.navigator?.hardwareConcurrency || 4) - 1));

// GPU: base.en is fast and accurate. CPU (WASM): tiny.en keeps latency usable; base.en is
// available as "accurate" if the machine can afford it.
const MODELS = {
  gpu: 'onnx-community/whisper-base.en',
  cpu: 'onnx-community/whisper-tiny.en',
  accurate: 'onnx-community/whisper-base.en'
};

let transcriber = null;
let loading = null;
let device = 'wasm';

async function load(modelKey = 'fast') {
  if (transcriber) return transcriber;
  if (loading) return loading;
  loading = (async () => {
    // Probe for a usable GPU adapter first: some machines expose navigator.gpu but have no adapter.
    let hasGpu = false;
    try { hasGpu = !!(self.navigator?.gpu && await self.navigator.gpu.requestAdapter()); } catch { hasGpu = false; }
    const attempts = hasGpu ? ['webgpu', 'wasm'] : ['wasm'];
    self.postMessage({ type: 'log', message: `GPU adapter: ${hasGpu ? 'available' : 'not available'}` });
    let lastErr;
    for (const dev of attempts) {
      try {
        const modelId = modelKey === 'accurate' ? MODELS.accurate : (dev === 'webgpu' ? MODELS.gpu : MODELS.cpu);
        self.postMessage({ type: 'log', message: `Loading ${modelId} on ${dev}` });
        const t = await pipeline('automatic-speech-recognition', modelId, {
          device: dev,
          dtype: dev === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
          progress_callback: (p) => {
            if (p.status === 'progress' && p.file) self.postMessage({ type: 'progress', file: p.file, progress: Math.round(p.progress || 0) });
          }
        });
        device = dev;
        transcriber = t;
        return t;
      } catch (err) {
        lastErr = err;
        self.postMessage({ type: 'log', message: `Whisper on ${dev} failed: ${err.message}` });
      }
    }
    throw lastErr;
  })();
  try { return await loading; } finally { loading = null; }
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      await load(msg.model);
      self.postMessage({ type: 'ready', device, model: transcriber?.model?.config?._name_or_path || '' });
    } else if (msg.type === 'transcribe') {
      const t = await load(msg.model);
      const started = performance.now();
      const out = await t(msg.audio, { chunk_length_s: 30, return_timestamps: false });
      const text = String(out?.text || '').trim();
      self.postMessage({ type: 'result', id: msg.id, text, ms: Math.round(performance.now() - started), final: msg.final !== false });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, error: err.message || String(err) });
  }
};
