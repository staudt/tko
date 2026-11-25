// Punch-in effects: ids, labels and XY parameter names (shared by the engine and the UI).
// Labels and XY names follow docs/design/FX.dc.html.

export const FX_IDS = [
  'stutter4',
  'stutter8',
  'stutter16',
  'stutter32',
  'tapeStop',
  'lowSweep',
  'highSweep',
  'lofi',
  'gate',
  'reverse',
  'reverbThrow',
  'delayThrow',
  // Appended later (recorded patterns store indices): never reorder the ones above.
  'stutter8T',
  'scratch',
  'octave',
  'wobble',
] as const;
export type FxId = (typeof FX_IDS)[number];

export type FxDef = { id: FxId; label: string; sub: string; x: string; y: string; /** starts on the next 1/16 when playing */ snaps: boolean };

export const FX_DEFS: readonly FxDef[] = [
  { id: 'stutter4', label: 'Stutter', sub: '1/4', x: 'length', y: 'feedback', snaps: true },
  { id: 'stutter8', label: 'Stutter', sub: '1/8', x: 'length', y: 'feedback', snaps: true },
  { id: 'stutter16', label: 'Stutter', sub: '1/16', x: 'length', y: 'feedback', snaps: true },
  { id: 'stutter32', label: 'Stutter', sub: '1/32', x: 'length', y: 'feedback', snaps: true },
  { id: 'tapeStop', label: 'Tape stop', sub: 'slow', x: 'speed', y: 'pitch', snaps: false },
  { id: 'lowSweep', label: 'LP sweep', sub: 'filter', x: 'cutoff', y: 'resonance', snaps: false },
  { id: 'highSweep', label: 'HP sweep', sub: 'filter', x: 'cutoff', y: 'resonance', snaps: false },
  { id: 'lofi', label: 'Lo-fi', sub: 'crush', x: 'bits', y: 'rate', snaps: false },
  { id: 'gate', label: 'Gate', sub: '1/16', x: 'rate', y: 'depth', snaps: true },
  { id: 'reverse', label: 'Reverse', sub: '1 beat', x: 'length', y: 'mix', snaps: true },
  { id: 'reverbThrow', label: 'Reverb', sub: 'throw', x: 'size', y: 'mix', snaps: false },
  { id: 'delayThrow', label: 'Delay', sub: 'throw', x: 'time', y: 'feedback', snaps: false },
  { id: 'stutter8T', label: 'Stutter', sub: '1/8T', x: 'length', y: 'feedback', snaps: true },
  { id: 'scratch', label: 'Scratch', sub: 'vinyl', x: 'speed', y: 'depth', snaps: true },
  { id: 'octave', label: 'Octave', sub: '±12', x: 'down/up', y: 'mix', snaps: false },
  { id: 'wobble', label: 'Wobble', sub: 'LFO', x: 'rate', y: 'depth', snaps: true },
];

export const fxIndex = (id: FxId): number => FX_IDS.indexOf(id);

/** Default XY position (0..1) for each effect when pressed. */
export const FX_DEFAULT_XY: Record<FxId, [number, number]> = {
  stutter4: [0, 0],
  stutter8: [0, 0],
  stutter16: [0, 0],
  stutter32: [0, 0],
  tapeStop: [0.5, 0.5],
  lowSweep: [0.6, 0.3],
  highSweep: [0.6, 0.3],
  lofi: [0.6, 0.4],
  gate: [0.5, 1],
  reverse: [0, 1],
  reverbThrow: [0.6, 0.7],
  delayThrow: [0.5, 0.5],
  stutter8T: [0, 0],
  scratch: [0.3, 0.6],
  octave: [1, 1],
  wobble: [0.33, 0.7],
};
