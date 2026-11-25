import { describe, expect, it } from 'vitest';
import { calibrationOffset, heldLength, quantizeHit } from '../../src/store/record';
import { addKey, getStep } from '../../src/store/edit';
import { defaultProject } from '../../src/store/defaults';

describe('record', () => {
  it('quantizes to the nearest step and crosses into the next chained pattern', () => {
    expect(quantizeHit({ step: 3, frac: 0.4, pattern: 2, chainPos: 0 }, [2, 5])).toEqual({ pattern: 2, step: 3 });
    expect(quantizeHit({ step: 3, frac: 0.6, pattern: 2, chainPos: 0 }, [2, 5])).toEqual({ pattern: 2, step: 4 });
    expect(quantizeHit({ step: 15, frac: 0.7, pattern: 2, chainPos: 0 }, [2, 5])).toEqual({ pattern: 5, step: 0 });
    expect(quantizeHit({ step: 15, frac: 0.7, pattern: 5, chainPos: 1 }, [2, 5])).toEqual({ pattern: 2, step: 0 });
    expect(quantizeHit({ step: 15, frac: 0.7, pattern: 4, chainPos: 0 }, [4])).toEqual({ pattern: 4, step: 0 });
  });
  it('held length', () => {
    expect(heldLength(0.4)).toBe(0);
    expect(heldLength(2.2)).toBe(2);
    expect(heldLength(40)).toBe(16);
  });
  it('calibration median offset', () => {
    const clicks = [0, 0.5, 1, 1.5, 2, 2.5];
    expect(calibrationOffset(clicks, [0.08, 0.57, 1.09, 1.58, 2.07, 2.6])).toBe(80);
    expect(calibrationOffset(clicks, [0.1, 0.6])).toBeNull();
  });
  it('addKey adds without removing', () => {
    let p = addKey(defaultProject(), 0, 9, 4, 2);
    p = addKey(p, 0, 9, 4, 2);
    p = addKey(p, 0, 9, 4, 5);
    expect(getStep(p, 0, 9, 4)!.keys).toBe((1 << 2) | (1 << 5));
  });
});
