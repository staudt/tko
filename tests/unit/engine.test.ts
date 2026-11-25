// Offline render tests for the engine core (src/engine/core.ts): timing, pitch, slices, chords, locks,
// chains, live play, voice stealing, resample and punch FX. Runs in Node, no browser.
import { describe, expect, it } from 'vitest';
import { FX_IDS } from '../../src/engine/fx/ids';
import type { EngineCommand } from '../../src/engine/protocol';
import { allFinite, cents, detectClicks, diffRms, dominantIndex, estimatePitchHz, lowRms, maxJump, peak, rms, tonePower } from '../audio/analysis';
import {
  PLAY,
  STOP,
  clickTrain,
  emptyPattern,
  keyMask,
  noiseSample,
  patternCmd,
  render,
  sineSample,
  slot,
  soundCmd,
  sparseOnsets,
  withFx,
  withStep,
} from './render';

const DRUM = 8; // sound slots 0..7 melodic, 8..15 drum
const MEL = 0;
const tempo = (bpm: number, swing = 50): EngineCommand => ({ type: 'tempo', bpm, swing });
const ms = (sr: number, t: number): number => Math.round(t * sr);

/** Drum sound 8 with a 16-click sample (sample rate = engine rate) and the given pattern 0. */
function drumFixture(sr: number, p = emptyPattern(), clickOpts = {}, rate = sr): EngineCommand[] {
  return [...slot(DRUM, 'drum', 'drums', clickTrain(rate, clickOpts), rate), patternCmd(0, p)];
}

/** Melodic sound 0 with a sustained sine sample. */
function sineFixture(sr: number, freq: number, p = emptyPattern(), seconds = 3, overrides = {}): EngineCommand[] {
  return [...slot(MEL, 'melodic', 'sine', sineSample(freq, seconds, sr), sr, overrides), patternCmd(0, p)];
}

describe('timing', () => {
  const cases: [number, number][] = [
    [48000, 60],
    [48000, 120],
    [48000, 200],
    [44100, 120],
  ];
  for (const [sr, bpm] of cases) {
    it(`drum hits on steps 0,4,8,12 stay on the grid over 4 patterns (${sr} Hz, ${bpm} BPM)`, () => {
      let p = emptyPattern();
      for (const s of [0, 4, 8, 12]) p = withStep(p, DRUM, s, keyMask(0));
      const sps = (sr * 60) / bpm / 4;
      // Sample at 44.1 kHz even on a 48 kHz engine: also exercises resampled playback.
      const r = render([tempo(bpm), ...drumFixture(sr, p, {}, 44100), PLAY], (64 * sps) / sr, { sr });
      const on = sparseOnsets(r.left, sr);
      expect(on.length).toBe(16);
      const errs = on.map((o, i) => o - (Math.round(((Math.floor(i / 4) * 16 + (i % 4) * 4)) * sps) + r.latency));
      for (const e of errs) expect(Math.abs(e)).toBeLessThanOrEqual(sr / 1000);
      // No drift: the error of the last hit equals the first (within rounding).
      expect(Math.abs(errs[15]! - errs[0]!)).toBeLessThanOrEqual(2);
    });
  }

  it('step events report the grid time (including limiter latency)', () => {
    const r = render([tempo(120), ...drumFixture(48000), PLAY], 2.2);
    const steps = r.events.filter((e) => e.type === 'step');
    expect(steps.length).toBeGreaterThanOrEqual(16);
    steps.slice(0, 16).forEach((e, i) => {
      if (e.type !== 'step') return;
      expect(e.step).toBe(i);
      expect(e.time * 48000).toBeCloseTo(i * 6000 + r.latency, 3);
    });
  });

  it('is independent of the block size (37, 128, 512)', () => {
    let p = emptyPattern();
    for (const s of [0, 3, 6, 10]) p = withStep(p, DRUM, s, keyMask(s % 4));
    const cmds = [tempo(133), ...drumFixture(48000, p), PLAY];
    const a = render(cmds, 1.7, { block: 37 });
    const b = render(cmds, 1.7, { block: 128 });
    const c = render(cmds, 1.7, { block: 512 });
    const oa = sparseOnsets(a.left, 48000);
    expect(oa.length).toBe(4);
    expect(sparseOnsets(b.left, 48000)).toEqual(oa);
    expect(sparseOnsets(c.left, 48000)).toEqual(oa);
    let d = 0;
    for (let i = 0; i < a.left.length; i++) d = Math.max(d, Math.abs(a.left[i]! - b.left[i]!), Math.abs(c.left[i]! - b.left[i]!));
    expect(d).toBeLessThan(1e-4);
  });
});

