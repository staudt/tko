// Factory FM patches, authored for this app (not taken from DX7 ROM banks), plus init and random.
import type { FmOperator, FmPatch } from './types';

const op = (ratio: number, level: number, a: number, d: number, s: number, r: number, velSens = 2, detune = 0): FmOperator => ({
  ratio,
  detune,
  level,
  a,
  d,
  s,
  r,
  velSens,
});
const off = (): FmOperator => op(1, 0, 0, 0.5, 1, 0.3, 0);

type Ops = FmPatch['ops'];
const patch = (name: string, algorithm: number, feedback: number, ops: Ops): FmPatch => ({ kind: 'fm', name, algorithm, feedback, ops });

export function initPatch(): FmPatch {
  return patch('Init', 1, 0, [op(1, 99, 0, 0.5, 1, 0.3, 2), off(), off(), off(), off(), off()]);
}

export const FM_PRESETS: readonly FmPatch[] = [
  patch('Round Bass', 5, 5, [
    op(1, 99, 0, 0.45, 0.55, 0.2, 2),
    op(1, 78, 0, 0.3, 0.2, 0.2, 4),
    op(1, 84, 0, 0.45, 0.55, 0.2, 2, 2),
    op(3, 52, 0, 0.18, 0, 0.15, 5),
    op(0.5, 80, 0, 0.5, 0.6, 0.2, 1),
    op(0.5, 30, 0, 0.3, 0.2, 0.2, 3),
  ]),
  patch('Glass Keys', 5, 4, [
    op(1, 90, 0, 0.55, 0.35, 0.45, 3),
    op(3.5, 72, 0, 0.35, 0.15, 0.35, 5),
    op(2.01, 66, 0, 0.5, 0.3, 0.45, 3),
    op(1, 58, 0, 0.45, 0.3, 0.4, 4),
    op(0.5, 74, 0.05, 0.6, 0.5, 0.5, 2),
    op(7, 40, 0, 0.12, 0, 0.12, 6),
  ]),
  patch('Electric Piano', 5, 3, [
    op(1, 99, 0, 0.65, 0.3, 0.42, 3),
    op(14, 56, 0, 0.22, 0, 0.25, 6),
    op(1, 94, 0, 0.6, 0.35, 0.42, 3, 3),
    op(1, 74, 0, 0.5, 0.25, 0.4, 4),
    op(1, 82, 0, 0.6, 0.3, 0.42, 3, -3),
    op(1, 64, 0, 0.45, 0.2, 0.4, 4),
  ]),
  patch('Soft Pad', 5, 2, [
    op(1, 92, 0.55, 0.7, 0.8, 0.62, 1),
    op(1, 55, 0.6, 0.7, 0.7, 0.6, 1),
    op(1, 88, 0.58, 0.7, 0.8, 0.64, 1, 5),
    op(2, 48, 0.6, 0.7, 0.6, 0.6, 1),
    op(2, 74, 0.6, 0.7, 0.8, 0.64, 1, -4),
    op(3, 38, 0.62, 0.7, 0.6, 0.6, 1),
  ]),
  patch('Brass', 22, 6, [
    op(1, 97, 0.28, 0.5, 0.75, 0.3, 3),
    op(1, 82, 0.32, 0.5, 0.7, 0.3, 4),
    op(1, 88, 0.28, 0.5, 0.75, 0.3, 3, 4),
    op(1, 86, 0.28, 0.5, 0.75, 0.3, 3, -4),
    op(2, 70, 0.28, 0.5, 0.75, 0.3, 3),
    op(1, 76, 0.34, 0.5, 0.65, 0.3, 4),
  ]),
  patch('Pluck Lead', 2, 6, [op(1, 99, 0, 0.42, 0.45, 0.3, 3), op(1, 86, 0, 0.35, 0.3, 0.3, 4), off(), off(), off(), off()]),
  patch('Bell', 5, 0, [
    op(1, 96, 0, 0.78, 0, 0.62, 3),
    op(3.5, 74, 0, 0.66, 0, 0.55, 4),
    op(1, 84, 0, 0.74, 0, 0.6, 3, 4),
    op(1.41, 62, 0, 0.62, 0, 0.55, 4),
    op(2, 70, 0, 0.7, 0, 0.6, 3),
    op(5.19, 50, 0, 0.5, 0, 0.5, 4),
  ]),
  patch('Marimba', 5, 0, [
    op(1, 99, 0, 0.42, 0, 0.4, 4),
    op(4, 70, 0, 0.18, 0, 0.18, 6),
    op(4, 66, 0, 0.3, 0, 0.3, 4),
    op(10, 42, 0, 0.12, 0, 0.12, 6),
    off(),
    off(),
  ]),
  patch('Sub Bass', 1, 0, [op(1, 99, 0, 0.5, 0.7, 0.18, 1), op(1, 58, 0, 0.25, 0.1, 0.18, 3), off(), off(), off(), off()]),
];

export const presetByName = (name: string): FmPatch => structuredClone(FM_PRESETS.find((p) => p.name === name) ?? initPatch());

/** A random but playable patch: carriers loud, modulators moderate, musical ratios. `rand` is injectable for tests. */
export function randomPatch(rand: () => number = Math.random, carriersOf?: (alg: number) => readonly number[]): FmPatch {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const algorithm = 1 + Math.floor(rand() * 32);
  const carriers = carriersOf?.(algorithm) ?? [1];
  const ratios = [0.5, 1, 1, 1, 2, 2, 3, 4, 5, 7, 1.41, 3.5];
  const slow = rand() < 0.3;
  const ops = Array.from({ length: 6 }, (_, i) => {
    const isCarrier = carriers.includes(i + 1);
    return op(
      isCarrier ? pick([0.5, 1, 1, 1, 2]) : pick(ratios),
      isCarrier ? 80 + Math.round(rand() * 19) : 30 + Math.round(rand() * 50),
      slow ? 0.3 + rand() * 0.4 : rand() * 0.15,
      0.2 + rand() * 0.6,
      rand(),
      0.15 + rand() * 0.5,
      Math.round(rand() * 5),
      Math.round((rand() - 0.5) * 6),
    );
  }) as Ops;
  return patch('Random', algorithm, Math.floor(rand() * 7), ops);
}
