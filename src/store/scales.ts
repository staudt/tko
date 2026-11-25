// Scales for melodic sounds: key k (0..15) plays scale degree k above the root, wrapping into
// higher octaves. Chromatic = one semitone per key.
export const SCALES = {
  chromatic: { name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  major: { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  majPent: { name: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  minPent: { name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
} as const;
export type ScaleId = keyof typeof SCALES;
export const SCALE_IDS = Object.keys(SCALES) as ScaleId[];
export const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export const isScaleId = (x: unknown): x is ScaleId => typeof x === 'string' && x in SCALES;

/** Semitone offset of each of the 16 keys. */
export function scaleOffsets(id: ScaleId): number[] {
  const st = SCALES[id].steps;
  return Array.from({ length: 16 }, (_, k) => st[k % st.length]! + 12 * Math.floor(k / st.length));
}
