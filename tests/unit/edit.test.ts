import { describe, expect, it } from 'vitest';
import { defaultProject } from '../../src/store/defaults';
import { clearLane, clearPattern, copyPattern, getStep, patternDensity, patternIsEmpty, setChain, setFxStep, setLen, setLock, tapTempo, toggleKey, toggleStep } from '../../src/store/edit';

describe('edits', () => {
  it('toggles steps, keys, locks and length', () => {
    let p = defaultProject();
    const p0 = p;
    p = toggleStep(p, 0, 9, 4, 3);
    expect(getStep(p, 0, 9, 4)).toEqual({ keys: 8 });
    expect(p0.patterns[0]!.lanes[9]![4]).toBeNull(); // immutable
    p = toggleKey(p, 0, 9, 4, 0);
    expect(getStep(p, 0, 9, 4)!.keys).toBe(9);
    p = setLock(p, 0, 9, 4, 'A', 30);
    expect(getStep(p, 0, 9, 4)!.lockA).toBe(24);
    p = setLock(p, 0, 9, 4, 'A', null);
    expect(getStep(p, 0, 9, 4)!.lockA).toBeUndefined();
    p = setLen(p, 0, 9, 4, 3);
    expect(getStep(p, 0, 9, 4)!.len).toBe(3);
    p = toggleKey(toggleKey(p, 0, 9, 4, 0), 0, 9, 4, 3);
    expect(getStep(p, 0, 9, 4)).toBeNull();
    expect(setLock(p, 0, 9, 4, 'B', 10)).toBe(p); // no step, no change
  });
  it('unchanged edits return the same project', () => {
    const p = defaultProject();
    expect(clearPattern(p, 0)).toBe(p);
    expect(setChain(p, [0])).toBe(p);
    expect(setChain(p, [99])).toBe(p);
  });
  it('copies, clears, densities, fx and chains', () => {
    let p = toggleStep(defaultProject(), 1, 0, 0, 0);
    p = setFxStep(p, 1, 2, 5);
    expect(patternIsEmpty(p.patterns[1])).toBe(false);
    p = copyPattern(p, 1, 7);
    expect(p.patterns[7]).toBe(p.patterns[1]);
    expect(patternDensity(p.patterns[7]!)[0]).toBe(1);
    p = clearLane(p, 7, 0);
    expect(getStep(p, 7, 0, 0)).toBeNull();
    p = clearPattern(p, 1);
    expect(patternIsEmpty(p.patterns[1])).toBe(true);
    expect(setChain(p, [3, 1, 3]).chain).toEqual([3, 1, 3]);
  });
  it('tap tempo', () => {
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    expect(tapTempo([0])).toBeNull();
    expect(tapTempo([0, 5000])).toBeNull();
  });
});
