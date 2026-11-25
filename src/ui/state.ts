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

export type KnobMode = 'default' | 'trim' | 'bpm' | 'fx';
export const knobMode = computed<KnobMode>(() => {
  const h = heldControls.value;
  if (fxPad.value !== null) return 'fx';
  if (h.has('fn:bpm')) return 'bpm';
  if (h.has('fn:sound')) return 'trim';
  return 'default';
});