describe('swing', () => {
  it('66 % delays odd steps by (2 * swing / 100 - 1) steps', () => {
    let p = emptyPattern();
    for (let s = 0; s < 16; s++) p = withStep(p, DRUM, s, keyMask(0));
    const sr = 48000;
    const sps = 6000;
    const r = render([tempo(120, 66), ...drumFixture(sr, p), PLAY], 2.0, { sr });
    const on = sparseOnsets(r.left, sr, 1e-3, 10);
    expect(on.length).toBe(16);
    const d = (2 * 66) / 100 - 1;
    on.forEach((o, s) => {
      const want = Math.round((s + (s % 2 ? d : 0)) * sps) + r.latency;
      expect(Math.abs(o - want)).toBeLessThanOrEqual(2);
    });
    // Odd steps are late by ~0.32 step = 1920 samples relative to straight.
    expect(on[1]! - (6000 + r.latency)).toBeGreaterThan(1900);
  });
});

describe('melodic pitch', () => {
  const sr = 48000;
  const f0 = 220;
  /** Plays key k (with optional lock / sound pitch) on step 0 and measures the pitch of the sustained part. */
  function measure(key: number, opts: { lockA?: number; pitch?: number; sr?: number } = {}): number {
    const rate = opts.sr ?? sr;
    const p = withStep(emptyPattern(), MEL, 0, keyMask(key), opts.lockA === undefined ? {} : { lockA: opts.lockA });
    const r = render([...sineFixture(rate, f0, p, 3, { pitch: opts.pitch ?? 0 }), PLAY], 0.6, { sr: rate });
    return estimatePitchHz(r.left, rate, ms(rate, 0.1), ms(rate, 0.5));
  }

  it('key k plays root x 2^(k/12) within 5 cents', () => {
    for (const k of [0, 1, 4, 7, 12, 15]) {
      const hz = measure(k);
      expect(Math.abs(cents(hz, f0 * 2 ** (k / 12))), `key ${k}: ${hz.toFixed(2)} Hz`).toBeLessThan(5);
    }
  });

  it('is accurate at 44.1 kHz', () => {
    const hz = measure(9, { sr: 44100 });
    expect(Math.abs(cents(hz, f0 * 2 ** (9 / 12)))).toBeLessThan(5);
  });

  it('sound pitch and lock A shift it further', () => {
    expect(Math.abs(cents(measure(0, { pitch: 12 }), f0 * 2))).toBeLessThan(5);
    expect(Math.abs(cents(measure(3, { pitch: -5 }), f0 * 2 ** (-2 / 12)))).toBeLessThan(5);
    expect(Math.abs(cents(measure(4, { lockA: 7 }), f0 * 2 ** (11 / 12)))).toBeLessThan(5);
    expect(Math.abs(cents(measure(2, { lockA: -12, pitch: 5 }), f0 * 2 ** (-5 / 12)))).toBeLessThan(5);
  });

  it('plays a sample recorded at another rate at its natural pitch', () => {
    // 220 Hz sine stored at 44.1 kHz, engine at 48 kHz: still 220 Hz at key 0.
    const p = withStep(emptyPattern(), MEL, 0, keyMask(0));
    const r = render([...slot(MEL, 'melodic', 's', sineSample(f0, 3, 44100), 44100), patternCmd(0, p), PLAY], 0.6);
    expect(Math.abs(cents(estimatePitchHz(r.left, sr, ms(sr, 0.1), ms(sr, 0.5)), f0))).toBeLessThan(5);
  });
});

