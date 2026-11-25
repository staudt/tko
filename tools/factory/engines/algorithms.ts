// The 32 DX7-style operator routings, written from the published algorithm diagrams
// (no code copied from other implementations). Operators are numbered 1..6 as on the DX7;
// every modulator has a higher number than the operator it feeds, so evaluating 6 -> 1
// gives each operator its modulators' current-sample output.
//
// Each entry: `mods` = [modulator, target] pairs, `carriers` = operators heard,
// `fb` = [source, destination] of the feedback path (usually an operator into itself;
// algorithms 4 and 6 feed a later operator's output back into the top of a stack).

export type Algorithm = {
  mods: ReadonlyArray<readonly [number, number]>;
  carriers: readonly number[];
  fb: readonly [number, number];
};

const A = (mods: [number, number][], carriers: number[], fb: [number, number]): Algorithm => ({ mods, carriers, fb });

export const ALGORITHMS: readonly Algorithm[] = [
  /* 1 */ A([[2, 1], [4, 3], [5, 4], [6, 5]], [1, 3], [6, 6]),
  /* 2 */ A([[2, 1], [4, 3], [5, 4], [6, 5]], [1, 3], [2, 2]),
  /* 3 */ A([[2, 1], [3, 2], [5, 4], [6, 5]], [1, 4], [6, 6]),
  /* 4 */ A([[2, 1], [3, 2], [5, 4], [6, 5]], [1, 4], [4, 6]),
  /* 5 */ A([[2, 1], [4, 3], [6, 5]], [1, 3, 5], [6, 6]),
  /* 6 */ A([[2, 1], [4, 3], [6, 5]], [1, 3, 5], [5, 6]),
  /* 7 */ A([[2, 1], [4, 3], [5, 3], [6, 5]], [1, 3], [6, 6]),
  /* 8 */ A([[2, 1], [4, 3], [5, 3], [6, 5]], [1, 3], [4, 4]),
  /* 9 */ A([[2, 1], [4, 3], [5, 3], [6, 5]], [1, 3], [2, 2]),
  /* 10 */ A([[2, 1], [3, 2], [5, 4], [6, 4]], [1, 4], [3, 3]),
  /* 11 */ A([[2, 1], [3, 2], [5, 4], [6, 4]], [1, 4], [6, 6]),
  /* 12 */ A([[2, 1], [4, 3], [5, 3], [6, 3]], [1, 3], [2, 2]),
  /* 13 */ A([[2, 1], [4, 3], [5, 3], [6, 3]], [1, 3], [6, 6]),
  /* 14 */ A([[2, 1], [4, 3], [5, 4], [6, 4]], [1, 3], [6, 6]),
  /* 15 */ A([[2, 1], [4, 3], [5, 4], [6, 4]], [1, 3], [2, 2]),
  /* 16 */ A([[2, 1], [3, 1], [4, 3], [5, 1], [6, 5]], [1], [6, 6]),
  /* 17 */ A([[2, 1], [3, 1], [4, 3], [5, 1], [6, 5]], [1], [2, 2]),
  /* 18 */ A([[2, 1], [3, 1], [4, 1], [5, 4], [6, 5]], [1], [3, 3]),
  /* 19 */ A([[2, 1], [3, 2], [6, 4], [6, 5]], [1, 4, 5], [6, 6]),
  /* 20 */ A([[3, 1], [3, 2], [5, 4], [6, 4]], [1, 2, 4], [3, 3]),
  /* 21 */ A([[3, 1], [3, 2], [6, 4], [6, 5]], [1, 2, 4, 5], [3, 3]),
  /* 22 */ A([[2, 1], [6, 3], [6, 4], [6, 5]], [1, 3, 4, 5], [6, 6]),
  /* 23 */ A([[3, 2], [6, 4], [6, 5]], [1, 2, 4, 5], [6, 6]),
  /* 24 */ A([[6, 3], [6, 4], [6, 5]], [1, 2, 3, 4, 5], [6, 6]),
  /* 25 */ A([[6, 4], [6, 5]], [1, 2, 3, 4, 5], [6, 6]),
  /* 26 */ A([[3, 2], [5, 4], [6, 4]], [1, 2, 4], [6, 6]),
  /* 27 */ A([[3, 2], [5, 4], [6, 4]], [1, 2, 4], [3, 3]),
  /* 28 */ A([[2, 1], [4, 3], [5, 4]], [1, 3, 6], [5, 5]),
  /* 29 */ A([[4, 3], [6, 5]], [1, 2, 3, 5], [6, 6]),
  /* 30 */ A([[4, 3], [5, 4]], [1, 2, 3, 6], [5, 5]),
  /* 31 */ A([[6, 5]], [1, 2, 3, 4, 5], [6, 6]),
  /* 32 */ A([], [1, 2, 3, 4, 5, 6], [6, 6]),
];

/** Bitmask (bit k = operator k+1) of operators that modulate each operator, per algorithm. */
export function modulatorMasks(alg: number): number[] {
  const a = ALGORITHMS[Math.min(32, Math.max(1, alg)) - 1]!;
  const masks = [0, 0, 0, 0, 0, 0];
  for (const [m, t] of a.mods) masks[t - 1]! |= 1 << (m - 1);
  return masks;
}

/** Human description of an operator's role in an algorithm, e.g. "modulator → OP1" or "carrier, heard". */
export function operatorRole(alg: number, op: number): string {
  const a = ALGORITHMS[Math.min(32, Math.max(1, alg)) - 1]!;
  const parts: string[] = [];
  if (a.carriers.includes(op)) parts.push('carrier, heard');
  const targets = a.mods.filter(([m]) => m === op).map(([, t]) => `OP${t}`);
  if (targets.length) parts.push(`modulator → ${targets.join(', ')}`);
  if (a.fb[1] === op) parts.push(a.fb[0] === op ? 'feedback' : `feedback from OP${a.fb[0]}`);
  return parts.join(', ');
}
