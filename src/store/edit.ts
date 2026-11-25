// Pure project edits (return a new project; unchanged input returns the same object).
// Use with apply(): apply((p) => toggleStep(p, pat, snd, step, key)).
import { PATTERNS, SOUNDS, STEPS } from '../engine/protocol';
import { emptyPattern } from './defaults';
import type { Lane, Pattern, Project, StepData } from './types';

const inRange = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n < max;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Replace one pattern. */
export function setPattern(p: Project, pat: number, next: Pattern): Project {
  if (!inRange(pat, PATTERNS) || p.patterns[pat] === next) return p;
  const patterns = p.patterns.slice();
  patterns[pat] = next;
  return { ...p, patterns };
}

export function getStep(p: Project, pat: number, snd: number, step: number): StepData | null {
  return p.patterns[pat]?.lanes[snd]?.[step] ?? null;
}

/** Set (or clear with null / keys 0) one step of one lane. */
export function setStep(p: Project, pat: number, snd: number, step: number, data: StepData | null): Project {
  const pattern = p.patterns[pat];
  if (!pattern || !inRange(snd, SOUNDS) || !inRange(step, STEPS)) return p;
  const lane = pattern.lanes[snd]!;
  const value = data && data.keys ? data : null;
  if (lane[step] === value) return p;
  const nextLane: (StepData | null)[] = lane.slice();
  nextLane[step] = value;
  const lanes: Lane[] = pattern.lanes.slice();
  lanes[snd] = nextLane;
  return setPattern(p, pat, { ...pattern, lanes });
}

/** Write mode tap: an empty step gets `key`; a filled step is cleared. */
export function toggleStep(p: Project, pat: number, snd: number, step: number, key: number): Project {
  const cur = getStep(p, pat, snd, step);
  return setStep(p, pat, snd, step, cur ? null : { keys: 1 << clamp(key, 0, 15) });
}

/** Add/remove one key on a step (chords; drum layers). Removing the last key clears the step. */
export function toggleKey(p: Project, pat: number, snd: number, step: number, key: number): Project {
  const cur = getStep(p, pat, snd, step);
  const keys = (cur?.keys ?? 0) ^ (1 << clamp(key, 0, 15));
  return setStep(p, pat, snd, step, keys ? { ...(cur ?? {}), keys } : null);
}

/** Parameter lock on an existing step (null removes it). A: pitch -24..24, B: tone -100..100. */
export function setLock(p: Project, pat: number, snd: number, step: number, which: 'A' | 'B', value: number | null): Project {
  const cur = getStep(p, pat, snd, step);
  if (!cur) return p;
  const next: StepData = { ...cur };
  const k = which === 'A' ? 'lockA' : 'lockB';
  if (value === null) delete next[k];
  else next[k] = which === 'A' ? clamp(Math.round(value), -24, 24) : clamp(Math.round(value), -100, 100);
  if (next[k] === cur[k]) return p;
  return setStep(p, pat, snd, step, next);
}

/** Note length in steps (0 = natural). */
export function setLen(p: Project, pat: number, snd: number, step: number, len: number): Project {
  const cur = getStep(p, pat, snd, step);
  if (!cur) return p;
  const l = clamp(Math.round(len), 0, 16);
  if ((cur.len ?? 0) === l) return p;
  const next: StepData = { ...cur };
  if (l === 0) delete next.len;
  else next.len = l;
  return setStep(p, pat, snd, step, next);
}

export function setFxStep(p: Project, pat: number, step: number, fx: number | null): Project {
  const pattern = p.patterns[pat];
  if (!pattern || !inRange(step, STEPS) || pattern.fx[step] === fx) return p;
  const f = pattern.fx.slice();
  f[step] = fx;
  return setPattern(p, pat, { ...pattern, fx: f });
}

export function clearPattern(p: Project, pat: number): Project {
  return patternIsEmpty(p.patterns[pat]) ? p : setPattern(p, pat, emptyPattern());
}

export function clearLane(p: Project, pat: number, snd: number): Project {
  const pattern = p.patterns[pat];
  if (!pattern || !inRange(snd, SOUNDS) || pattern.lanes[snd]!.every((s) => !s)) return p;
  const lanes = pattern.lanes.slice();
  lanes[snd] = new Array<null>(STEPS).fill(null);
  return setPattern(p, pat, { ...pattern, lanes });
}

/** Copy pattern `from` over `to` (shares the immutable data). */
export function copyPattern(p: Project, from: number, to: number): Project {
  const src = p.patterns[from];
  return src ? setPattern(p, to, src) : p;
}

export function setChain(p: Project, chain: readonly number[]): Project {
  const c = chain.filter((x) => inRange(x, PATTERNS)).slice(0, 64);
  if (!c.length || (c.length === p.chain.length && c.every((x, i) => x === p.chain[i]))) return p;
  return { ...p, chain: c };
}

export const setBpm = (p: Project, bpm: number): Project => {
  const v = clamp(Math.round(bpm), 30, 300);
  return v === p.bpm ? p : { ...p, bpm: v };
};
export const setSwing = (p: Project, swing: number): Project => {
  const v = clamp(Math.round(swing), 50, 75);
  return v === p.swing ? p : { ...p, swing: v };
};
export const setVolume = (p: Project, volume: number): Project => {
  const v = clamp(Math.round(volume * 100) / 100, 0, 1);
  return v === p.volume ? p : { ...p, volume: v };
};

export function patternIsEmpty(pattern: Pattern | undefined): boolean {
  return !pattern || (pattern.lanes.every((l) => l.every((s) => !s)) && pattern.fx.every((f) => f === null));
}

/** Per-step activity of a pattern across all sounds (for mini maps): count of sounding lanes. */
export function patternDensity(pattern: Pattern): number[] {
  const out = new Array<number>(STEPS).fill(0);
  for (const lane of pattern.lanes) lane.forEach((s, j) => s && out[j]!++);
  return out;
}

/** Tap tempo: BPM from recent tap times (ms), using the last up to 6 taps; null if not enough / too slow. */
export function tapTempo(times: readonly number[]): number | null {
  const t = times.slice(-6);
  if (t.length < 2) return null;
  const gaps = t.slice(1).map((x, i) => x - t[i]!).filter((g) => g > 150 && g < 2000);
  if (!gaps.length) return null;
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return clamp(Math.round(60000 / avg), 30, 300);
}