describe('drum slices', () => {
  const sr = 48000;
  const offset = (k: number) => 100 + 50 * k;
  const freqs = Array.from({ length: 16 }, (_, k) => 500 + 200 * k);

  it('key k plays only the click of slice k (onset, frequency, amplitude, nothing else)', () => {
    for (const k of [0, 1, 5, 9, 15]) {
      const p = withStep(emptyPattern(), DRUM, 0, keyMask(k));
      const amp = (j: number) => 0.3 + 0.04 * j;
      const r = render([...drumFixture(sr, p, { offset, amp }), PLAY], 0.3);
      const on = sparseOnsets(r.left, sr);
      expect(on.length, `key ${k}`).toBe(1);
      // First sample of the burst: slice start + offset, delayed by the limiter.
      expect(Math.abs(on[0]! - (offset(k) + r.latency))).toBeLessThanOrEqual(1);
      expect(dominantIndex(r.left, sr, freqs, on[0]!, on[0]! + 1200)).toBe(k);
      // Burst amplitude: 0.8 master x 0.64 sound x (100/127)^1.5 velocity x amp(k) (minus a little decay).
      const want = 0.8 * 0.64 * (100 / 127) ** 1.5 * amp(k);
      expect(peak(r.left)).toBeGreaterThan(want * 0.9);
      expect(peak(r.left)).toBeLessThan(want * 1.02);
      // Nothing before the burst, nothing after it (the neighbouring slices are not played).
      expect(peak(r.left.subarray(0, on[0]! - 1))).toBeLessThan(1e-4);
      expect(peak(r.left.subarray(on[0]! + ms(sr, 0.04)))).toBeLessThan(1e-4);
    }
  });

  it('honours custom slice boundaries', () => {
    // Slice 2 starts at the click of the (uniform) slice 5.
    const slices = Array.from({ length: 17 }, (_, k) => k / 16);
    slices[2] = 5 / 16;
    slices[3] = 6 / 16;
    const p = withStep(emptyPattern(), DRUM, 0, keyMask(2));
    const cmds = [...slot(DRUM, 'drum', 'd', clickTrain(sr, {}), sr, { slices }), patternCmd(0, p), PLAY];
    const r = render(cmds, 0.3);
    const on = sparseOnsets(r.left, sr);
    expect(on.length).toBe(1);
    expect(dominantIndex(r.left, sr, freqs, on[0]!, on[0]! + 1200)).toBe(5);
  });
});

describe('chords', () => {
  it('a three-key step plays three frequencies', () => {
    const sr = 48000;
    const keys = [0, 4, 7];
    const p = withStep(emptyPattern(), MEL, 0, keyMask(...keys));
    const r = render([...sineFixture(sr, 440, p, 3, { volume: 0.5 }), PLAY], 0.6);
    const f = (k: number) => 440 * 2 ** (k / 12);
    const a = ms(sr, 0.1);
    const b = ms(sr, 0.5);
    const present = keys.map((k) => tonePower(r.left, sr, f(k), a, b));
    const absent = [2, 9, 11].map((k) => tonePower(r.left, sr, f(k), a, b));
    for (const v of present) expect(v).toBeGreaterThan(0.1);
    for (const v of absent) expect(v).toBeLessThan(Math.min(...present) * 0.1);
  });
});

describe('note length', () => {
  const sr = 48000;
  const run = (len: number) => {
    const p = withStep(emptyPattern(), MEL, 0, keyMask(0), { len });
    return render([...sineFixture(sr, 220, p, 3), PLAY], 1.0);
  };

  it('len=2 releases the note after 2 steps (0.25 s at 120 BPM)', () => {
    const r = run(2);
    const before = rms(r.left, ms(sr, 0.1), ms(sr, 0.2));
    expect(before).toBeGreaterThan(0.1);
    expect(rms(r.left, ms(sr, 0.4), ms(sr, 0.9))).toBeLessThan(before * 0.01);
    // It is still sounding right up to the release.
    expect(rms(r.left, ms(sr, 0.2), ms(sr, 0.24))).toBeGreaterThan(before * 0.9);
  });

  it('len=0 plays to the end of the sample', () => {
    const r = run(0);
    expect(rms(r.left, ms(sr, 0.4), ms(sr, 0.9))).toBeGreaterThan(0.1);
  });
});

