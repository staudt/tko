// Stereo reverb: 8-line feedback delay network with Hadamard mixing and damping.
// Written for this project (no third-party code). AUDIO THREAD CODE: no allocations after construction.
//
// Sleeps (skips all work) while its input is silent and the tail has decayed below -100 dB.

const BASE_LENGTHS = [1031, 1327, 1523, 1801, 2063, 2357, 2633, 2909]; // samples at 48 kHz, mutually prime
const N = 8;
const PRE_DELAY_S = 0.02;
const SILENT = 1e-5;

export class Reverb {
  private readonly sr: number;
  /** All 8 delay lines in one buffer: line i occupies [off[i], off[i] + len[i]). */
  private readonly mem: Float32Array;
  private readonly off = new Int32Array(N);
  private readonly len = new Int32Array(N);
  private readonly pos = new Int32Array(N);
  private readonly lp = new Float64Array(N);
  private readonly fb = new Float64Array(N);
  private readonly pre: Float32Array;
  private preW = 0;
  private decayS = 0;
  private damp = 0.35;
  private targetDecay = 2.2;
  /** Frames left before the tail is considered gone (after the last non-silent input). */
  private awake = 0;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    const scale = sampleRate / 48000;
    let total = 0;
    for (let i = 0; i < N; i++) {
      this.len[i] = Math.max(16, Math.round(BASE_LENGTHS[i]! * scale));
      this.off[i] = total;
      total += this.len[i]!;
    }
    this.mem = new Float32Array(total);
    this.pre = new Float32Array(Math.max(1, Math.round(PRE_DELAY_S * sampleRate)));
    this.setDecay(2.2, true);
  }

  /** RT60 in seconds (0.3..10). Only feedback gains change, so this never clicks. */
  setDecay(seconds: number, immediate = false): void {
    this.targetDecay = Math.min(10, Math.max(0.3, seconds));
    if (immediate) this.applyDecay(this.targetDecay);
  }

  private applyDecay(rt60: number): void {
    this.decayS = rt60;
    for (let i = 0; i < N; i++) this.fb[i] = Math.pow(10, (-3 * this.len[i]!) / (rt60 * this.sr));
  }

  /** Mono in, adds stereo wet into outL/outR. */
  process(input: Float32Array, outL: Float32Array, outR: Float32Array, frames: number): void {
    let loud = false;
    for (let s = 0; s < frames; s++) {
      if (input[s]! > SILENT || input[s]! < -SILENT) {
        loud = true;
        break;
      }
    }
    if (loud) this.awake = Math.ceil((this.targetDecay * 5 / 3 + PRE_DELAY_S) * this.sr); // ~-100 dB
    if (this.awake <= 0) return;
    this.awake -= frames;
    if (this.awake <= 0) {
      // Tail is gone: clear state so waking up later starts clean.
      this.mem.fill(0);
      this.pre.fill(0);
      this.lp.fill(0);
      return;
    }
    if (Math.abs(this.decayS - this.targetDecay) > 1e-3) this.applyDecay(this.decayS + (this.targetDecay - this.decayS) * 0.05);

    const mem = this.mem;
    const off = this.off;
    const len = this.len;
    const pos = this.pos;
    const lp = this.lp;
    const fb = this.fb;
    const pre = this.pre;
    const preN = pre.length;
    const d = 1 - this.damp;
    const g = 1 / Math.sqrt(N);
    for (let s = 0; s < frames; s++) {
      const x = pre[this.preW]! * 0.5;
      pre[this.preW] = input[s]!;
      this.preW = this.preW + 1 === preN ? 0 : this.preW + 1;
      // Read and damp the 8 line outputs.
      const p0 = off[0]! + pos[0]!, p1 = off[1]! + pos[1]!, p2 = off[2]! + pos[2]!, p3 = off[3]! + pos[3]!;
      const p4 = off[4]! + pos[4]!, p5 = off[5]! + pos[5]!, p6 = off[6]! + pos[6]!, p7 = off[7]! + pos[7]!;
      const v0 = (lp[0] = lp[0]! + (mem[p0]! - lp[0]!) * d);
      const v1 = (lp[1] = lp[1]! + (mem[p1]! - lp[1]!) * d);
      const v2 = (lp[2] = lp[2]! + (mem[p2]! - lp[2]!) * d);
      const v3 = (lp[3] = lp[3]! + (mem[p3]! - lp[3]!) * d);
      const v4 = (lp[4] = lp[4]! + (mem[p4]! - lp[4]!) * d);
      const v5 = (lp[5] = lp[5]! + (mem[p5]! - lp[5]!) * d);
      const v6 = (lp[6] = lp[6]! + (mem[p6]! - lp[6]!) * d);
      const v7 = (lp[7] = lp[7]! + (mem[p7]! - lp[7]!) * d);
      outL[s]! += (v0 - v2 + v4 - v6) * 0.5;
      outR[s]! += (v1 - v3 + v5 - v7) * 0.5;
      // 8-point Walsh-Hadamard transform, unrolled.
      const a0 = v0 + v1, a1 = v0 - v1, a2 = v2 + v3, a3 = v2 - v3, a4 = v4 + v5, a5 = v4 - v5, a6 = v6 + v7, a7 = v6 - v7;
      const b0 = a0 + a2, b2 = a0 - a2, b1 = a1 + a3, b3 = a1 - a3, b4 = a4 + a6, b6 = a4 - a6, b5 = a5 + a7, b7 = a5 - a7;
      mem[p0] = ((b0 + b4) * g + x) * fb[0]!;
      mem[p1] = ((b1 + b5) * g - x) * fb[1]!;
      mem[p2] = ((b2 + b6) * g + x) * fb[2]!;
      mem[p3] = ((b3 + b7) * g - x) * fb[3]!;
      mem[p4] = ((b0 - b4) * g + x) * fb[4]!;
      mem[p5] = ((b1 - b5) * g - x) * fb[5]!;
      mem[p6] = ((b2 - b6) * g + x) * fb[6]!;
      mem[p7] = ((b3 - b7) * g - x) * fb[7]!;
      for (let i = 0; i < N; i++) pos[i] = pos[i]! + 1 === len[i]! ? 0 : pos[i]! + 1;
    }
    for (let i = 0; i < N; i++) if (Math.abs(lp[i]!) < 1e-20) lp[i] = 0;
  }
}
