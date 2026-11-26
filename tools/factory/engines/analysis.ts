// Build-time helpers (not part of the app bundle): pitch measurement and pitch-correcting resampling.

export type PitchInfo = { hz: number; clarity: number };

/** f0 by normalized autocorrelation over a sustained window, searched within +/- 3 semitones of `expectedHz`. */
export function measureF0(a: Float32Array, sr: number, expectedHz: number, fromSec: number, win = 8192): PitchInfo {
  const start = Math.round(fromSec * sr);
  const loLag = Math.floor(sr / (expectedHz * 2 ** (3 / 12)));
  const hiLag = Math.ceil(sr / (expectedHz / 2 ** (3 / 12)));
  const n = Math.min(win, a.length - start - hiLag - 1);
  if (n < 1024) return { hz: 0, clarity: 0 };
  const r = new Float64Array(hiLag + 2);
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += a[start + i]! ** 2;
  for (let lag = loLag - 1; lag <= hiLag + 1; lag++) {
    let s = 0;
    let e1 = 0;
    for (let i = 0; i < n; i++) {
      s += a[start + i]! * a[start + i + lag]!;
      e1 += a[start + i + lag]! ** 2;
    }
    r[lag] = s / Math.sqrt(Math.max(1e-12, e0 * e1));
  }
  let best = loLag;
  for (let lag = loLag; lag <= hiLag; lag++) if (r[lag]! > r[best]!) best = lag;
  const y0 = r[best - 1]!;
  const y1 = r[best]!;
  const y2 = r[best + 1]!;
  const d = y0 - 2 * y1 + y2;
  const off = d !== 0 ? (0.5 * (y0 - y2)) / d : 0;
  return { hz: sr / (best + off), clarity: y1 };
}

export const centsBetween = (hz: number, ref: number) => 1200 * Math.log2(hz / ref);

/** Reads the signal `ratio` times faster (cubic Hermite): pitch goes up by `ratio`, length shrinks by it. */
export function resample(a: Float32Array, ratio: number): Float32Array {
  const n = Math.floor((a.length - 3) / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const k = Math.floor(p);
    const t = p - k;
    const y0 = a[Math.max(0, k - 1)]!;
    const y1 = a[k]!;
    const y2 = a[k + 1]!;
    const y3 = a[k + 2]!;
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    out[i] = ((c3 * t + c2) * t + c1) * t + y1;
  }
  return out;
}
