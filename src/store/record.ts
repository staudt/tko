// Live recording: where a pad hit lands in the pattern (pure, unit-tested).
import { STEPS } from '../engine/protocol';

/** Position heard at a moment: the step playing, how far into it (0..1+), and where in the chain. */
export type HeardPosition = { step: number; frac: number; pattern: number; chainPos: number };

/**
 * The step a hit belongs to: the nearest step. A hit in the second half of the last step of a
 * pattern lands on step 0 of the next pattern in the chain.
 */
export function quantizeHit(pos: HeardPosition, chain: readonly number[]): { pattern: number; step: number } {
  const x = pos.step + Math.max(0, pos.frac);
  let step = Math.round(x);
  let pattern = pos.pattern;
  if (step >= STEPS) {
    step -= STEPS;
    if (chain.length > 0) pattern = chain[(pos.chainPos + 1) % chain.length] ?? pattern;
  }
  return { pattern, step: step % STEPS };
}

/** Recorded melodic note length (in steps) from how long the pad was held; 0 = natural (short taps). */
export function heldLength(heldSteps: number): number {
  return heldSteps >= 1.5 ? Math.min(16, Math.round(heldSteps)) : 0;
}

/**
 * Tap-along calibration: given click times and the user's tap times (same clock, seconds), the
 * median offset in ms (positive = taps late). Each tap is matched to its nearest click; null if
 * fewer than 4 taps match within half a period.
 */
export function calibrationOffset(clicks: readonly number[], taps: readonly number[]): number | null {
  if (clicks.length < 2) return null;
  const period = (clicks[clicks.length - 1]! - clicks[0]!) / (clicks.length - 1);
  const diffs: number[] = [];
  for (const t of taps) {
    let best = Infinity;
    for (const c of clicks) if (Math.abs(t - c) < Math.abs(best)) best = t - c;
    if (Math.abs(best) < period / 2) diffs.push(best * 1000);
  }
  if (diffs.length < 4) return null;
  diffs.sort((a, b) => a - b);
  const m = diffs.length >> 1;
  return Math.round(diffs.length % 2 ? diffs[m]! : (diffs[m - 1]! + diffs[m]!) / 2);
}