describe('tone lock', () => {
  const sr = 48000;
  const noise = (lockB: number) => {
    const p = withStep(withStep(emptyPattern(), MEL, 0, keyMask(0)), MEL, 8, keyMask(0), { lockB });
    return render([...slot(MEL, 'melodic', 'n', noiseSample(0.4, sr), sr), patternCmd(0, p), PLAY], 1.5);
  };

  it('lockB = -90 (low-pass) removes high-frequency energy versus an unlocked hit', () => {
    const r = noise(-90);
    const open = diffRms(r.left, ms(sr, 0.1), ms(sr, 0.3));
    const locked = diffRms(r.left, ms(sr, 1.1), ms(sr, 1.3));
    expect(open).toBeGreaterThan(0.01);
    expect(locked).toBeLessThan(open * 0.2);
  });

  it('lockB = +90 (high-pass) removes low-frequency energy', () => {
    const r = noise(90);
    const open = lowRms(r.left, ms(sr, 0.1), ms(sr, 0.3));
    const locked = lowRms(r.left, ms(sr, 1.1), ms(sr, 1.3));
    expect(locked).toBeLessThan(open * 0.3);
  });
});

describe('chains', () => {
  const stepZero = (events: ReturnType<typeof render>['events']) =>
    events.flatMap((e) => (e.type === 'step' && e.step === 0 ? [{ pattern: e.pattern, chainPos: e.chainPos }] : []));
  const base = (): EngineCommand[] => {
    // Distinct patterns (content is irrelevant for the events, but make them differ anyway).
    const cmds: EngineCommand[] = [tempo(240), ...slot(DRUM, 'drum', 'd', clickTrain(48000), 48000)];
    for (const i of [0, 2, 5]) cmds.push(patternCmd(i, withStep(emptyPattern(), DRUM, i, keyMask(i))));
    return cmds;
  };

  it('chain [2,0] plays pattern 2, 0, 2, 0 ...', () => {
    const r = render([...base(), { type: 'chain', patterns: [2, 0] }, PLAY], 3.5);
    expect(stepZero(r.events)).toEqual([
      { pattern: 2, chainPos: 0 },
      { pattern: 0, chainPos: 1 },
      { pattern: 2, chainPos: 0 },
      { pattern: 0, chainPos: 1 },
    ]);
  });

  it('a chain sent mid-pattern takes effect at the next pattern start', () => {
    const at: { time: number; cmd: EngineCommand }[] = [{ time: 0.3, cmd: { type: 'chain', patterns: [5] } }];
    const r = render([...base(), { type: 'chain', patterns: [2, 0] }, PLAY], 2.7, { at });
    expect(stepZero(r.events)).toEqual([
      { pattern: 2, chainPos: 0 },
      { pattern: 5, chainPos: 0 },
      { pattern: 5, chainPos: 0 },
    ]);
    // The rest of the first pattern stays on pattern 2.
    const first = r.events.filter((e) => e.type === 'step').slice(0, 16);
    for (const e of first) expect(e.type === 'step' && e.pattern).toBe(2);
  });

  it('now: true applies at once', () => {
    const at: { time: number; cmd: EngineCommand }[] = [{ time: 0.3, cmd: { type: 'chain', patterns: [5], now: true } }];
    const r = render([...base(), { type: 'chain', patterns: [2, 0] }, PLAY], 1.2, { at });
    const steps = r.events.flatMap((e) => (e.type === 'step' ? [e] : []));
    // Step 4 is at 0.25 s: pattern 2. Steps from ~7 on (after the 0.5-step lookahead) are pattern 5, chainPos 0.
    expect(steps[2]!.pattern).toBe(2);
    for (const e of steps.slice(7, 16)) {
      expect(e.pattern).toBe(5);
      expect(e.chainPos).toBe(0);
    }
  });
});

