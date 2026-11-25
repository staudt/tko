// Waveform overview (pure). CONTRACT (stub): implemented by the storage/DSP task.

/** Min/max per bucket: out[2*i] = min, out[2*i+1] = max over bucket i of `buckets`. */
export function peaks(l: Float32Array, buckets: number, from = 0, to = l.length): Float32Array {
  const out = new Float32Array(buckets * 2);
  const a = Math.max(0, Math.min(l.length, Math.floor(from)));
  const b = Math.max(a, Math.min(l.length, Math.floor(to)));
  const span = b - a;
  for (let k = 0; k < buckets; k++) {
    const s = a + Math.floor((k * span) / buckets);
    const e = Math.max(s + 1, a + Math.floor(((k + 1) * span) / buckets));
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = s; i < e && i < l.length; i++) {
      const v = l[i]!;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mn === Infinity) {
      mn = 0;
      mx = 0;
    }
    out[2 * k] = mn;
    out[2 * k + 1] = mx;
  }
  return out;
}
