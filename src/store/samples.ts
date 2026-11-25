// Sample store: factory slots (public/factory) plus, from phase 4, the user's samples (OPFS / IndexedDB).
import { loadFactory, type FactorySlot } from './factory';
import { FACTORY_PREFIX } from './defaults';

export type Sample = { l: Float32Array; rate: number };

/** Loads a sample by id. Resolves null if it does not exist. */
export async function getSample(id: string): Promise<Sample | null> {
  if (id.startsWith(FACTORY_PREFIX)) {
    const slot = Number(id.slice(FACTORY_PREFIX.length));
    const f = (await loadFactory()).find((s) => s.slot === slot);
    return f ? { l: f.l, rate: f.rate } : null;
  }
  return null;
}

export function factorySlots(): Promise<FactorySlot[]> {
  return loadFactory();
}
