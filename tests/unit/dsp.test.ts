import { describe, expect, it } from 'vitest';
import { crop, fadeEdges, limitLength, normalize, reverse } from '../../src/dsp/process';
import { autoSlices } from '../../src/dsp/slice';
import { peaks } from '../../src/dsp/peaks';

const R = 44100;
function burstTrain(times: number[], dur: number): Float32Array {
  const l = new Float32Array(Math.round((dur) * R));
  let seed = 1;
  for (const t of times) {
    const a = Math.round(t * R);
    for (let i = 0; i < 0.06 * R && a + i < l.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      l[a + i] = (seed / 0x7fffffff - 0.5) * 2 * Math.exp(-i / (0.015 * R)) * 0.8;
    }
  }
  return l;
}

describe('process', () => {
  it('normalize hits the peak', () => {
    const o = normalize(Float32Array.from([0.1, -0.25, 0.2]), -6);
    expect(Math.max(...Array.from(o).map(Math.abs))).toBeCloseTo(10 ** (-6 / 20), 5);
    expect(Array.from(normalize(new Float32Array(4)))).toEqual([0, 0, 0, 0]);
  });
  it('reverse', () => expect(Array.from(reverse(Float32Array.from([1, 2, 3])))).toEqual([3, 2, 1]));
  it('fadeEdges ends at 0', () => {
    const o = fadeEdges(new Float32Array(1000).fill(1), R);
    expect(o[0]).toBe(0);
    expect(o[999]).toBe(0);
    expect(o[500]).toBe(1);
  });
  it('limitLength', () => {
    const o = limitLength(new Float32Array(R * 3).fill(1), R, 1);
    expect(o.length).toBe(R);
    expect(o[R - 1]).toBe(0);
    expect(limitLength(new Float32Array(10), R, 1).length).toBe(10);
  });
  it('crop', () => expect(Array.from(crop(Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 0.2, 0.5))).toEqual([2, 3, 4]));
});

describe('peaks', () => {
  it('min/max per bucket', () => {
    const o = peaks(Float32Array.from([1, -2, 3, 0, -5, 4, 2, 2]), 2);
    expect(Array.from(o)).toEqual([-2, 3, -5, 4]);
    expect(Array.from(peaks(Float32Array.from([1, 2, 3, 4]), 1, 1, 3))).toEqual([2, 3]);
  });
});

describe('autoSlices', () => {
  const asc = (b: number[], c: number) => {
    expect(b.length).toBe(c + 1);
    expect(b[0]).toBe(0);
    expect(b[b.length - 1]).toBe(1);
    for (let i = 1; i < b.length; i++) expect(b[i]!).toBeGreaterThan(b[i - 1]!);
  };
  it('16 irregular bursts', () => {
    const times = [0, 0.2, 0.31, 0.5, 0.58, 0.8, 0.93, 1.1, 1.17, 1.4, 1.52, 1.75, 1.9, 2.05, 2.3, 2.41];
    const l = burstTrain(times, 2.7);
    const b = autoSlices(l, R);
    asc(b, 16);
    times.forEach((t, k) => {
      const d = t - b[k]! * (l.length / R);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(0.005);
    });
  });
  it('5 bursts fill with splits', () => {
    const times = [0.1, 0.6, 0.9, 1.5, 1.8];
    const l = burstTrain(times, 2.4);
    const b = autoSlices(l, R);
    asc(b, 16);
    for (const t of times) expect(b.some((x) => { const d = t - x * 2.4; return d >= 0 && d < 0.005; })).toBe(true);
  });
  it('silence', () => {
    asc(autoSlices(new Float32Array(R), R), 16);
    asc(autoSlices(new Float32Array(0), R), 16);
  });
});

describe('fewer slices', () => {
  it('autoSlices without fill keeps only detected hits', () => {

    const rate = 44100;
    const l = new Float32Array(rate * 2);
    for (const t of [0, 0.5, 1.2]) for (let i = 0; i < 2000; i++) l[Math.round(t * rate) + i] = Math.sin(i * 0.3) * Math.exp(-i / 400);
    const b = autoSlices(l, rate, 16, false);
    expect(b.length).toBe(4); // 3 slices
    expect(b[0]).toBe(0);
    expect(b[3]).toBe(1);
    expect(Math.abs(b[1]! - 0.25)).toBeLessThan(0.01);
    expect(Math.abs(b[2]! - 0.6)).toBeLessThan(0.01);
    expect(autoSlices(l, rate, 16).length).toBe(17);
  });
});
