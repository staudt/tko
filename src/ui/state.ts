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

/** Write mode: the 16 pads are the steps of the selected sound's lane in `editPattern`. */
export const writeMode = signal(false);
export const editPattern = signal(0);
/** Step pad (0..15) held in write mode (earliest still down), else null. */
export const heldStep = signal<number | null>(null);
/** Last key played live per sound (default 0). Plain array + version signal. */
export const lastKey: number[] = new Array<number>(16).fill(0);
export const lastKeyVer = signal(0);
export function setLastKey(sound: number, key: number): void {
  if (lastKey[sound] === key) return;
  lastKey[sound] = key;
  lastKeyVer.value++;
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
