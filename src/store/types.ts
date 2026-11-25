// Project model (main thread). Immutable: every edit makes new objects, so the engine sync and undo
// can compare by identity.
import type { SoundKind } from '../engine/protocol';

export const SCHEMA_VERSION = 1;

/** One step of one sound's lane. `keys` bit k = key k (melodic semitone / drum slice). */
export type StepData = { keys: number; len?: number; lockA?: number; lockB?: number };
/** 16 steps; null = empty. */
export type Lane = readonly (StepData | null)[];
export type Pattern = {
  /** One lane per sound (16). */
  lanes: readonly Lane[];
  /** Punch-in FX per step (index into FX_IDS) or null. */
  fx: readonly (number | null)[];
};

export type Sound = {
  name: string;
  kind: SoundKind;
  /** 'factory:<slot>' or a user sample id; null = empty slot. */
  sampleId: string | null;
  start: number;
  end: number;
  slices: readonly number[];
  /** Names of the 16 drum hits (factory kits), for pad labels. */
  hitNames?: readonly string[];
  pitch: number;
  /** -1..1 (<0 low-pass, >0 high-pass). */
  tone: number;
  volume: number;
  /** MIDI note of key 0 (display only). */
  root: number;
};

export type Project = {
  id: string;
  name: string;
  version: number;
  bpm: number;
  /** 50..75 %. */
  swing: number;
  /** Master volume 0..1. */
  volume: number;
  sounds: readonly Sound[];
  patterns: readonly Pattern[];
  /** Patterns played in order (at least one). */
  chain: readonly number[];
};
