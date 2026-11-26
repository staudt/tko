import { describe, expect, it } from 'vitest';
import { render, slot, emptyPattern, withStep, keyMask, patternCmd, clickTrain, sparseOnsets } from './render';
import type { EngineCommand, EngineEvent } from '../../src/engine/protocol';

describe('export capture', () => {
  it('fromStart + post: starts on the transport start frame, excludes the metronome, never exceeds 1', () => {
    const sr = 48000;
    const p = withStep(emptyPattern(), 9, 0, keyMask(0));
    const l = new Float32Array(sr); // 1 s
    const cmds: EngineCommand[] = [
      ...slot(9, 'drum', 'd', clickTrain(sr), sr),
      patternCmd(0, p),
      { type: 'metronome', on: true },
      { type: 'resample', id: 'x', l, tap: 'post', fromStart: true },
    ];
    const r = render(cmds, 1.6, { sr, at: [{ time: 0.3, cmd: { type: 'transport', playing: true } }] });
    const ev = r.events.find((e): e is Extract<EngineEvent, { type: 'resampled' }> => e.type === 'resampled');
    expect(ev).toBeDefined();
    const cap = ev!.l;
    // Only the step-0 hit (no metronome clicks on beats 2-4 at 0.5 s steps would add more onsets).
    const on = sparseOnsets(cap, sr);
    expect(on.length).toBe(1);
    expect(on[0]!).toBeLessThan(Math.round(0.005 * sr)); // starts right at the transport start (plus limiter latency)
    expect(Math.max(...cap.map(Math.abs))).toBeLessThanOrEqual(1);
  });
});
