// Pure onset detection and slot assembly for the factory sounds (no DOM, unit-testable).
// MP3 decoding adds an encoder delay, so declared positions are only a hint: the real start of
// each sound is found by searching around its declared position.

/** First index in [from, to) where |sample| >= threshold; null if none. */
export function findOnset(data: Float32Array, from: number, to: number, thresholdDb = -50): number | null {
  const lo = Math.max(0, Math.floor(from));
  const hi = Math.min(data.length, Math.ceil(to));
  const thr = 10 ** (thresholdDb / 20);
  for (let i = lo; i < hi; i++) {
    if (Math.abs(data[i]!) >= thr) return i;
  }
  return null;
}

export interface SliceRegion {
  startSample: number;
  length: number;
}

export interface DeclaredSound {
  /** Declared start in seconds (before encoder delay). */
  start: number;
  /** Length in seconds. */
  duration: number;
}

const SEARCH_BEFORE_S = 0.02;
/** Encoder delay is ~25 ms; leave room for it plus slack. */
const SEARCH_AFTER_S = 0.07;
const PREROLL_S = 0.001;
/** Onset = first sample within this many dB of the sound's peak. */
const RELATIVE_THRESHOLD_DB = -24;

function peakAbs(data: Float32Array, from: number, to: number): number {
  let p = 0;
  for (let i = Math.max(0, from); i < Math.min(data.length, to); i++) {
    const v = Math.abs(data[i]!);
    if (v > p) p = v;
  }
  return p;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Locate each sound's true start in the decoded data. The threshold is relative to the sound's own
 * peak (MP3 pre-echo sits 30-45 dB below the transient), never below `thresholdDb`. Sounds whose
 * onset can't be found use the declared start shifted by the median measured shift.
 */
export function sliceRegions(data: Float32Array, sampleRate: number, sounds: DeclaredSound[], thresholdDb = -50): SliceRegion[] {
  const pre = Math.round(PREROLL_S * sampleRate);
  const found: (number | null)[] = [];
  const declared: number[] = [];
  const shifts: number[] = [];
  for (const s of sounds) {
    const d = Math.round(s.start * sampleRate);
    declared.push(d);
    const from = d - Math.round(SEARCH_BEFORE_S * sampleRate);
    const to = d + Math.round(SEARCH_AFTER_S * sampleRate);
    const peak = peakAbs(data, from, d + Math.round(Math.min(s.duration, 0.15) * sampleRate));
    const relDb = peak > 0 ? 20 * Math.log10(peak) + RELATIVE_THRESHOLD_DB : thresholdDb;
    const on = findOnset(data, from, to, Math.max(thresholdDb, relDb));
    found.push(on);
    if (on !== null) shifts.push(on - d);
  }
  const medShift = Math.round(median(shifts));
  return sounds.map((s, i) => {
    const on = found[i];
    const d = declared[i]!;
    const start = Math.min(Math.max(0, on != null ? on - pre : d + medShift), data.length);
    const length = Math.max(0, Math.min(Math.round(s.duration * sampleRate), data.length - start));
    return { startSample: start, length };
  });
}

/** Manifest entry of one factory slot (declared times in seconds). */
export type SlotEntry =
  | { kind: 'melodic'; start: number; duration: number }
  | { kind: 'drum'; hits: { name?: string; start: number; duration: number }[] };

export interface AssembledSlot {
  l: Float32Array;
  /** Drums: hits + 1 normalized boundaries in 0..1; melodic: []. */
  slices: number[];
}

/** Turns a decoded file into one compact buffer (gaps removed) plus slice boundaries. */
export function assembleSlot(data: Float32Array, rate: number, entry: SlotEntry): AssembledSlot {
  if (entry.kind === 'melodic') {
    const [r] = sliceRegions(data, rate, [{ start: entry.start, duration: entry.duration }]);
    const l = r ? data.slice(r.startSample, r.startSample + r.length) : new Float32Array(0);
    return { l, slices: [] };
  }
  const regions = sliceRegions(data, rate, entry.hits);
  const total = regions.reduce((s, r) => s + r.length, 0);
  const l = new Float32Array(total);
  const slices: number[] = [0];
  let pos = 0;
  for (const r of regions) {
    l.set(data.subarray(r.startSample, r.startSample + r.length), pos);
    pos += r.length;
    slices.push(total > 0 ? pos / total : 0);
  }
  if (slices.length > 1) slices[slices.length - 1] = 1;
  return { l, slices };
}
