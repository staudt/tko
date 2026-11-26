// Drum slicing (pure). CONTRACT (stub): implemented by the storage/DSP task.

/** 17 equal boundaries in 0..1. */
export function equalSlices(count = 16): number[] {
  return Array.from({ length: count + 1 }, (_, k) => k / count);
}

/**
 * Boundaries in 0..1 (first 0, last 1, ascending) placed at detected onsets (energy rise).
 * With more than `count` onsets the strongest win. With fewer: `fill` (default) splits the longest
 * regions until there are `count` slices (count + 1 boundaries); `fill: false` keeps only the hits
 * found (at least 1 slice), ignoring an onset right at the start (already boundary 0).
 */
export function autoSlices(l: Float32Array, rate: number, count = 16, fill = true): number[] {
  const n = l.length;
  const chosen: number[] = [];
  if (n > 0 && count > 1) {
    const hop = Math.max(1, Math.round(rate * 0.01));
    const frames = Math.floor(n / hop);
    const e = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (let i = f * hop, end = i + hop; i < end; i++) sum += l[i]! * l[i]!;
      e[f] = Math.sqrt(sum / hop);
    }
    const nov = new Float32Array(frames);
    let maxNov = 0;
    for (let f = 1; f < frames; f++) {
      nov[f] = Math.max(0, e[f]! - e[f - 1]!);
      maxNov = Math.max(maxNov, nov[f]!);
    }
    const thr = Math.max(0.1 * maxNov, 1e-3);
    // candidate local maxima, strongest first, with a minimum gap of 40 ms
    const cand: number[] = [];
    for (let f = 1; f < frames; f++) {
      const v = nov[f]!;
      if (v >= thr && v >= nov[f - 1]! && v > (nov[f + 1] ?? 0)) cand.push(f);
    }
    cand.sort((a, b) => nov[b]! - nov[a]!);
    const minGap = 4;
    const picked: number[] = [];
    for (const f of cand) if (picked.every((p) => Math.abs(p - f) >= minGap)) picked.push(f);
    const back = Math.round(rate * 0.002);
    const ms = Math.max(1, Math.round(rate * 0.001));
    const bounds: { pos: number; str: number }[] = [];
    for (const f of picked) {
      const lo = Math.max(0, (f - 2) * hop);
      const hi = Math.min(n, (f + 2) * hop);
      let pk = 0;
      let pi = lo;
      for (let i = lo; i < hi; i++) {
        const v = Math.abs(l[i]!);
        if (v > pk) {
          pk = v;
          pi = i;
        }
      }
      const t = 0.1 * pk;
      let last = pi;
      for (let j = pi; j >= lo && last - j <= ms; j--) if (Math.abs(l[j]!) >= t) last = j;
      const pos = Math.max(0, last - back);
      if (pos / n > 0 && pos / n < 1) bounds.push({ pos: pos / n, str: nov[f]! });
    }
    bounds.sort((a, b) => b.str - a.str);
    const startZone = fill ? 0 : (0.03 * rate) / n; // a hit in the first 30 ms is the start itself
    for (const b of bounds.filter((x) => x.pos > startZone).slice(0, count - 1)) chosen.push(b.pos);
  }
  const all = [0, ...chosen.sort((a, b) => a - b), 1];
  // enforce strict ascent (drop duplicates)
  const out: number[] = [0];
  for (const v of all.slice(1)) if (v > out[out.length - 1]!) out.push(v);
  if (out[out.length - 1] !== 1) out.push(1);
  while (fill && out.length < count + 1) {
    let bi = 0;
    for (let i = 1; i < out.length - 1; i++) if (out[i + 1]! - out[i]! > out[bi + 1]! - out[bi]!) bi = i;
    out.splice(bi + 1, 0, (out[bi]! + out[bi + 1]!) / 2);
  }
  return out;
}
