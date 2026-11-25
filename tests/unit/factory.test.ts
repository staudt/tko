import { describe, expect, it } from 'vitest';
import { assembleSlot, findOnset, sliceRegions } from '../../src/dsp/onset';

const RATE = 44100;
const DELAY = 1105; // fake MP3 encoder delay in samples

/** Silence with decaying noise-ish bursts at the given sample positions, all shifted by DELAY. */
function synth(totalS: number, bursts: { at: number; len: number; amp: number }[], shift = DELAY): Float32Array {
  const d = new Float32Array(Math.round(totalS * RATE));
  for (const b of bursts) {
    for (let i = 0; i < b.len; i++) {
      const env = Math.exp((-5 * i) / b.len);
      d[b.at + shift + i] = b.amp * env * Math.sin(i * 0.9 + 0.3);
    }
    // MP3-ish pre-echo ~ -45 dB, 100 samples before the onset
    for (let i = 0; i < 80; i++) d[b.at + shift - 100 + i]! += b.amp * 0.005 * Math.sin(i * 1.3);
  }
  return d;
}

describe('findOnset', () => {
  it('finds the first sample above threshold', () => {
    const d = new Float32Array(1000);
    d[400] = 0.5;
    expect(findOnset(d, 0, 1000)).toBe(400);
    expect(findOnset(d, 401, 1000)).toBeNull();
  });
});

describe('assembleSlot', () => {
  const starts = Array.from({ length: 16 }, (_, k) => 0.08 + k * 0.3);
  const burstLen = Math.round(0.15 * RATE);
  const amps = starts.map((_, k) => (k % 5 === 4 ? 0.05 : 0.8)); // some quiet hits
  const data = synth(
    0.08 + 16 * 0.3 + 0.2,
    starts.map((s, k) => ({ at: Math.round(s * RATE), len: burstLen, amp: amps[k]! })),
  );
  const entry = { kind: 'drum' as const, hits: starts.map((s, k) => ({ name: `h${k}`, start: s, duration: 0.2 })) };

  it('produces 17 monotonic boundaries with exact ends', () => {
    const { l, slices } = assembleSlot(data, RATE, entry);
    expect(slices).toHaveLength(17);
    expect(slices[0]).toBe(0);
    expect(slices[16]).toBe(1);
    for (let k = 1; k < 17; k++) expect(slices[k]!).toBeGreaterThan(slices[k - 1]!);
    expect(l.length).toBe(Math.round(16 * 0.2 * RATE));
  });

  it('starts each hit within 1.5 ms of its burst onset', () => {
    const { l, slices } = assembleSlot(data, RATE, entry);
    for (let k = 0; k < 16; k++) {
      const from = Math.round(slices[k]! * l.length);
      const to = Math.round(slices[k + 1]! * l.length);
      const on = findOnset(l.subarray(from, to), 0, to - from, -40)!;
      // Burst begins at sample 0 of the hit minus preroll (1 ms = 44 samples), so onset should sit near 44.
      expect(Math.abs(on - 44)).toBeLessThanOrEqual(Math.round(0.0015 * RATE));
    }
  });

  it('ignores pre-echo and falls back to the median shift for missing sounds', () => {
    const regions = sliceRegions(data, RATE, [...entry.hits, { start: 5.5, duration: 0.2 }]);
    const r0 = regions[0]!;
    expect(Math.abs(r0.startSample - (Math.round(starts[0]! * RATE) + DELAY - 44))).toBeLessThanOrEqual(2);
    // Beyond the data: clamped, never negative.
    expect(regions[16]!.startSample).toBeLessThanOrEqual(data.length);
    expect(regions[16]!.length).toBeGreaterThanOrEqual(0);
  });

  it('trims a melodic note from its onset for `duration`', () => {
    const note = synth(1.5, [{ at: Math.round(0.08 * RATE), len: RATE, amp: 0.7 }]);
    const { l, slices } = assembleSlot(note, RATE, { kind: 'melodic', start: 0.08, duration: 1.0 });
    expect(slices).toEqual([]);
    expect(l.length).toBe(RATE);
    const on = findOnset(l, 0, l.length, -40)!;
    expect(Math.abs(on - 44)).toBeLessThanOrEqual(Math.round(0.0015 * RATE));
  });
});
