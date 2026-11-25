import { PATTERNS, SOUNDS, STEPS } from '../engine/protocol';
import { SCHEMA_VERSION, type Pattern, type Project, type Sound } from './types';

export const FACTORY_PREFIX = 'factory:';

export function emptyPattern(): Pattern {
  return { lanes: Array.from({ length: SOUNDS }, () => new Array<null>(STEPS).fill(null)), fx: new Array<null>(STEPS).fill(null) };
}

export function emptySound(i: number): Sound {
  return { name: `Sound ${i + 1}`, kind: i < 8 ? 'melodic' : 'drum', sampleId: null, start: 0, end: 1, slices: [], pitch: 0, tone: 0, volume: 0.8, root: 60 };
}

export function defaultProject(): Project {
  return {
    id: `p${Date.now().toString(36)}`,
    name: 'Untitled',
    version: SCHEMA_VERSION,
    bpm: 120,
    swing: 50,
    volume: 0.8,
    scale: 'chromatic',
    key: 0,
    sounds: Array.from({ length: SOUNDS }, (_, i) => ({ ...emptySound(i), sampleId: `${FACTORY_PREFIX}${i}` })),
    patterns: Array.from({ length: PATTERNS }, emptyPattern),
    chain: [0],
  };
}
