// Small DSP building blocks. AUDIO THREAD CODE: no allocations after construction,
// no closures per block. Everything here runs inside the worklet render loop.

export const TWO_PI = Math.PI * 2;

/** Per-sample multiplier so an exponential decay falls by 60 dB in `t60` seconds. */
export function decayCoef(t60: number, sr: number): number {
  return Math.exp(-6.907755278982137 / Math.max(1e-4, t60 * sr));
}

/** Map 0..1 to lo..hi exponentially. */
export function expMap(x: number, lo: number, hi: number): number {
  return lo * Math.pow(hi / lo, x);
}

export const semis = (s: number) => Math.pow(2, s / 12);

/** Velocity 0..127 to linear gain with a gentle curve. */
export const velGain = (vel: number) => Math.pow(Math.max(0, Math.min(127, vel)) / 127, 1.5);

/** Fast xorshift32 noise in [-1, 1). */
export class Noise {
  private s: number;
  constructor(seed = 0x12345678) {
    this.s = seed | 0 || 1;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x;
    return (x | 0) / 2147483648;
  }
  /** Uniform in [0, 1). */
  unit(): number {
    return (this.next() + 1) * 0.5;
  }
}

/** Topology-preserving state-variable filter (Zavalishin / Cytomic). */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  low = 0;
  band = 0;
  high = 0;

  set(cutoff: number, q: number, sr: number): void {
    const fc = Math.min(cutoff, sr * 0.45);
    const g = Math.tan((Math.PI * fc) / sr);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  reset(): void {
    this.ic1 = 0;
    this.ic2 = 0;
  }

  /** Processes one sample; read .low / .band / .high afterwards. */
  tick(v0: number): void {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = v0 - this.k * v1 - v2;
  }

  /** Flush denormals; call once per block. */
  flush(): void {
    if (Math.abs(this.ic1) < 1e-15) this.ic1 = 0;
    if (Math.abs(this.ic2) < 1e-15) this.ic2 = 0;
  }
}

/**
 * Rational soft clipper, drive 0..1. drive 0 is the identity; small-signal gain is 1 + drive,
 * loud peaks are squashed toward (1 + drive) / (pre * drive). Smooth and monotonic.
 */
export function softClip(x: number, drive: number): number {
  if (drive <= 0) return x;
  const pre = 1 + drive * 5;
  const d = x * pre;
  return ((d / (1 + Math.abs(d) * drive)) * (1 + drive)) / pre;
}
