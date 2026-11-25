// Offline render helpers: drive the engine core directly in Node (no browser needed).
// Adapted from groovebox's tests/unit/render.ts (same author).
import { Engine } from '../../src/engine/core';
import {
  CELLS,
  KEYS,
  NO_FX,
  NO_LOCK,
  STEPS,
  type EngineCommand,
  type EngineEvent,
  type PackedPattern,
  type SoundKind,
  type SoundParams,
} from '../../src/engine/protocol';

export type Render = { left: Float32Array; right: Float32Array; events: EngineEvent[]; engine: Engine; sr: number; latency: number };
export type Timed = { time: number; cmd: EngineCommand };

/**
 * Renders `seconds` of audio. `at` injects commands at given times (seconds), applied at the start of
 * the block containing that time (like the worklet port would).
 */
export function render(cmds: EngineCommand[], seconds: number, opts: { sr?: number; block?: number; at?: Timed[] } = {}): Render {
  const sr = opts.sr ?? 48000;
  const block = opts.block ?? 128;
  const engine = new Engine(sr);
  const events: EngineEvent[] = [];
  engine.emit = (e) => events.push(e.type === 'resampled' ? { ...e } : structuredClone(e));
  for (const c of cmds) engine.command(c);
  const total = Math.round(seconds * sr);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const bl = new Float32Array(block);
  const br = new Float32Array(block);
  const pending = [...(opts.at ?? [])].sort((a, b) => a.time - b.time);
  for (let off = 0; off < total; off += block) {
    while (pending.length && pending[0]!.time * sr < off + block) engine.command(pending.shift()!.cmd);
    engine.process(bl, br, block);
    const n = Math.min(block, total - off);
    left.set(bl.subarray(0, n), off);
    right.set(br.subarray(0, n), off);
  }
  return { left, right, events, engine, sr, latency: engine.latency };
}

/** Exact onset for sparse hits separated by silence: first sample above `thr` after each silent gap. */
export function sparseOnsets(buf: Float32Array, sr: number, thr = 1e-3, gapMs = 20): number[] {
  const gap = Math.round((gapMs / 1000) * sr);
  const out: number[] = [];
  let quiet = gap;
  for (let i = 0; i < buf.length; i++) {
    if (Math.abs(buf[i]!) > thr) {
      if (quiet >= gap) out.push(i);
      quiet = 0;
    } else quiet++;
  }
  return out;
}

// ---- Patterns ----------------------------------------------------------------------------------------------

export function emptyPattern(): PackedPattern {
  return {
    keys: new Uint16Array(CELLS),
    len: new Uint8Array(CELLS),
    lockA: new Int8Array(CELLS).fill(NO_LOCK),
    lockB: new Int8Array(CELLS).fill(NO_LOCK),
    fx: new Int8Array(STEPS).fill(NO_FX),
  };
}

/** Bit mask for a list of keys. */
export const keyMask = (...keys: number[]): number => keys.reduce((m, k) => m | (1 << k), 0);

/** Returns a copy of `p` with one step set (index = sound * STEPS + step). */
export function withStep(
  p: PackedPattern,
  sound: number,
  step: number,
  keysMask: number,
  opts: { len?: number; lockA?: number; lockB?: number } = {},
): PackedPattern {
  const q: PackedPattern = { keys: p.keys.slice(), len: p.len.slice(), lockA: p.lockA.slice(), lockB: p.lockB.slice(), fx: p.fx.slice() };
  const i = sound * STEPS + step;
  q.keys[i] = keysMask;
  q.len[i] = opts.len ?? 0;
  q.lockA[i] = opts.lockA ?? NO_LOCK;
  q.lockB[i] = opts.lockB ?? NO_LOCK;
  return q;
}

/** Returns a copy of `p` with the FX lane set to `fx` for steps [from, to). */
export function withFx(p: PackedPattern, from: number, to: number, fx: number): PackedPattern {
  const q: PackedPattern = { keys: p.keys, len: p.len, lockA: p.lockA, lockB: p.lockB, fx: p.fx.slice() };
  for (let s = from; s < to; s++) q.fx[s] = fx;
  return q;
}

export const patternCmd = (index: number, data: PackedPattern): EngineCommand => ({ type: 'pattern', index, data });
export const PLAY: EngineCommand = { type: 'transport', playing: true };
export const STOP: EngineCommand = { type: 'transport', playing: false };

// ---- Sounds ------------------------------------------------------------------------------------------------

/** Builder for a 'sound' command (full-range, uniform slices for drums, volume 0.8, no pitch/tone). */
export function soundCmd(index: number, kind: SoundKind, sampleId: string | null, overrides: Partial<SoundParams> = {}): EngineCommand {
  const params: SoundParams = {
    index,
    kind,
    sampleId,
    start: 0,
    end: 1,
    slices: kind === 'drum' ? Array.from({ length: KEYS + 1 }, (_, k) => k / KEYS) : [],
    pitch: 0,
    tone: 0,
    volume: 0.8,
    ...overrides,
  };
  return { type: 'sound', params };
}

export const sampleCmd = (id: string, l: Float32Array, rate: number): EngineCommand => ({ type: 'sample', id, l, rate });

/** Sample + sound commands for one slot (sample first, as the engine looks it up in the 'sound' command). */
export function slot(index: number, kind: SoundKind, id: string, l: Float32Array, rate: number, overrides: Partial<SoundParams> = {}): EngineCommand[] {
  return [sampleCmd(id, l, rate), soundCmd(index, kind, id, overrides)];
}

// ---- Synthetic samples -------------------------------------------------------------------------------------

/** Sine of `freq` Hz, amplitude 1, optional exponential decay time constant `decay` seconds. */
export function sineSample(freq: number, seconds: number, rate: number, decay = 0): Float32Array {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / rate) * (decay > 0 ? Math.exp(-i / rate / decay) : 1);
  return out;
}

/** Deterministic white noise in [-1, 1). */
export function noiseSample(seconds: number, rate: number, seed = 1): Float32Array {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  let s = seed | 0 || 1;
  for (let i = 0; i < n; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    out[i] = (s >>> 0) / 2147483648 - 1;
  }
  return out;
}

export type ClickTrainOpts = {
  /** Slice length in seconds (16 slices). Default 0.1. */
  sliceSec?: number;
  /** Burst length in seconds. Default 0.02. */
  burstSec?: number;
  /** Burst frequency of slice k (Hz). Default 500 + 200 k. */
  freq?: (k: number) => number;
  /** Burst amplitude of slice k. Default 1. */
  amp?: (k: number) => number;
  /** Burst start of slice k, in samples after the slice start. Default 0. */
  offset?: (k: number) => number;
};

/** 16 equal slices, each holding one decaying cosine burst (starts at full amplitude: sharp, detectable onset). */
export function clickTrain(rate: number, o: ClickTrainOpts = {}): Float32Array {
  const sliceLen = Math.round((o.sliceSec ?? 0.1) * rate);
  const burst = Math.round((o.burstSec ?? 0.02) * rate);
  const out = new Float32Array(sliceLen * 16);
  for (let k = 0; k < 16; k++) {
    const f = o.freq ? o.freq(k) : 500 + 200 * k;
    const a = o.amp ? o.amp(k) : 1;
    const off = o.offset ? o.offset(k) : 0;
    for (let i = 0; i < burst; i++) out[k * sliceLen + off + i] = a * Math.exp(-i / (0.004 * rate)) * Math.cos((2 * Math.PI * f * i) / rate);
  }
  return out;
}