describe('live play', () => {
  const sr = 48000;

  it('melodic note sustains until released, then fades without a click', () => {
    const at = [
      { time: 0.1, cmd: { type: 'play', sound: MEL, key: 0, on: true } as EngineCommand },
      { time: 0.5, cmd: { type: 'play', sound: MEL, key: 0, on: false } as EngineCommand },
    ];
    const r = render(sineFixture(sr, 220), 0.9, { at });
    const a = rms(r.left, ms(sr, 0.2), ms(sr, 0.3));
    const b = rms(r.left, ms(sr, 0.35), ms(sr, 0.45));
    expect(a).toBeGreaterThan(0.1);
    expect(Math.abs(a - b) / a).toBeLessThan(0.05);
    expect(rms(r.left, ms(sr, 0.7), ms(sr, 0.9))).toBeLessThan(a * 0.01);
    // A 220 Hz sine at this level moves at most ~0.0105 per sample.
    expect(maxJump(r.left)).toBeLessThan(0.0125);
    expect(detectClicks(r.left, { minJump: 0.005 })).toEqual([]);
  });

  it('drum play plays the slice once', () => {
    const at = [{ time: 0.1, cmd: { type: 'play', sound: DRUM, key: 3, on: true } as EngineCommand }];
    const r = render(drumFixture(sr), 0.5, { at });
    const on = sparseOnsets(r.left, sr);
    expect(on.length).toBe(1);
    expect(Math.abs(on[0]! - (ms(sr, 0.1) + r.latency))).toBeLessThanOrEqual(128 + 1); // applied at block start
    expect(dominantIndex(r.left, sr, Array.from({ length: 16 }, (_, k) => 500 + 200 * k), on[0]!, on[0]! + 1200)).toBe(3);
    expect(peak(r.left.subarray(on[0]! + ms(sr, 0.04)))).toBeLessThan(1e-4);
  });

  it('retriggering the same drum key chokes the first hit without a click', () => {
    const play = (t: number) => ({ time: t, cmd: { type: 'play', sound: DRUM, key: 3, on: true } as EngineCommand });
    // Hits are applied at block starts, so use block-aligned times (multiples of 128 samples).
    const t1 = (128 * 40) / sr;
    const t2 = (128 * 44) / sr; // 3.5 ms later, inside the first burst
    const single = render(drumFixture(sr), 0.4, { at: [play(t2)] });
    const double = render(drumFixture(sr), 0.4, { at: [play(t1), play(t2)] });
    expect(allFinite(double.left)).toBe(true);
    expect(maxJump(double.left)).toBeLessThan(maxJump(single.left) * 2.2);
    // Once the 5 ms steal fade is over the output equals the second hit alone: the first one was choked.
    const from = 128 * 44 + ms(sr, 0.012);
    let d = 0;
    for (let i = from; i < double.left.length; i++) d = Math.max(d, Math.abs(double.left[i]! - single.left[i]!));
    expect(d).toBeLessThan(1e-4);
    // And the first hit was audible before the retrigger.
    expect(peak(double.left.subarray(128 * 40, 128 * 44 + double.latency))).toBeGreaterThan(0.05);
  });
});

describe('flam dedup', () => {
  // A live hit shortly before a sequenced hit of the same sound/key should suppress the sequenced one
  // (recording a hit the user played early must not double-trigger).
  const sr = 48000;
  const seqHit = withStep(emptyPattern(), DRUM, 4, keyMask(0)); // step 4 = 0.5 s at 120 BPM
  const live = (t: number) => ({ time: t, cmd: { type: 'play', sound: DRUM, key: 0, on: true } as EngineCommand });
  const onsets = (at: ReturnType<typeof live>[]) => sparseOnsets(render([tempo(120), ...drumFixture(sr, seqHit), PLAY], 0.8, { at }).left, sr, 1e-3, 10);

  it('control: a live hit well before (> half a step) the sequenced hit does not suppress it', () => {
    expect(onsets([live(0.3)]).length).toBe(2);
    expect(onsets([]).length).toBe(1);
  });

  // ENGINE BUG (see report): steps are scheduled LOOKAHEAD_STEPS (0.5) ahead, and a live hit applied at a block
  // start can never be both < 0.5 step before the sequenced hit and processed before that hit is scheduled,
  // so the dedup check in schedule() never fires. Fix: do the check in dispatch() for sequenced EV_ON events.
  it('a live hit 50 ms (< half a step) before the sequenced hit suppresses it', () => {
    expect(onsets([live(0.45)]).length).toBe(1);
  });
});

