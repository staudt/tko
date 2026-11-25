// Pure helpers for recorded audio. Main thread only.

export type Trimmed = { l: Float32Array; r?: Float32Array };

/**
 * Cuts leading and trailing silence (|sample| below `thresholdDb` dBFS on every channel).
 * Keeps `padLeadMs` of audio before the first sound and `padTailMs` after the last.
 * Returns null when nothing rises above the threshold.
 */
export function trimSilence(l: Float32Array, r: Float32Array | undefined, rate: number, thresholdDb = -45, padLeadMs = 10, padTailMs = 10): Trimmed | null {
  const thr = 10 ** (thresholdDb / 20);
  const n = l.length;
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(l[i]!), r ? Math.abs(r[i] ?? 0) : 0);
    if (a >= thr) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  const a = Math.max(0, first - Math.round((padLeadMs / 1000) * rate));
  const b = Math.min(n, last + 1 + Math.round((padTailMs / 1000) * rate));
  return r ? { l: l.slice(a, b), r: r.slice(a, b) } : { l: l.slice(a, b) };
}

/** Joins recorded chunks into one buffer. */
export function joinChunks(chunks: readonly Float32Array[]): Float32Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
