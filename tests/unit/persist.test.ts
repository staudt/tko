import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProject } from '../../src/store/defaults';
import {
  CURRENT_KEY,
  MAX_VERSIONS,
  META,
  PROJECTS,
  listVersions,
  loadCurrentProject,
  loadVersion,
  migrate,
  run,
  snapshotVersion,
  startPersistence,
} from '../../src/store/persist';
import type { Project } from '../../src/store/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withStep(p: Project, keys: number): Project {
  const patterns = p.patterns.map((pat, i) =>
    i === 0 ? { ...pat, lanes: pat.lanes.map((l, j) => (j === 0 ? l.map((s, k) => (k === 0 ? { keys, lockA: 3 } : s)) : l)) } : pat,
  );
  return { ...p, patterns };
}

function store(initial: Project) {
  let cur = initial;
  const subs = new Set<() => void>();
  return {
    get: () => cur,
    subscribe: (cb: () => void) => (subs.add(cb), () => subs.delete(cb)),
    set(p: Project) {
      cur = p;
      subs.forEach((f) => f());
    },
  };
}

describe('persist', () => {
  afterEach(() => vi.restoreAllMocks());

  it('round-trips through autosave', async () => {
    const s = store(defaultProject());
    const stop = startPersistence(s.get, s.subscribe, { debounceMs: 5 });
    s.set({ ...withStep(s.get(), 0b101), bpm: 99 });
    await sleep(60);
    stop();
    const loaded = await loadCurrentProject();
    expect(loaded).toEqual(s.get());
  });

  it('coalesces many edits into one write', async () => {
    const s = store(defaultProject());
    const puts = vi.spyOn(IDBObjectStore.prototype, 'put');
    const stop = startPersistence(s.get, s.subscribe, { debounceMs: 30 });
    for (let i = 0; i < 20; i++) s.set({ ...s.get(), bpm: 100 + i });
    await sleep(120);
    stop();
    const projectPuts = puts.mock.calls.filter((c) => c[1] === s.get().id);
    expect(projectPuts.length).toBe(1);
    expect((await loadCurrentProject())?.bpm).toBe(119);
  });

  it('caps versions at 20 per project', async () => {
    const p = defaultProject();
    for (let i = 0; i < 25; i++) await snapshotVersion({ ...p, bpm: 60 + i }, 1000 + i);
    const other = defaultProject();
    await snapshotVersion({ ...other, id: 'other' }, 5);
    const v = await listVersions(p.id);
    expect(v.length).toBe(MAX_VERSIONS);
    expect(v[0]!.savedAt).toBe(1024);
    expect((await loadVersion(v[0]!.id))?.bpm).toBe(84);
    expect((await listVersions('other')).length).toBe(1);
  });

  it('returns null when nothing is stored or the record is garbage', async () => {
    await run(META, 'readwrite', (s) => s.put('nope', CURRENT_KEY));
    expect(await loadCurrentProject()).toBeNull();
    await run(META, 'readwrite', (s) => s.put('bad', CURRENT_KEY));
    await run(PROJECTS, 'readwrite', (s) => s.put({ project: 42 }, 'bad'));
    expect(await loadCurrentProject()).toBeNull();
  });

  it('migrate repairs a corrupted project', () => {
    const good = withStep(defaultProject(), 1);
    const bad = JSON.parse(JSON.stringify(good)) as Record<string, any>;
    bad.bpm = 9999;
    bad.swing = 10;
    bad.volume = 'loud';
    bad.patterns.splice(3, 13);
    bad.patterns[0].lanes[0][0] = { keys: 0x1ffff, lockA: 99, lockB: -500, len: 40 };
    bad.sounds[2].pitch = 100;
    bad.sounds[2].tone = -5;
    bad.chain = [99, 2, -1];
    const m = migrate(bad)!;
    expect(m.bpm).toBe(300);
    expect(m.swing).toBe(50);
    expect(m.volume).toBe(0.8);
    expect(m.patterns.length).toBe(16);
    expect(m.patterns[10]!.lanes.length).toBe(16);
    expect(m.patterns[10]!.lanes[5]!.length).toBe(16);
    expect(m.patterns[0]!.lanes[0]![0]).toEqual({ keys: 0xffff, lockA: 24, lockB: -100, len: 16 });
    expect(m.sounds[2]!.pitch).toBe(24);
    expect(m.sounds[2]!.tone).toBe(-1);
    expect(m.chain).toEqual([2]);
  });

  it('migrate rejects garbage and future versions', () => {
    expect(migrate(null)).toBeNull();
    expect(migrate('x')).toBeNull();
    expect(migrate([])).toBeNull();
    expect(migrate({})).toBeNull();
    expect(migrate({ version: 999, sounds: [], patterns: [] })).toBeNull();
    expect(migrate({ ...defaultProject(), version: 'a' })).toBeNull();
  });
});
