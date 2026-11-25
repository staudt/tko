// Live recording: turns pad hits into steps while armed and playing. One take = one undo step.
import { effect, signal } from '@preact/signals';
import { apply, project } from '../store/project';
import { addKey, setLen } from '../store/edit';
import { heldLength, quantizeHit } from '../store/record';
import { audibleStep, ctxTimeOfEvent, outputLatency, playing, positionAt } from '../engine/host';
import { recArmed } from './state';
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

/** Record a live pad press. `ts` is the DOM event timeStamp. */
export function recordHit(pid: number, sound: number, key: number, ts: number): void {
  if (!recording()) return;
  const heard = ctxTimeOfEvent(ts) - outputLatency() - settings.peek().offsetMs / 1000;
  let pos = positionAt(heard);
  if (!pos) {
    const a = audibleStep();
    if (!a) return;
    pos = { step: a.step, frac: 0, pattern: a.pattern, chainPos: a.chainPos };
  }
  const tgt = quantizeHit(pos, project.peek().chain);
  if (!take) take = `rec:${++takeN}`;
  const id = take;
  apply((p) => addKey(p, tgt.pattern, sound, tgt.step, key), { merge: id });
  recFlash.step = tgt.step;
  recFlash.pattern = tgt.pattern;
  recFlash.until = performance.now() + 220;
  hits.set(pid, { sound, pattern: tgt.pattern, step: tgt.step, t: ts, take: id, melodic: project.peek().sounds[sound]?.kind === 'melodic' });
}

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
}

export function toggleArm(): void {
  recArmed.value = !recArmed.peek();
  lcdMessage(recArmed.peek() ? 'REC ARMED' : 'REC OFF');
}
