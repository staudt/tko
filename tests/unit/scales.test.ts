import { describe, expect, it } from 'vitest';
import { scaleOffsets } from '../../src/store/scales';
import { removeKey, addKey, getStep, setKey } from '../../src/store/edit';
import { defaultProject } from '../../src/store/defaults';
import { migrate } from '../../src/store/persist';

describe('scales', () => {
  it('maps 16 keys over octaves', () => {
    expect(scaleOffsets('chromatic')).toEqual([...Array(16).keys()]);
    expect(scaleOffsets('minPent').slice(0, 7)).toEqual([0, 3, 5, 7, 10, 12, 15]);
    expect(scaleOffsets('major')[15]).toBe(26);
  });
  it('removeKey, setKey, and migrate keeps scale/key', () => {
    let p = addKey(addKey(defaultProject(), 0, 0, 0, 1), 0, 0, 0, 2);
    p = removeKey(p, 0, 0, 0, 1);
    expect(getStep(p, 0, 0, 0)!.keys).toBe(4);
    p = removeKey(p, 0, 0, 0, 2);
    expect(getStep(p, 0, 0, 0)).toBeNull();
    expect(setKey(p, -1).key).toBe(11);
    const m = migrate({ ...p, scale: 'minPent', key: 3 });
    expect([m?.scale, m?.key]).toEqual(['minPent', 3]);
    expect(migrate({ ...p, scale: 'nope' })?.scale).toBe('chromatic');
  });
});
