// Offline render tests for the appended punch-in FX (stutter 1/8T, scratch, octave, wobble).
import { describe, expect, it } from 'vitest';
import { FX_DEFAULT_XY, FX_DEFS, FX_IDS } from '../../src/engine/fx/ids';
import type { EngineCommand } from '../../src/engine/protocol';
import { allFinite, cents, detectClicks, estimatePitchHz, peak, rms } from '../audio/analysis';
import { PLAY, clickTrain, emptyPattern, patternCmd, render, sineSample, slot, sparseOnsets, withFx, type Timed } from './render';

const sr = 48000;
const MEL = 0;
const DRUM = 8;
const tempo = (bpm: number): EngineCommand => ({ type: 'tempo', bpm, swing: 50 });
const idx = (id: (typeof FX_IDS)[number]): number => FX_IDS.indexOf(id);

function sawSample(freq: number, seconds: number, amp = 0.5): Float32Array {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * (2 * ((i * freq) / sr % 1) - 1);
  return out;
}

const fixture = (s: Float32Array): EngineCommand[] => [tempo(120), ...slot(MEL, 'melodic', 's', s, sr), patternCmd(0, emptyPattern())];
const noteOn: Timed = { time: 0, cmd: { type: 'play', sound: MEL, key: 0, on: true } };

/** Dry and wet renders of a held note; the FX is held from 1.0 s to 3.0 s, optional knob set at the press. */
function run(fx: number, s: Float32Array, knob?: [number, number], seconds = 4.5) {
  const cmds = fixture(s);
  const dry = render(cmds, seconds, { at: [noteOn] });
  const at: Timed[] = [noteOn, { time: 1.0, cmd: { type: 'fx', fx, on: true } }];
  if (knob) at.push({ time: 1.0, cmd: { type: 'fxKnob', fx, x: knob[0], y: knob[1] } });
  at.push({ time: 3.0, cmd: { type: 'fx', fx, on: false } });
  return { dry, wet: render(cmds, seconds, { at }) };
}

const diffRmsOver = (a: Float32Array, b: Float32Array, from: number, to: number): number => {
  let acc = 0;
  for (let i = from; i < to; i++) acc += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(acc / (to - from));
};
const maxDiff = (a: Float32Array, b: Float32Array, from: number, to: number): number => {
  let d = 0;
  for (let i = from; i < to; i++) d = Math.max(d, Math.abs(a[i]! - b[i]!));
  return d;
};

describe('new FX registry', () => {
  it('appends after the original 12 and has defs and defaults', () => {
    expect(FX_IDS.slice(0, 12).join()).toBe('stutter4,stutter8,stutter16,stutter32,tapeStop,lowSweep,highSweep,lofi,gate,reverse,reverbThrow,delayThrow');
    expect(FX_IDS.slice(12).join()).toBe('stutter8T,scratch,octave,wobble');
    expect(FX_DEFS.map((d) => d.id)).toEqual([...FX_IDS]);
    for (const id of FX_IDS) expect(FX_DEFAULT_XY[id]).toBeDefined();
  });
});

describe.each(['stutter8T', 'scratch', 'octave', 'wobble'] as const)('%s', (id) => {
  const fx = idx(id);
  const s = sawSample(110, 6);
  const { dry, wet } = run(fx, s);

  it('is finite, limited and clearly audible while held', () => {
    expect(allFinite(wet.left)).toBe(true);
    expect(allFinite(wet.right)).toBe(true);
    expect(peak(wet.left)).toBeLessThanOrEqual(1);
    expect(diffRmsOver(dry.left, wet.left, Math.round(1.3 * sr), Math.round(2.9 * sr))).toBeGreaterThan(0.02);
  });

  it('returns to the dry signal after release', () => {
    expect(maxDiff(dry.left, wet.left, 0, Math.round(1.0 * sr))).toBe(0);
    expect(maxDiff(dry.left, wet.left, Math.round(3.08 * sr), Math.round(4.4 * sr))).toBeLessThan(1e-4);
  });
});

describe('click-free on a pure sine', () => {
  for (const id of ['stutter8T', 'scratch', 'octave', 'wobble'] as const) {
    it(id, () => {
      const { wet } = run(idx(id), sineSample(220, 6, sr));
      expect(detectClicks(wet.left, { minJump: 0.02 }).filter((i) => i > 0.5 * sr)).toEqual([]);
    });
  }
});

describe('stutter8T', () => {
  it('loops every 4/3 steps (1/8 triplet)', () => {
    const sps = (sr * 60) / 120 / 4;
    const want = (4 / 3) * sps; // 8000 samples
    const cmds = [tempo(120), ...slot(DRUM, 'drum', 'd', clickTrain(sr), sr), patternCmd(0, emptyPattern())];
    const at: Timed[] = [
      { time: 0.2, cmd: { type: 'fx', fx: idx('stutter8T'), on: true } },
      { time: 0.2, cmd: { type: 'play', sound: DRUM, key: 0, on: true } },
      { time: 1.5, cmd: { type: 'fx', fx: idx('stutter8T'), on: false } },
    ];
    const r = render(cmds, 2, { at });
    const on = sparseOnsets(r.left, sr, 1e-3, 10).filter((o) => o < 1.5 * sr);
    expect(on.length).toBeGreaterThan(5);
    for (let i = 1; i < on.length; i++) expect(Math.abs(on[i]! - on[i - 1]! - want)).toBeLessThanOrEqual(sr / 1000);
  });
});

