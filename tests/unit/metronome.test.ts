import { describe, expect, it } from 'vitest';
import { render, sparseOnsets } from './render';

describe('metronome', () => {
  it('clicks on every beat at 120 BPM, only while playing, sample-accurate', () => {
    const r = render([{ type: 'tempo', bpm: 120, swing: 50 }, { type: 'metronome', on: true }, { type: 'transport', playing: true }], 2.1);
    const on = sparseOnsets(r.left, r.sr, 1e-3, 20);
    const lat = r.engine.latency;
    const expected = [0, 0.5, 1, 1.5, 2].map((t) => Math.round(t * r.sr) + lat);
    expect(on.length).toBe(expected.length);
    on.forEach((f, i) => expect(Math.abs(f - expected[i]!)).toBeLessThanOrEqual(Math.ceil(r.sr / 1000)));
  });
  it('is silent when off or stopped', () => {
    const a = render([{ type: 'metronome', on: true }], 0.5);
    const b = render([{ type: 'transport', playing: true }], 0.5);
    expect(sparseOnsets(a.left, a.sr).length + sparseOnsets(b.left, b.sr).length).toBe(0);
  });
});
