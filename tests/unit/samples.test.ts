import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deleteSample, getSample, listSamples, saveSample, secondsUsed } from '../../src/store/samples';

describe('user samples', () => {
  it('roundtrip, list, secondsUsed, delete', async () => {
    const l = Float32Array.from({ length: 22050 }, (_, i) => Math.sin(i / 10));
    const id = await saveSample('test', { l, rate: 44100 }, 'record');
    expect(id[0]).toBe('u');
    const got = await getSample(id);
    expect(got?.rate).toBe(44100);
    expect(Array.from(got!.l.slice(0, 50))).toEqual(Array.from(l.slice(0, 50)));
    expect(await getSample(id)).toBe(got); // cached
    const list = await listSamples();
    expect(list.find((m) => m.id === id)).toMatchObject({ name: 'test', frames: 22050, rate: 44100, source: 'record' });
    expect(list[0] && 'audio' in list[0]).toBe(false);
    expect(await secondsUsed([id, id, null, 'f:1', 'unknown'])).toBeCloseTo(0.5, 5);
    await deleteSample(id);
    expect(await getSample(id)).toBeNull();
    expect((await listSamples()).some((m) => m.id === id)).toBe(false);
  });
  it('loads from storage when not cached', async () => {
    const id = await saveSample('x', { l: Float32Array.from([0.5, -0.5]), rate: 8000 }, 'file');
    const { _closeDb } = await import('../../src/store/persist');
    await _closeDb();
    expect(Array.from((await getSample(id))!.l)).toEqual([0.5, -0.5]);
  });
});
