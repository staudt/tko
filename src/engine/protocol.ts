// Messages between the main thread (host.ts) and the engine (worklet / core.ts).
// Typed arrays in commands are copied by structured clone, except sample/resample buffers, which are transferred.

export const SOUNDS = 16;
export const KEYS = 16;
export const STEPS = 16;
export const PATTERNS = 16;
/** Steps per pattern × sounds: size of one pattern's per-step arrays (index = sound * STEPS + step). */
export const CELLS = SOUNDS * STEPS;
/** "No lock" value in lockA / lockB arrays. */
export const NO_LOCK = -128;
/** "No FX" value in fx lanes. */
export const NO_FX = -1;

export type SoundKind = 'melodic' | 'drum';

/** One pattern, packed. Index arrays by `sound * STEPS + step`. */
export type PackedPattern = {
  /** Bit k = key k sounds (melodic: semitone k above root; drum: slice k). */
  keys: Uint16Array;
  /** 0 = natural length; n = release after n steps (melodic). */
  len: Uint8Array;
  /** Pitch lock in semitones (-24..24), NO_LOCK = none. */
  lockA: Int8Array;
  /** Tone lock (-100..100: <0 low-pass, >0 high-pass), NO_LOCK = none. */
  lockB: Int8Array;
  /** Per step punch-in FX index, NO_FX = none. Length STEPS. */
  fx: Int8Array;
};

export type SoundParams = {
  index: number;
  kind: SoundKind;
  sampleId: string | null;
  /** Trim region, 0..1 of the sample (melodic). */
  start: number;
  end: number;
  /** Drum: 17 boundaries in 0..1 (slice k = slices[k]..slices[k+1]); melodic: []. */
  slices: number[];
  /** Semitones, -24..24. */
  pitch: number;
  /** -1..1: <0 low-pass, >0 high-pass, 0 = open. */
  tone: number;
  /** 0..1. */
  volume: number;
};

export type EngineCommand =
  | { type: 'transport'; playing: boolean }
  | { type: 'tempo'; bpm: number; swing: number }
  | { type: 'volume'; gain: number }
  | { type: 'pattern'; index: number; data: PackedPattern }
  /** Patterns to loop through in order. Applied at the end of the current pattern while playing (now = at once). */
  | { type: 'chain'; patterns: number[]; now?: boolean }
  | { type: 'sound'; params: SoundParams }
  | { type: 'sample'; id: string; l: Float32Array; rate: number }
  | { type: 'sampleFree'; id: string }
  /** Live pad: key 0..15. Melodic notes sound while held (on = false releases); drum slices play out. */
  | { type: 'play'; sound: number; key: number; on: boolean; vel?: number }
  /** Punch-in FX press/release (index into FX_IDS). */
  | { type: 'fx'; fx: number; on: boolean }
  | { type: 'fxKnob'; fx: number; x: number; y: number }
  /** Record the master output into `l` (transferred), starting at the next pattern start while playing, else now. */
  | { type: 'resample'; id: string; l: Float32Array }
  /** Release everything now (notes, FX). */
  | { type: 'panic' };

export type EngineEvent =
  /** step -1 = stopped. `time` = context time when the step is heard at the engine output. */
  | { type: 'step'; step: number; pattern: number; chainPos: number; time: number }
  /** ~30 Hz. `active` bit s = sound s triggered since the previous meters event. */
  | { type: 'meters'; master: number; active: number }
  | { type: 'resampled'; id: string; l: Float32Array };
