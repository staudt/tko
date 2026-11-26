import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProject } from '../../src/store/defaults';
import { _closeDb, deleteProject, duplicateProject, listProjects, loadCurrentProject, loadProject, saveProjectNow, setCurrentProject } from '../../src/store/persist';
import { listSamples, saveSample } from '../../src/store/samples';
import type { Project } from '../../src/store/types';

const withSample = (p: Project, sampleId: string): Project => ({ ...p, sounds: p.sounds.map((s, i) => (i === 0 ? { ...s, sampleId } : s)) });
const withStep = (p: Project): Project => ({
  ...p,
  patterns: p.patterns.map((pat, i) => (i === 3 ? { ...pat, lanes: pat.lanes.map((l, j) => (j === 0 ? l.map((s, k) => (k === 0 ? { keys: 1 } : s)) : l)) } : pat)),
});

beforeEach(async () => {
  await _closeDb();
  indexedDB = new IDBFactory();
});

describe('multiple projects', () => {
  it('saves, lists newest first, loads and sets current', async () => {
    const a = { ...defaultProject(), name: 'A', bpm: 90 };
    const b = withStep({ ...defaultProject(), name: 'B' });
    await saveProjectNow(a);
    await new Promise((r) => setTimeout(r, 5));
    await saveProjectNow(b);
    const l = await listProjects();
    expect(l.map((x) => x.name)).toEqual(['B', 'A']);
    expect(l[1]!.bpm).toBe(90);
    expect(l[0]!.patternsUsed.filter(Boolean).length).toBe(1);
    expect(l[0]!.patternsUsed[3]).toBe(true);
    expect(await loadProject(a.id)).toEqual(a);
    expect(await loadProject('nope')).toBeNull();
    await setCurrentProject(a.id);
    expect((await loadCurrentProject())?.name).toBe('A');
  });

  it('duplicates under a new id and name', async () => {
    const a = withStep({ ...defaultProject(), name: 'A' });
    await saveProjectNow(a);
    const id = await duplicateProject(a.id, 'A copy');
    expect(id).toBeTruthy();
    expect(id).not.toBe(a.id);
    const c = await loadProject(id!);
    expect(c?.name).toBe('A copy');
    expect(c?.patterns).toEqual(a.patterns);
    expect(await duplicateProject('nope', 'x')).toBeNull();
  });

  it('delete removes the project and only its unreferenced samples', async () => {
    const mk = async () => saveSample('s', { l: new Float32Array(100).fill(0.1), rate: 44100 }, 'file');
    const shared = await mk();
    const own = await mk();
    const a = withSample({ ...defaultProject(), name: 'A' }, shared);
    const b = { ...withSample({ ...defaultProject(), name: 'B' }, own), sounds: withSample(defaultProject(), shared).sounds.map((s, i) => (i === 1 ? { ...s, sampleId: shared } : i === 0 ? { ...s, sampleId: own } : s)) };
    await saveProjectNow(a);
    await saveProjectNow(b);
    expect((await listSamples()).length).toBe(2);
    await deleteProject(b.id);
    expect((await listProjects()).map((x) => x.name)).toEqual(['A']);
    expect(await loadProject(b.id)).toBeNull();
    expect((await listSamples()).map((x) => x.id)).toEqual([shared]);
  });
});
