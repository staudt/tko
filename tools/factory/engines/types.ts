// Minimal type defs copied from groovebox/src/store/types.ts (build-time only).
export type DrumModel = 'kick' | 'snare' | 'hat' | 'perc';

export type FmOperator = {
  ratio: number;
  detune: number;
  level: number;
  a: number;
  d: number;
  s: number;
  r: number;
  velSens: number;
};

export type FmPatch = {
  kind: 'fm';
  name: string;
  algorithm: number;
  feedback: number;
  ops: [FmOperator, FmOperator, FmOperator, FmOperator, FmOperator, FmOperator];
};
