// UI-only state (what is selected / held). The project itself lives in src/store.
import { computed, signal } from '@preact/signals';

export const selectedSound = signal(0);
/** Ids of controls currently held by a finger ('pad:3', 'fn:sound', 'btn:fx', ...). */
export const heldControls = signal<ReadonlySet<string>>(new Set());
/** The FX pad (index) being held together with FX, else null. */
export const fxPad = signal<number | null>(null);
/** X/Y of the held FX (0..1), driven by the knobs. */
export const fxXY = signal<[number, number]>([0.5, 0.5]);
export const soundSheetOpen = signal(false);
export const locked = signal(false);
/** REC armed: pad presses are recorded into the pattern while playing. */
export const recArmed = signal(false);
export const settingsOpen = signal(false);

/** Write mode: the 16 pads are the steps of the selected sound's lane in `editPattern`. */
export const writeMode = signal(false);
export const editPattern = signal(0);
/** Step pad (0..15) held in write mode (earliest still down), else null. */
export const heldStep = signal<number | null>(null);
/**
 * The key each sound writes into new steps (default 0): the last key played live, chosen with
 * WRITE + pad, or added in the step sheet. Remembered across reloads. Plain array + version signal.
 */
const LAST_KEY_STORAGE = 'tko.lastKey';
export const lastKey: number[] = loadLastKeys();
export const lastKeyVer = signal(0);
export function setLastKey(sound: number, key: number): void {
  if (lastKey[sound] === key) return;
  lastKey[sound] = key;
  lastKeyVer.value++;
  try {
    localStorage.setItem(LAST_KEY_STORAGE, JSON.stringify(lastKey));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}
function loadLastKeys(): number[] {
  const out = new Array<number>(16).fill(0);
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(LAST_KEY_STORAGE) ?? 'null');
    if (Array.isArray(raw)) raw.slice(0, 16).forEach((k, i) => Number.isInteger(k) && k >= 0 && k < 16 && (out[i] = k as number));
  } catch {
    /* ignore */
  }
  return out;
}
/** Pads pressed (in order) while PATTERN is held: the chain being built. */
export const chainDraft = signal<readonly number[]>([]);
/** Pattern queued to start after the current one ends (while playing), else null. */
export const queuedPattern = signal<number | null>(null);
/** Audible pattern while playing (rAF-updated, only on change), else -1. */
export const audPattern = signal(-1);
export const audChainPos = signal(0);
export const patternSheetOpen = signal(false);
export const bpmSheetOpen = signal(false);
export const eraseSheetOpen = signal(false);
/** Pad (0..15) that just got erased (brief coral flash), else -1. */
export const eraseFlash = signal(-1);
/** Step whose sheet is open (null = closed). */
export const stepSheet = signal<number | null>(null);

export type KnobMode = 'default' | 'trim' | 'bpm' | 'fx' | 'lock';
export const knobMode = computed<KnobMode>(() => {
  const h = heldControls.value;
  if (fxPad.value !== null) return 'fx';
  if (h.has('fn:bpm')) return 'bpm';
  if (h.has('fn:sound')) return 'trim';
  if (writeMode.value && heldStep.value !== null && !h.has('fn:pattern')) return 'lock';
  return 'default';
});
