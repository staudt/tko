// User settings (timing). Persisted in localStorage 'tko.settings'; also keeps the engine metronome in sync.
import { effect, signal } from '@preact/signals';
import { audioReady, playing, setMetronome } from '../engine/host';
import { recArmed } from './state';

export type Settings = { offsetMs: number; metro: boolean; metroRec: boolean };
export const OFFSET_MIN = -50;
export const OFFSET_MAX = 250;
const KEY = 'tko.settings';
const DEFAULTS: Settings = { offsetMs: 0, metro: false, metroRec: true };

/** Clamp and sanitise parsed storage content (pure). */
export function sanitizeSettings(raw: unknown): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const off = typeof o.offsetMs === 'number' && Number.isFinite(o.offsetMs) ? Math.round(o.offsetMs) : DEFAULTS.offsetMs;
  return {
    offsetMs: Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, off)),
    metro: typeof o.metro === 'boolean' ? o.metro : DEFAULTS.metro,
    metroRec: typeof o.metroRec === 'boolean' ? o.metroRec : DEFAULTS.metroRec,
  };
}

function load(): Settings {
  try {
    return sanitizeSettings(JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null'));
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = signal<Settings>(load());

export function setSettings(patch: Partial<Settings>): void {
  settings.value = sanitizeSettings({ ...settings.peek(), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(settings.peek()));
  } catch {
    /* storage unavailable */
  }
}

/** Metronome is on when always-on, or while recording (armed and playing) if that setting is on. */
export function metronomeWanted(s: Settings, armed: boolean, isPlaying: boolean): boolean {
  return s.metro || (s.metroRec && armed && isPlaying);
}

effect(() => {
  const ready = audioReady.value;
  const on = metronomeWanted(settings.value, recArmed.value, playing.value);
  if (ready) setMetronome(on);
});