describe('octave', () => {
  // 200 Hz: the two grains are half a grain (1200 samples) apart, a whole number of cycles of 200 Hz, so they add in phase
  // (at other pitches a pure sine shows some comb-like level wobble at the grain rate).
  const f0 = 200;
  const s = sineSample(f0, 6, sr);
  it('up doubles the pitch', () => {
    const { wet } = run(idx('octave'), s, [1, 1]);
    const f = estimatePitchHz(wet.left, sr, Math.round(1.6 * sr), Math.round(2.6 * sr));
    expect(Math.abs(cents(f, f0 * 2))).toBeLessThan(20);
  });
  it('down halves the pitch', () => {
    const { wet } = run(idx('octave'), s, [0, 1]);
    const f = estimatePitchHz(wet.left, sr, Math.round(1.6 * sr), Math.round(2.6 * sr));
    expect(Math.abs(cents(f, f0 / 2))).toBeLessThan(20);
  });
});

describe('wobble', () => {
  it('modulates brightness at the LFO rate (x=0.3 -> 1/8 = 2 steps)', () => {
    const { wet } = run(idx('wobble'), sawSample(110, 6), [0.3, 0.9]);
    const win = Math.round(0.0025 * sr);
    const from = Math.round(1.5 * sr);
    const count = Math.floor((1.5 * sr) / win);
    const env = new Float64Array(count);
    for (let w = 0; w < count; w++) {
      let e = 0;
      for (let i = 0; i < win; i++) {
        const j = from + w * win + i;
        const d = wet.left[j]! - wet.left[j - 1]!;
        e += d * d;
      }
      env[w] = e;
    }
    let mean = 0;
    for (const v of env) mean += v;
    mean /= count;
    const periodWins = (2 * ((sr * 60) / 120 / 4)) / win; // 100
    let best = 0;
    let bestLag = 0;
    for (let lag = Math.round(periodWins * 0.5); lag <= Math.round(periodWins * 1.5); lag++) {
      let acc = 0;
      for (let i = 0; i + lag < count; i++) acc += (env[i]! - mean) * (env[i + lag]! - mean);
      if (acc > best) {
        best = acc;
        bestLag = lag;
      }
    }
    expect(Math.abs(bestLag - periodWins) / periodWins).toBeLessThan(0.05);
  });
});

describe('scratch', () => {
  it('reads both forward and backward', () => {
    const posFrac = (b: Float32Array, a: number, z: number): number => {
      let up = 0;
      let tot = 0;
      for (let i = a; i < z; i++) {
        const d = b[i]! - b[i - 1]!;
        if (Math.abs(d) > 1e-5) {
          tot++;
          if (d > 0) up++;
        }
      }
      return up / tot;
    };
    const { dry, wet } = run(idx('scratch'), sawSample(110, 6), [0.3, 1]);
    const a = Math.round(1.5 * sr);
    const z = Math.round(2.8 * sr);
    expect(posFrac(dry.left, a, z)).toBeGreaterThan(0.95); // a rising saw
    expect(posFrac(wet.left, a, z)).toBeLessThan(0.85); // backward reads flip the slope
    expect(rms(wet.left, a, z)).toBeGreaterThan(0.05);
  });
});

describe('FX lane with index 15 (wobble)', () => {
  it('presses on its steps and releases afterwards, and is reported in meters', () => {
    const lane = withFx(emptyPattern(), 4, 8, 15);
    const cmds = [tempo(120), ...slot(MEL, 'melodic', 's', sawSample(110, 6), sr), patternCmd(0, emptyPattern()), PLAY];
    const laneCmds = [tempo(120), ...slot(MEL, 'melodic', 's', sawSample(110, 6), sr), patternCmd(0, lane), PLAY];
    const dry = render(cmds, 2, { at: [noteOn] });
    const r = render(laneCmds, 2, { at: [noteOn] });
    const lat = r.latency;
    expect(allFinite(r.left)).toBe(true);
    expect(maxDiff(dry.left, r.left, 0, Math.round(0.5 * sr) + lat - 1)).toBeLessThan(1e-4);
    expect(diffRmsOver(dry.left, r.left, Math.round(0.65 * sr) + lat, Math.round(0.95 * sr) + lat)).toBeGreaterThan(0.02);
    expect(maxDiff(dry.left, r.left, Math.round(1.0 * sr) + lat + Math.round(0.08 * sr), 2 * sr)).toBeLessThan(1e-4);
    expect(r.events.some((e) => e.type === 'meters' && e.fx === 15)).toBe(true);
  });
});
