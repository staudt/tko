// One rAF watcher on the audible playhead: subscribers are called whenever the heard step changes
// (live erase, FX recording). UI thread only; the clock itself lives in the worklet.
import { audibleStep, playing } from '../engine/host';

export type StepTick = { step: number; pattern: number; chainPos: number };
type Listener = (t: StepTick) => void;

const listeners = new Set<Listener>();
let raf = 0;
let lastKey = -1;

function frame(): void {
  raf = requestAnimationFrame(frame);
  if (!playing.peek()) {
    lastKey = -1;
    return;
  }
  const a = audibleStep();
  if (!a) return;
  const key = (a.chainPos * 16 + a.step) * 16 + a.pattern;
  if (key === lastKey) return;
  lastKey = key;
  const t: StepTick = { step: a.step, pattern: a.pattern, chainPos: a.chainPos };
  for (const l of listeners) l(t);
}

/** Subscribe to heard-step changes; returns the unsubscribe function. */
export function onStep(l: Listener): () => void {
  listeners.add(l);
  if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame);
  return () => {
    listeners.delete(l);
    if (!listeners.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      lastKey = -1;
    }
  };
}
