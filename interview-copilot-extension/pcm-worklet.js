/**
 * AudioWorklet: downsamples the captured tab audio to 16 kHz mono Float32 frames and posts
 * them to the main thread in ~100 ms blocks.
 */
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.target = 16000;
    this.ratio = sampleRate / this.target;
    this.acc = [];
    this.accLen = 0;
    this.pos = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    // Mix to mono
    const ch = input.length;
    const n = input[0].length;
    const mono = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = input[c]; for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
    // Linear-interpolation downsample
    const out = [];
    while (this.pos < n) {
      const i0 = Math.floor(this.pos);
      const i1 = Math.min(n - 1, i0 + 1);
      const frac = this.pos - i0;
      out.push(mono[i0] * (1 - frac) + mono[i1] * frac);
      this.pos += this.ratio;
    }
    this.pos -= n;
    if (out.length) { this.acc.push(Float32Array.from(out)); this.accLen += out.length; }
    if (this.accLen >= 1600) { // 100 ms at 16 kHz
      const merged = new Float32Array(this.accLen);
      let o = 0; for (const a of this.acc) { merged.set(a, o); o += a.length; }
      this.acc = []; this.accLen = 0;
      this.port.postMessage(merged, [merged.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-worklet', PcmWorklet);