describe('voice stealing', () => {
  const rapid = (count: number) => {
    const sr = 48000;
    const cmds: EngineCommand[] = [];
    for (let s = 0; s < 8; s++) cmds.push(...slot(s, 'melodic', `m${s}`, sineSample(200 + 40 * s, 3, sr), sr));
    const at = Array.from({ length: count }, (_, i) => ({
      time: 0.05 + i * 0.004,
      cmd: { type: 'play', sound: i % 8, key: (i * 5) % 16, on: true } as EngineCommand,
    }));
    const r = render(cmds, 0.8, { at });
    expect(allFinite(r.left)).toBe(true);
    expect(peak(r.left)).toBeLessThanOrEqual(1);
    expect(peak(r.left)).toBeGreaterThan(0.3);
    return r;
  };

  it('30 rapid notes over 8 sounds (per-sound steals only): no clicks, no NaN, output <= 1', () => {
    expect(detectClicks(rapid(30).left)).toEqual([]);
  });

  // ENGINE BUG (see report): once all 32 voices are active, Engine.noteOn() reuses the quietest voice by calling
  // SampleVoice.noteOn() directly, which hard-cuts it (no stealFade). Fix: if the picked voice is active, run its
  // 5 ms steal fade first (e.g. allocate from a separate fading pool, or defer the new note by the fade length).
  it('40 rapid notes (global voice steal at note 33): no clicks, no NaN, output <= 1', () => {
    expect(detectClicks(rapid(40).left)).toEqual([]);
  });

  it('chord of more notes than a sound may hold stays finite and click-free', () => {
    const sr = 48000;
    const p = withStep(emptyPattern(), MEL, 0, 0xffff);
    const r = render([...sineFixture(sr, 300, p), PLAY], 0.5);
    expect(allFinite(r.left)).toBe(true);
    expect(peak(r.left)).toBeLessThanOrEqual(1);
    expect(detectClicks(r.left)).toEqual([]);
  });
});

describe('stop', () => {
  it('stops scheduling sequenced notes and emits step -1', () => {
    const sr = 48000;
    let p = emptyPattern();
    for (let s = 0; s < 16; s++) p = withStep(p, DRUM, s, keyMask(0));
    // Step 5 (0.625 s) is already queued (lookahead) when stop arrives at 0.6 s: it must be dropped too.
    const at = [{ time: 0.6, cmd: STOP }];
    const r = render([tempo(120), ...drumFixture(sr, p), PLAY], 2, { at });
    expect(sparseOnsets(r.left, sr, 1e-3, 10).length).toBe(5); // steps 0..4
    const steps = r.events.flatMap((e) => (e.type === 'step' ? [e] : []));
    expect(steps[steps.length - 1]!.step).toBe(-1);
    expect(steps.filter((e) => e.step === -1).length).toBe(1);
    expect(steps.filter((e) => e.step >= 0).length).toBeLessThanOrEqual(7);
  });

  it('releases sustained sequenced notes', () => {
    const sr = 48000;
    const p = withStep(emptyPattern(), MEL, 0, keyMask(0));
    const r = render([...sineFixture(sr, 220, p), PLAY], 1, { at: [{ time: 0.3, cmd: STOP }] });
    expect(rms(r.left, ms(sr, 0.2), ms(sr, 0.28))).toBeGreaterThan(0.1);
    expect(rms(r.left, ms(sr, 0.5), ms(sr, 1))).toBeLessThan(1e-3);
  });
});

describe('resample', () => {
  it('captures from the next pattern start and matches the output', () => {
    const sr = 48000;
    let p = emptyPattern();
    for (const s of [0, 4, 8, 12]) p = withStep(p, DRUM, s, keyMask(s / 4));
    const buf = new Float32Array(sr); // 1 s
    const at = [{ time: 0.3, cmd: { type: 'resample', id: 'cap', l: buf } as EngineCommand }];
    const r = render([tempo(120), ...drumFixture(sr, p), PLAY], 3.2, { at });
    const ev = r.events.find((e) => e.type === 'resampled');
    expect(ev).toBeDefined();
    if (!ev || ev.type !== 'resampled') return;
    expect(ev.id).toBe('cap');
    const cap = ev.l;
    expect(cap.length).toBe(sr);
    expect(peak(cap)).toBeGreaterThan(0.1);
    // Capture starts at frame 96000 (pattern 2 start, 2 s at 120 BPM), with the step-0 hit right there.
    const first = sparseOnsets(cap, sr, 1e-3, 10);
    expect(first[0]).toBeLessThanOrEqual(2);
    expect(first.length).toBe(2); // steps 0 and 4 fall inside the 1 s capture
    // Pre-limiter capture vs post-limiter output (delayed by the limiter latency): equal while the limiter is idle.
    const start = 2 * sr + r.latency;
    let d = 0;
    for (let i = 0; i < sr; i++) d = Math.max(d, Math.abs(cap[i]! - r.left[start + i]!));
    expect(d).toBeLessThan(2e-3);
  });

  it('captures immediately while stopped', () => {
    const sr = 48000;
    const buf = new Float32Array(ms(sr, 0.3));
    const at = [{ time: 0.1, cmd: { type: 'play', sound: DRUM, key: 0, on: true } as EngineCommand }];
    const r = render([...drumFixture(sr), { type: 'resample', id: 'c', l: buf }], 0.6, { at });
    const ev = r.events.find((e) => e.type === 'resampled');
    expect(ev && ev.type === 'resampled' && peak(ev.l)).toBeGreaterThan(0.1);
  });
});

