// Store pattern -> engine packed arrays.
import { CELLS, NO_FX, NO_LOCK, STEPS, type PackedPattern, type SoundParams } from '../engine/protocol';
import type { Pattern, Sound } from './types';

export function packPattern(p: Pattern): PackedPattern {
  const keys = new Uint16Array(CELLS);
  const len = new Uint8Array(CELLS);
  const lockA = new Int8Array(CELLS).fill(NO_LOCK);
  const lockB = new Int8Array(CELLS).fill(NO_LOCK);
  const fx = new Int8Array(STEPS).fill(NO_FX);
  p.lanes.forEach((lane, s) =>
    lane.forEach((st, j) => {
      if (!st || !st.keys) return;
      const i = s * STEPS + j;
      keys[i] = st.keys & 0xffff;
      len[i] = Math.max(0, Math.min(255, st.len ?? 0));
      if (st.lockA !== undefined) lockA[i] = Math.max(-24, Math.min(24, Math.round(st.lockA)));
      if (st.lockB !== undefined) lockB[i] = Math.max(-100, Math.min(100, Math.round(st.lockB)));
    }),
  );
  p.fx.forEach((f, j) => {
    if (f !== null && j < STEPS) fx[j] = f;
  });
  return { keys, len, lockA, lockB, fx };
}

export function soundParams(s: Sound, index: number): SoundParams {
  return { index, kind: s.kind, sampleId: s.sampleId, start: s.start, end: s.end, slices: [...s.slices], pitch: s.pitch, tone: s.tone, volume: s.volume };
}
