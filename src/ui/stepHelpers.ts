// Pure helpers for the step sequencer UI (names, lengths, chain text, lock mapping).
import type { Sound, StepData } from '../store/types';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI note number -> "C4" (60 = C4). */
export function noteName(midi: number): string {
  const m = Math.round(midi);
  return `${NOTES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** Lowest set key of a bitmask, or -1. */
export function lowestKey(keys: number): number {
  for (let k = 0; k < 16; k++) if (keys & (1 << k)) return k;
  return -1;
}

export function keyCount(keys: number): number {
  let n = 0;
  for (let k = 0; k < 16; k++) if (keys & (1 << k)) n++;
  return n;
}

/** Label of one key of a sound: note name (melodic) or hit name (drum). */
export function keyLabel(s: Sound | undefined, k: number): string {
  if (!s) return `${k + 1}`;
  if (s.kind === 'melodic') return noteName(s.root + k);
  return shortHit(s.hitNames?.[k]) || `${k + 1}`;
}

/** Hit names are shortened to fit a pad: first word, 5 characters. */
export function shortHit(n: string | undefined): string {
  if (!n) return '';
  return n.trim().split(/\s+/)[0]!.slice(0, 5);
}

/** Tiny label shown on a filled step pad. */
export function stepLabel(s: Sound | undefined, d: StepData): string {
  const k = lowestKey(d.keys);
  if (k < 0) return '';
  const base = keyLabel(s, k);
  return keyCount(d.keys) > 1 ? `${base}+` : base;
}

/** Length in steps for "hold step i, tap step j" (1..16). */
export function lenBetween(i: number, j: number): number {
  return (((j - i + 16) % 16) || 16);
}

/** "CHAIN 1-3-2" (1-based). */
export function chainText(chain: readonly number[]): string {
  return `CHAIN ${chain.map((x) => x + 1).join('-')}`;
}

export const hasExtras = (d: StepData): boolean => d.len !== undefined || d.lockA !== undefined || d.lockB !== undefined;

/** Lock A (pitch) is shown/edited as -12..+12 semitones. */
export const pitchToKnob = (semi: number): number => (Math.max(-12, Math.min(12, semi)) + 12) / 24;
export const knobToPitch = (v: number): number => Math.round(-12 + Math.min(1, Math.max(0, v)) * 24);
/** Lock B (tone) -100..100. */
export const toneToKnob = (t: number): number => (t + 100) / 200;
export const knobToTone = (v: number): number => {
  const x = Math.round((Math.min(1, Math.max(0, v)) * 2 - 1) * 100);
  return Math.abs(x) <= 2 ? 0 : x;
};