describe('punch FX', () => {
  const sr = 48000;
  const stutter16 = FX_IDS.indexOf('stutter16');

  it('stutter16 pressed while playing starts on the next 1/16 and stays finite and <= 1', () => {
    expect(stutter16).toBe(2);
    // The stutter records the audio after its start: pressed at 0.3 s it snaps to step 3 (0.375 s), captures the
    // click played there and repeats it every 1/16.
    const p = withStep(emptyPattern(), DRUM, 3, keyMask(0));
    const cmds = [tempo(120), ...drumFixture(sr, p), PLAY];
    const dry = render(cmds, 1.0);
    const at = [
      { time: 0.3, cmd: { type: 'fx', fx: stutter16, on: true } as EngineCommand },
      { time: 0.9, cmd: { type: 'fx', fx: stutter16, on: false } as EngineCommand },
    ];
    const wet = render(cmds, 1.0, { at });
    expect(allFinite(wet.left)).toBe(true);
    expect(peak(wet.left)).toBeLessThanOrEqual(1);
    let firstDiff = -1;
    for (let i = 0; i < dry.left.length; i++)
      if (Math.abs(dry.left[i]! - wet.left[i]!) > 1e-3) {
        firstDiff = i;
        break;
      }
    expect(firstDiff).toBeGreaterThan(0);
    const snap = 0.375 * sr + wet.latency;
    expect(firstDiff).toBeGreaterThanOrEqual(snap - 1);
    expect(firstDiff).toBeLessThan(snap + ms(sr, 0.02));
    // The stutter repeats the click that the dry output only plays once.
    expect(sparseOnsets(wet.left, sr, 1e-3, 10).length).toBeGreaterThan(sparseOnsets(dry.left, sr, 1e-3, 10).length);
  });

  it('an FX lane step presses at that step and releases when the lane changes', () => {
    // The click at step 4 (0.5 s) is captured by the stutter the lane presses at steps 4..7 (0.5 .. 1.0 s) and
    // repeated. The hit at step 12 is identical in both renders.
    let p = withStep(withStep(emptyPattern(), DRUM, 4, keyMask(0)), DRUM, 12, keyMask(1));
    const dryCmds = [tempo(120), ...drumFixture(sr, p), PLAY];
    p = withFx(p, 4, 8, stutter16);
    const laneCmds = [tempo(120), ...drumFixture(sr, p), PLAY];
    const dry = render(dryCmds, 2.0);
    const lane = render(laneCmds, 2.0);
    expect(allFinite(lane.left)).toBe(true);
    expect(peak(lane.left)).toBeLessThanOrEqual(1);
    const lat = lane.latency;
    // Identical before the lane starts (step 4 = 0.5 s) ...
    expect(maxDiff(dry.left, lane.left, 0, 0.5 * sr + lat - 1)).toBeLessThan(1e-4);
    // ... different while it is held ...
    expect(rms(sub(dry.left, lane.left), ms(sr, 0.52) + lat, ms(sr, 0.95) + lat)).toBeGreaterThan(0.01);
    // ... and back to identical after the release at step 8 (1.0 s) plus the ramp, until the next hit.
    expect(maxDiff(dry.left, lane.left, 1.0 * sr + lat + ms(sr, 0.03), 1.45 * sr)).toBeLessThan(1e-3);
    expect(maxDiff(dry.left, lane.left, 1.5 * sr, 2.0 * sr)).toBeLessThan(1e-3);
  });
});

function sub(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i]! - b[i]!;
  return o;
}

function maxDiff(a: Float32Array, b: Float32Array, from: number, to: number): number {
  let d = 0;
  for (let i = Math.round(from); i < Math.min(Math.round(to), a.length); i++) d = Math.max(d, Math.abs(a[i]! - b[i]!));
  return d;
}

// Silence unused-import lint for helpers used only in some configurations.
void soundCmd;
