// Live recording: turns pad hits into steps while armed and playing. One take = one undo step.
import { effect, signal } from '@preact/signals';
import { apply, project } from '../store/project';
import { addKey, setFxStep, setLen } from '../store/edit';
import { heldLength, quantizeHit } from '../store/record';
import { audibleStep, ctxTimeOfEvent, outputLatency, playing, positionAt } from '../engine/host';
import { recArmed } from './state';
import { onStep } from './stepTicker';
import { settings } from './settings';
import { lcdMessage } from '../lcd/message';

let takeN = 0;
let take: string | null = null;

effect(() => {
  if (!(recArmed.value && playing.value)) take = null;
});

/** Most recently recorded step (for the LCD flash; read from rAF). */
export const recFlash = { step: -1, pattern: -1, until: 0 };

type Hit = { sound: number; pattern: number; step: number; t: number; take: string; melodic: boolean };
const hits = new Map<number, Hit>();

export function recording(): boolean {
  return recArmed.peek() && playing.peek();
}

/** Where a press at DOM time `ts` lands (nearest step of the heard position), or null. */
function targetAt(ts: number): { step: number; pattern: number } | null {
  const heard = ctxTimeOfEvent(ts) - outputLatency() - settings.peek().offsetMs / 1000;
  let pos = positionAt(heard);
  if (!pos) {
    const a = audibleStep();
    if (!a) return null;
    pos = { step: a.step, frac: 0, pattern: a.pattern, chainPos: a.chainPos };
  }
  return quantizeHit(pos, project.peek().chain);
}

function currentTake(): string {
  if (!take) take = `rec:${++takeN}`;
  return take;
}

/** Record a live pad press. `ts` is the DOM event timeStamp. */
export function recordHit(pid: number, sound: number, key: number, ts: number): void {
  if (!recording()) return;
  const tgt = targetAt(ts);
  if (!tgt) return;
  const id = currentTake();
  apply((p) => addKey(p, tgt.pattern, sound, tgt.step, key), { merge: id });
  recFlash.step = tgt.step;
  recFlash.pattern = tgt.pattern;
  recFlash.until = performance.now() + 220;
  hits.set(pid, { sound, pattern: tgt.pattern, step: tgt.step, t: ts, take: id, melodic: project.peek().sounds[sound]?.kind === 'melodic' });
}

// ---- FX recording: FX + pad held while armed and playing writes the fx lane on every passed step.
const fxHeld = new Map<number, number>();

export function recordFxDown(pid: number, fx: number, ts: number): void {
  if (!recording()) return;
  fxHeld.set(pid, fx);
  const tgt = targetAt(ts);
  if (!tgt) return;
  apply((p) => setFxStep(p, tgt.pattern, tgt.step, fx), { merge: currentTake() });
}

export function recordFxUp(pid: number): void {
  fxHeld.delete(pid);
}

onStep(({ step, pattern }) => {
  if (fxHeld.size && recording()) {
    const fx = [...fxHeld.values()].pop()!;
    apply((p) => setFxStep(p, pattern, step, fx), { merge: currentTake() });
  }
});

/** Pad released: set the note length of a melodic hit from how long it was held. */
export function recordRelease(pid: number): void {
  const h = hits.get(pid);
  hits.delete(pid);
  if (!h || !h.melodic) return;
  const stepDur = 60 / project.peek().bpm / 4;
  const len = heldLength((performance.now() - h.t) / 1000 / stepDur);
  if (len > 0) apply((p) => setLen(p, h.pattern, h.sound, h.step, len), { merge: h.take });
}

export function clearHits(): void {
  hits.clear();
  fxHeld.clear();
}

export function toggleArm(): void {
  recArmed.value = !recArmed.peek();
  lcdMessage(recArmed.peek() ? 'REC ARMED' : 'REC OFF');
}
