// Pure sample processing helpers (main thread). Mono Float32Array in, new array out.
// CONTRACT (stub): implemented by the storage/DSP task.

/** Peak-normalize to `peakDb` dBFS (no-op on silence). */
export function normalize(l: Float32Array, peakDb = -1): Float32Array {
  let peak = 0;
  for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.abs(l[i]!));
  const out = new Float32Array(l.length);
  if (peak < 1e-9) {
    out.set(l);
    return out;
  }
  const g = 10 ** (peakDb / 20) / peak;
  for (let i = 0; i < l.length; i++) out[i] = l[i]! * g;
  return out;
}
/** Reversed copy. */
export function reverse(l: Float32Array): Float32Array {
  const n = l.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = l[n - 1 - i]!;
  return out;
}
/** Short linear fades at both ends to avoid clicks. */
export function fadeEdges(l: Float32Array, rate: number, ms = 3): Float32Array {
  const n = l.length;
  const out = l.slice();
  const f = Math.min(Math.floor(n / 2), Math.max(1, Math.round((rate * ms) / 1000)));
  for (let i = 0; i < f; i++) {
    const g = i / f;
    out[i] = out[i]! * g;
    out[n - 1 - i] = out[n - 1 - i]! * g;
  }
  if (n > 0) out[n - 1] = 0;
  return out;
}
/** Cut to at most `maxS` seconds (with an end fade). */
export function limitLength(l: Float32Array, rate: number, maxS: number): Float32Array {
  const max = Math.floor(rate * maxS);
  if (l.length <= max) return l.slice();
  const out = l.slice(0, max);
  const f = Math.min(max, Math.max(1, Math.round(rate * 0.005)));
  for (let i = 0; i < f; i++) out[max - 1 - i] = out[max - 1 - i]! * (i / f);
  return out;
}
/** Crop to the trim region [start, end] (0..1), returning a new compact buffer. */
export function crop(l: Float32Array, start: number, end: number): Float32Array {
  const a = Math.max(0, Math.min(l.length, Math.round(Math.min(start, end) * l.length)));
  const b = Math.max(a, Math.min(l.length, Math.round(Math.max(start, end) * l.length)));
  return l.slice(a, b);
}
