// Stereo-linked lookahead peak limiter. AUDIO THREAD CODE: no allocations after construction.
//
// Guarantee: |output| <= ceiling. For each input sample we compute the gain it needs
// (req = ceiling / |x|, capped at 1). The output is the input delayed by N samples, multiplied by
// the N-sample box average of a gain curve that (a) is the minimum of req over the last N+1
// samples and (b) attacks instantly and releases smoothly. Every term in the average covers the
// delayed sample's window, so the averaged gain never exceeds the gain that sample needs, while
// the averaging turns the instant attack into an N-sample ramp (no clicks).

export class Limiter {
  private readonly n: number;
  private readonly ceiling: number;
  private readonly releaseK: number;
  private readonly dl: Float32Array;
  private readonly dr: Float32Array;
  // Sliding-window minimum of the required gain over the last N+1 samples, as a monotonic deque
  // (ring buffers of sample index and value): O(1) amortized per sample.
  private readonly qIdx: Float64Array;
  private readonly qVal: Float32Array;
  private qHead = 0;
  private qLen = 0;
  private t = 0;
  private readonly sm: Float64Array; // ring of the last N smoothed gains (box average)
  private w = 0;
  private smW = 0;
  private smSum: number;
  private g = 1;
  /** Current gain reduction (1 = none), for meters. */
  gain = 1;
  /** Times the hard safety clamp engaged (should stay 0; tests assert it). */
  clamped = 0;

  constructor(sampleRate: number, lookaheadMs = 1.5, ceiling = 0.98, releaseMs = 120) {
    this.n = Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate));
    this.ceiling = ceiling;
    this.releaseK = 1 - Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
    this.dl = new Float32Array(this.n);
    this.dr = new Float32Array(this.n);
    this.qIdx = new Float64Array(this.n + 2);
    this.qVal = new Float32Array(this.n + 2);
    this.sm = new Float64Array(this.n).fill(1);
    this.smSum = this.n;
  }

  /** Latency in samples. */
  get latency(): number {
    return this.n;
  }

  process(l: Float32Array, r: Float32Array, frames: number): void {
    const n = this.n;
    const cap = n + 2;
    const qIdx = this.qIdx;
    const qVal = this.qVal;
    for (let i = 0; i < frames; i++) {
      const xl = l[i]!;
      const xr = r[i]!;
      const a = Math.max(Math.abs(xl), Math.abs(xr));
      const req = a > this.ceiling ? this.ceiling / a : 1;
      const t = this.t++;
      // Drop values from the back that can never be the minimum again, then append.
      while (this.qLen > 0 && qVal[(this.qHead + this.qLen - 1) % cap]! >= req) this.qLen--;
      const tail = (this.qHead + this.qLen) % cap;
      qIdx[tail] = t;
      qVal[tail] = req;
      this.qLen++;
      // Expire the front once it falls out of the N+1 window.
      if (qIdx[this.qHead]! <= t - (n + 1)) {
        this.qHead = (this.qHead + 1) % cap;
        this.qLen--;
      }
      const m = qVal[this.qHead]!;
      if (m < this.g) this.g = m;
      else this.g += (m - this.g) * this.releaseK;
      // Box average of the smoothed gain over the last N samples.
      this.smSum += this.g - this.sm[this.smW]!;
      this.sm[this.smW] = this.g;
      this.smW = this.smW + 1 === n ? 0 : this.smW + 1;
      // Guard against float drift in the running sum: never let it exceed the instantaneous need.
      const gain = Math.min(this.smSum / n, 1);
      const yl = this.dl[this.w]!;
      const yr = this.dr[this.w]!;
      this.dl[this.w] = xl;
      this.dr[this.w] = xr;
      this.w = this.w + 1 === n ? 0 : this.w + 1;
      let ol = yl * gain;
      let or = yr * gain;
      // Safety net only (should never engage): hard ceiling, with a tolerance for float32 rounding.
      const lim = this.ceiling * 1.000001;
      if (ol > lim || ol < -lim || or > lim || or < -lim) {
        this.clamped++;
        ol = Math.max(-this.ceiling, Math.min(this.ceiling, ol));
        or = Math.max(-this.ceiling, Math.min(this.ceiling, or));
      }
      l[i] = ol;
      r[i] = or;
      this.gain = gain;
    }
    if (this.g > 0.999999) this.g = 1;
  }
}
