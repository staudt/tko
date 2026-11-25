// Sample store: factory slots (public/factory) plus, from phase 4, the user's samples (OPFS / IndexedDB).
import { loadFactory, type FactorySlot } from './factory';
import { FACTORY_PREFIX } from './defaults';
import { SAMPLES, run } from './persist';

export type Sample = { l: Float32Array; rate: number };
export type SampleMeta = { id: string; name: string; rate: number; frames: number; created: number; source: 'record' | 'file' | 'resample' };

// User samples: mono Float32 audio in OPFS (`samples/<id>.f32`) when OPFS + createWritable exist, otherwise
// in the IndexedDB record (`audio`). Metadata (SampleMeta) always lives in the IndexedDB 'samples' store.
type Rec = SampleMeta & { audio?: ArrayBuffer };

const cache = new Map<string, Sample>();

async function opfsDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (typeof FileSystemFileHandle === 'undefined' || !('createWritable' in FileSystemFileHandle.prototype)) return null;
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle('samples', { create: true });
  } catch {
    return null;
  }
}

const newId = (): string => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Saves a user sample (mono) and returns its new id (ids start with 'u'). */
export async function saveSample(name: string, s: Sample, source: SampleMeta['source']): Promise<string> {
  const id = newId();
  const meta: SampleMeta = { id, name: name.slice(0, 40) || 'Sample', rate: s.rate, frames: s.l.length, created: Date.now(), source };
  const bytes = s.l.buffer.slice(s.l.byteOffset, s.l.byteOffset + s.l.byteLength) as ArrayBuffer;
  const dir = await opfsDir();
  let inOpfs = false;
  if (dir) {
    try {
      const w = await (await dir.getFileHandle(`${id}.f32`, { create: true })).createWritable();
      await w.write(bytes);
      await w.close();
      inOpfs = true;
    } catch {
      await dir.removeEntry(`${id}.f32`).catch(() => undefined);
    }
  }
  const rec: Rec = inOpfs ? meta : { ...meta, audio: bytes };
  await run(SAMPLES, 'readwrite', (st) => st.put(rec));
  cache.set(id, { l: s.l.slice(), rate: s.rate });
  return id;
}

export async function deleteSample(id: string): Promise<void> {
  cache.delete(id);
  const dir = await opfsDir();
  if (dir) await dir.removeEntry(`${id}.f32`).catch(() => undefined);
  await run(SAMPLES, 'readwrite', (st) => st.delete(id));
}

export async function listSamples(): Promise<SampleMeta[]> {
  try {
    const all = await run(SAMPLES, 'readonly', (st) => st.getAll() as IDBRequest<Rec[]>);
    return all
      .map(({ audio: _audio, ...m }): SampleMeta => m)
      .sort((a, b) => b.created - a.created);
  } catch {
    return [];
  }
}

/** Decodes any browser-supported audio file to mono (channels averaged). */
export async function decodeFile(file: Blob): Promise<Sample> {
  const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await file.arrayBuffer());
  const ch = buf.numberOfChannels;
  const l = new Float32Array(buf.length);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < l.length; i++) l[i] = l[i]! + d[i]! / ch;
  }
  return { l, rate: buf.sampleRate };
}

/** Seconds of audio used by these sample ids (user samples only; factory ones count 0). */
export async function secondsUsed(ids: readonly (string | null)[]): Promise<number> {
  const distinct = new Set<string>();
  for (const id of ids) if (id && id.startsWith('u')) distinct.add(id);
  if (!distinct.size) return 0;
  let total = 0;
  for (const m of await listSamples()) if (distinct.has(m.id)) total += m.frames / m.rate;
  return total;
}
export const MAX_SLOT_SECONDS = 12;
export const MAX_TOTAL_SECONDS = 180;

async function loadUser(id: string): Promise<Sample | null> {
  try {
    const m = await run(SAMPLES, 'readonly', (st) => st.get(id) as IDBRequest<Rec | undefined>);
    if (!m) return null;
    let buf = m.audio;
    if (!buf) {
      const dir = await opfsDir();
      if (!dir) return null;
      buf = await (await (await dir.getFileHandle(`${id}.f32`)).getFile()).arrayBuffer();
    }
    return { l: new Float32Array(buf.slice(0, m.frames * 4)), rate: m.rate };
  } catch {
    return null;
  }
}

/** Loads a sample by id. Resolves null if it does not exist. */
export async function getSample(id: string): Promise<Sample | null> {
  if (id.startsWith(FACTORY_PREFIX)) {
    const slot = Number(id.slice(FACTORY_PREFIX.length));
    const f = (await loadFactory()).find((s) => s.slot === slot);
    return f ? { l: f.l, rate: f.rate } : null;
  }
  if (id.startsWith('u')) {
    const hit = cache.get(id);
    if (hit) return hit;
    const s = await loadUser(id);
    if (s) cache.set(id, s);
    return s;
  }
  return null;
}

export function factorySlots(): Promise<FactorySlot[]> {
  return loadFactory();
}
