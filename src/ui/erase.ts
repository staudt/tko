// ERASE button actions. One hold gesture (ERASE down .. up) = one undo step (`erase:N` merge key).
import { apply, project } from '../store/project';
import { clearLane, clearPattern, setPattern, setStep } from '../store/edit';
import type { Project } from '../store/types';
import { audibleStep, playing } from '../engine/host';
import { audPattern, editPattern, eraseFlash, selectedSound } from './state';
import { lcdMessage } from '../lcd/message';

let eraseN = 0;
let eraseId = 'erase:0';
const pad2 = (n: number) => String(n + 1).padStart(2, '0');

/** ERASE pressed: a new gesture (one undo step). */
export function eraseBegin(): void {
  eraseId = `erase:${++eraseN}`;
}
export const eraseMerge = () => ({ merge: eraseId });

/** Pattern an erase acts on: the audible one while playing, else the edit pattern. In render code pass `reactive`. */
export function targetPattern(reactive = false): number {
  if (reactive) return playing.value && audPattern.value >= 0 ? audPattern.value : editPattern.value;
  if (playing.peek()) {
    const a = audibleStep();
    if (a) return a.pattern;
  }
  return editPattern.peek();
}

export const clearFxLane = (p: Project, pat: number): Project => {
  const pt = p.patterns[pat];
  return !pt || pt.fx.every((f) => f === null) ? p : setPattern(p, pat, { ...pt, fx: new Array<null>(16).fill(null) });
};

let flashTimer: ReturnType<typeof setTimeout> | null = null;
function flash(k: number): void {
  eraseFlash.value = k;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (eraseFlash.value = -1), 260);
}

/** ERASE held + pad k (play mode): clear sound k from the target pattern. */
export function eraseSoundHeld(k: number): void {
  const pat = targetPattern();
  apply((p) => clearLane(p, pat, k), eraseMerge());
  flash(k);
  lcdMessage(`CLEAR S${pad2(k)} P${pad2(pat)}`);
}

/** ERASE held + step pad k (write mode): clear that step of the selected sound in the edit pattern. */
export function eraseStepHeld(k: number): void {
  const pat = editPattern.peek();
  const snd = selectedSound.peek();
  apply((p) => setStep(p, pat, snd, k, null), eraseMerge());
  flash(k);
  lcdMessage(`CLEAR STEP ${k + 1}`);
}

/** ERASE held + FX: clear the whole fx lane of the target pattern. */
export function eraseFxHeld(): void {
  const pat = targetPattern();
  apply((p) => clearFxLane(p, pat), eraseMerge());
  lcdMessage('CLEAR FX');
}

/** Live erase: clear the selected sound's step the playhead just reached. */
export function eraseLiveStep(pattern: number, step: number): void {
  apply((p) => setStep(p, pattern, selectedSound.peek(), step, null), eraseMerge());
  lcdMessage('ERASE', 600);
}

// ---- sheet actions (each its own undo step)
export function sheetClearSound(pat: number, snd: number): void {
  apply((p) => clearLane(p, pat, snd));
  lcdMessage(`CLEAR S${pad2(snd)} P${pad2(pat)}`);
}
export function sheetClearFx(pat: number): void {
  apply((p) => clearFxLane(p, pat));
  lcdMessage('CLEAR FX');
}
export function sheetClearPattern(pat: number): void {
  apply((p) => clearPattern(p, pat));
  lcdMessage(`CLEAR P${pad2(pat)}`);
}
export function sheetClearAll(): void {
  apply((p) => p.patterns.reduce((q, _x, i) => clearPattern(q, i), p));
  lcdMessage('CLEAR ALL');
}
export const soundName = (i: number): string => project.peek().sounds[i]?.name ?? `Sound ${i + 1}`;
