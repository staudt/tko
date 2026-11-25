// Pure audio analysis helpers for render tests (no DOM, no deps). Mono Float32Array in, numbers out.
// Adapted from groovebox's tests/audio/analysis.ts (same author).

export function peak(buf: Float32Array): number {
  let m = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]!);
    if (a > m) m = a;
  }
  return m;
}

/** RMS over [start, end) in samples (defaults: whole buffer). */
export function rms(buf: Float32Array, start = 0, end = buf.length): number {
  const s = Math.max(0, start | 0);
  const e = Math.min(buf.length, end | 0);
  if (e <= s) return 0;
  let acc = 0;
  for (let i = s; i < e; i++) acc += buf[i]! * buf[i]!;
  return Math.sqrt(acc / (e - s));
}

/** RMS of the first difference (a crude high-pass: measures high-frequency energy). */
export function diffRms(buf: Float32Array, start: number, end: number): number {
  const s = Math.max(1, start | 0);
  const e = Math.min(buf.length, end | 0);
  if (e <= s) return 0;
  let acc = 0;
  for (let i = s; i < e; i++) {
    const d = buf[i]! - buf[i - 1]!;
    acc += d * d;
  }
  return Math.sqrt(acc / (e - s));
}

/** RMS of a boxcar-smoothed signal (a crude low-pass: measures low-frequency energy). */
export function lowRms(buf: Float32Array, start: number, end: number, box = 32): number {
  let acc = 0;
  let n = 0;
  for (let i = Math.max(box, start | 0); i < Math.min(buf.length, end | 0); i++) {
    let m = 0;
    for (let j = 0; j < box; j++) m += buf[i - j]!;
    m /= box;
    acc += m * m;
    n++;
  }
  return n ? Math.sqrt(acc / n) : 0;
}

/** True if the RMS over [start, end) is below thresholdDb (dBFS). */
export function isSilent(buf: Float32Array, start: number, end: number, thresholdDb = -60): boolean {
  return 20 * Math.log10(Math.max(rms(buf, start, end), 1e-12)) < thresholdDb;
}

/** 1200 * log2(a / b): how many cents a is above b. */
export function cents(a: number, b: number): number {
  return 1200 * Math.log2(a / b);
}

/** Largest sample-to-sample jump |x[n] - x[n-1]| over [start, end). */
export function maxJump(buf: Float32Array, start = 1, end = buf.length): number {
  let m = 0;
  for (let i = Math.max(1, start | 0); i < Math.min(buf.length, end | 0); i++) m = Math.max(m, Math.abs(buf[i]! - buf[i - 1]!));
  return m;
}

export function allFinite(buf: Float32Array): boolean {
  for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i]!)) return false;
  return true;
}

/** Hann-windowed amplitude of the component at `freq` Hz over [start, end) (a sine of amplitude A gives ~A). */
export function tonePower(buf: Float32Array, sr: number, freq: number, start: number, end: number): number {
  const s = Math.max(0, start | 0);
  const e = Math.min(buf.length, end | 0);
  const n = e - s;
  if (n < 2) return 0;
  let re = 0;
  let im = 0;
  let sw = 0;
  const w0 = (2 * Math.PI * freq) / sr;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const x = buf[s + i]! * w;
    re += x * Math.cos(w0 * i);
    im -= x * Math.sin(w0 * i);
    sw += w;
  }
  return (2 * Math.hypot(re, im)) / sw;
}

/** Index in `freqs` with the most energy in [start, end). */
export function dominantIndex(buf: Float32Array, sr: number, freqs: number[], start: number, end: number): number {
  let best = 0;
  let bp = -1;
  freqs.forEach((f, i) => {
    const p = tonePower(buf, sr, f, start, end);
    if (p > bp) {
      bp = p;
      best = i;
    }
  });
  return best;
}

