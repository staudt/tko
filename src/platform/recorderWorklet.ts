// Mic recorder worklet: copies input into a preallocated chunk and posts it when full.
// AUDIO THREAD RULES: no allocations in process() except the throttled chunk post (one per
// CHUNK frames, about every 85 ms); no closures created per block; nothing else crosses the port.

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;

const CHUNK = 4096;

class RecorderProcessor extends AudioWorkletProcessor {
  private buf = new Float32Array(CHUNK);
  private fill = 0;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    // 'flush' (on stop, not real time): post the partial chunk, then confirm.
    this.port.onmessage = () => {
      if (this.fill > 0) this.port.postMessage({ type: 'chunk', data: this.buf.slice(0, this.fill) });
      this.fill = 0;
      this.port.postMessage({ type: 'flushed' });
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    let i = 0;
    const n = ch.length;
    while (i < n) {
      const take = Math.min(n - i, CHUNK - this.fill);
      this.buf.set(ch.subarray(i, i + take), this.fill);
      this.fill += take;
      i += take;
      if (this.fill === CHUNK) {
        this.port.postMessage({ type: 'chunk', data: this.buf }); // structured clone; buf is reused
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('tko-recorder', RecorderProcessor);
