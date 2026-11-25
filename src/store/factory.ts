// Loads the factory sounds (public/factory/) in the browser: fetch the manifest, decode every MP3
// and assemble one compact mono buffer per slot (see src/dsp/onset.ts).
import { assembleSlot, type SlotEntry } from '../dsp/onset';

export type FactorySlot = {
  slot: number;
  name: string;
  kind: 'melodic' | 'drum';
  root: number;
  l: Float32Array;
  rate: number;
  /** Drums: 17 normalized boundaries (slices[k]..slices[k+1] = hit k). Melodic: []. */
  slices: number[];
  hitNames: string[];
};

type ManifestSlot = {
  slot: number;
  name: string;
  kind: 'melodic' | 'drum';
  file: string;
  root: number;
  start?: number;
  duration?: number;
  hits?: { name: string; start: number; duration: number }[];
};
type Manifest = { version: number; sampleRate: number; slots: ManifestSlot[] };

let cached: { base: string; promise: Promise<FactorySlot[]> } | null = null;

export function loadFactory(base = './factory/'): Promise<FactorySlot[]> {
  if (cached && cached.base === base) return cached.promise;
  const promise = load(base).catch((e) => {
    if (cached?.promise === promise) cached = null;
    throw e;
  });
  cached = { base, promise };
  return promise;
}

async function load(base: string): Promise<FactorySlot[]> {
  const res = await fetch(`${base}factory.json`);
  if (!res.ok) throw new Error(`factory.json: HTTP ${res.status}`);
  const manifest = (await res.json()) as Manifest;
  const ctx = new OfflineAudioContext(1, 1, manifest.sampleRate);
  const slots = await Promise.all(
    manifest.slots.map(async (m): Promise<FactorySlot> => {
      const r = await fetch(`${base}${m.file}`);
      if (!r.ok) throw new Error(`${m.file}: HTTP ${r.status}`);
      const buf = await ctx.decodeAudioData(await r.arrayBuffer());
      const entry: SlotEntry =
        m.kind === 'melodic' ? { kind: 'melodic', start: m.start ?? 0, duration: m.duration ?? buf.duration } : { kind: 'drum', hits: m.hits ?? [] };
      const { l, slices } = assembleSlot(buf.getChannelData(0), buf.sampleRate, entry);
      return {
        slot: m.slot,
        name: m.name,
        kind: m.kind,
        root: m.root,
        l,
        rate: buf.sampleRate,
        slices,
        hitNames: (m.hits ?? []).map((h) => h.name),
      };
    }),
  );
  return slots.sort((a, b) => a.slot - b.slot);
}
