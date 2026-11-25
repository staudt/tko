import { describe, expect, it } from 'vitest';
import { apply, project, redo, replaceProject, undo, updateSound } from '../../src/store/project';
import { defaultProject, emptyPattern } from '../../src/store/defaults';
import { packPattern } from '../../src/store/pack';
import { NO_LOCK, STEPS } from '../../src/engine/protocol';

describe('store', () => {
  it('merges knob drags into one undo step', () => {
    replaceProject(defaultProject());
    for (let i = 1; i <= 5; i++) apply((p) => updateSound(p, 0, { pitch: i }), { merge: 'knob:0' });
    expect(project.value.sounds[0]!.pitch).toBe(5);
    undo();
    expect(project.value.sounds[0]!.pitch).toBe(0);
    redo();
    expect(project.value.sounds[0]!.pitch).toBe(5);
  });
  it('packs steps, locks and fx', () => {
    const p = emptyPattern();
    const lanes = p.lanes.map((l) => l.slice());
    lanes[3]![5] = { keys: 0b101, len: 2, lockA: 7, lockB: -50 };
    const packed = packPattern({ lanes, fx: p.fx.map((_, j) => (j === 4 ? 9 : null)) });
    const i = 3 * STEPS + 5;
    expect([packed.keys[i], packed.len[i], packed.lockA[i], packed.lockB[i]]).toEqual([5, 2, 7, -50]);
    expect(packed.lockA[0]).toBe(NO_LOCK);
    expect(packed.fx[4]).toBe(9);
  });
});