export interface ClickOptions {
  /** A click needs |second difference| > sensitivity * the largest |second difference| nearby. Default 4. */
  sensitivity?: number;
  /** Absolute minimum jump size (amplitude of the step). Default 0.02. */
  minJump?: number;
  /** Surrounding window used for the local norm, in samples. Default 16. */
  neighborhood?: number;
}

/**
 * Discontinuity detector. Returns sample indices m where the signal steps between x[m-1] and x[m].
 * A step of size s at m gives second difference j[m] ~ +s and j[m+1] ~ -s (an isolated spike pair), whereas
 * smooth ramps give one-sided changes. See groovebox for the full rationale.
 */
export function detectClicks(buf: Float32Array, opts: ClickOptions = {}): number[] {
  const sens = opts.sensitivity ?? 4;
  const minJump = opts.minJump ?? 0.02;
  const N = opts.neighborhood ?? 16;
  const n = buf.length;
  const j = new Float32Array(n);
  for (let i = 2; i < n; i++) j[i] = buf[i]! - 2 * buf[i - 1]! + buf[i - 2]!;
  const out: number[] = [];
  for (let m = 2; m < n - 1; m++) {
    const a = Math.abs(j[m]!);
    if (a < minJump) continue;
    const b = j[m + 1]!;
    if (Math.sign(b) === Math.sign(j[m]!) || Math.abs(b) < 0.5 * a) continue;
    let scale = 0;
    for (let k = Math.max(2, m - N); k <= Math.min(n - 1, m + N); k++) {
      if (k >= m - 2 && k <= m + 3) continue;
      const v = Math.abs(j[k]!);
      if (v > scale) scale = v;
    }
    if (a > sens * scale) out.push(m);
  }
  return out;
}

/**
 * Fundamental frequency (Hz) of buf[start, end) using YIN (threshold 0.1) with parabolic interpolation, refined
 * over several periods (difference re-evaluated at doubled lags). Range 40 Hz .. 2 kHz. Returns 0 if not periodic.
 */
export function estimatePitchHz(buf: Float32Array, sr: number, start: number, end: number): number {
  const fMin = 40;
  const fMax = 2000;
  const tauMin = Math.max(2, Math.floor(sr / fMax));
  const tauMax = Math.ceil(sr / fMin) + 2;
  const s = Math.max(0, start | 0);
  const e = Math.min(buf.length, end | 0);
  const len = e - s;
  const W = len - 2 * tauMax;
  if (W < tauMax) return 0;

  const diff = (tau: number, w: number): number => {
    let acc = 0;
    for (let i = 0; i < w; i++) {
      const v = buf[s + i]! - buf[s + i + tau]!;
      acc += v * v;
    }
    return acc;
  };

  const dt = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) dt[tau] = diff(tau, W);
  const cm = new Float64Array(tauMax + 1);
  cm[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    run += dt[tau]!;
    cm[tau] = run > 0 ? (dt[tau]! * tau) / run : 1;
  }
  let tau0 = -1;
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (cm[tau]! < 0.1) {
      while (tau + 1 < tauMax && cm[tau + 1]! < cm[tau]!) tau++;
      tau0 = tau;
      break;
    }
  }
  if (tau0 < 0) return 0;

  const parabolic = (f: (t: number) => number, t: number): number => {
    const a = f(t - 1);
    const b = f(t);
    const c = f(t + 1);
    const den = a - 2 * b + c;
    return den === 0 ? t : t + (0.5 * (a - c)) / den;
  };
  let period = parabolic((t) => cm[t]!, tau0);

  for (let k = 2; k <= 128 && k * period * 2 < len; k *= 2) {
    const w = len - Math.ceil(k * period) - 3;
    if (w < period) break;
    const cache = new Map<number, number>();
    const f = (t: number): number => {
      let v = cache.get(t);
      if (v === undefined) {
        v = diff(t, w);
        cache.set(t, v);
      }
      return v;
    };
    const center = Math.round(k * period);
    let best = center;
    for (let t = center - 1; t <= center + 1; t++) if (f(t) < f(best)) best = t;
    period = parabolic(f, best) / k;
  }
  return sr / period;
}
