// Tempo-synced stereo ping-pong delay with damping in the loop.
// AUDIO THREAD CODE: no allocations after construction.
import { Svf } from '../dsp';

const MAX_S = 2.5;

export class PingPongDelay {
  private readonly sr: number;
  private readonly bufL: Float32Array;
  private readonly bufR: Float32Array;
  private w = 0;
  /** Delay time in samples: target and a slewed current value (glides instead of clicking). */
  private target = 0;
  private cur = 0;
  feedback = 0.45;
  private targetFb = 0.45;
  private readonly lpL = new Svf();
  private readonly lpR = new Svf();
  private readonly hpL = new Svf();
  private readonly hpR = new Svf();
  /** Frames left before the echoes are considered gone; the delay sleeps at 0. */
  private awake = 0;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    const n = Math.ceil(MAX_S * sampleRate) + 4;
    this.bufL = new Float32Array(n);
    this.bufR = new Float32Array(n);
    this.lpL.set(4500, 0.5, sampleRate);
    this.lpR.set(4500, 0.5, sampleRate);
    this.hpL.set(140, 0.5, sampleRate);
    this.hpR.set(140, 0.5, sampleRate);
    this.setTime(0.375, true);
  }

  setTime(seconds: number, immediate = false): void {
    this.target = Math.min(MAX_S, Math.max(0.01, seconds)) * this.sr;
    if (immediate) this.cur = this.target;
  }

  setFeedback(fb: number): void {
    this.targetFb = Math.min(0.9, Math.max(0, fb));
  }

  private read(buf: Float32Array, d: number): number {
    const n = buf.length;
    let p = this.w - d;
    while (p < 0) p += n;
    const i = p | 0;
    const f = p - i;
    const a = buf[i]!;
    const b = buf[i + 1 === n ? 0 : i + 1]!;
    return a + (b - a) * f;
  }

  /** Mono in, adds stereo wet into outL/outR. Left echo first, then right, alternating. */
  process(input: Float32Array, outL: Float32Array, outR: Float32Array, frames: number): void {
    let loud = false;
    for (let s = 0; s < frames; s++) {
      if (input[s]! > 1e-5 || input[s]! < -1e-5) {
        loud = true;
        break;
      }
    }
    // Echoes fall 100 dB after log(1e-5)/log(fb) repeats of the delay time.
    if (loud) this.awake = Math.ceil((MAX_S + this.cur / this.sr) * Math.min(40, Math.log(1e-5) / Math.log(Math.max(0.05, Math.max(this.feedback, this.targetFb)))) * this.sr / MAX_S);
    if (this.awake <= 0) {
      this.cur = this.target; // no glide needed while silent
      return;
    }
    this.awake -= frames;
    if (this.awake <= 0) {
      this.bufL.fill(0);
      this.bufR.fill(0);
      return;
    }
    const n = this.bufL.length;
    // Time changes glide at most SLEW samples of delay per sample (a short tape-like pitch bend, no click).
    const SLEW = 0.2;
    for (let s = 0; s < frames; s++) {
      const diff = this.target - this.cur;
      if (diff !== 0) this.cur = Math.abs(diff) <= SLEW ? this.target : this.cur + (diff > 0 ? SLEW : -SLEW);
      this.feedback += (this.targetFb - this.feedback) * 0.001;
      const dl = this.read(this.bufL, this.cur);
      const dr = this.read(this.bufR, this.cur);
      this.lpL.tick(dl);
      this.hpL.tick(this.lpL.low);
      this.lpR.tick(dr);
      this.hpR.tick(this.lpR.low);
      const yl = this.hpL.high;
      const yr = this.hpR.high;
      this.bufL[this.w] = input[s]! + yr * this.feedback;
      this.bufR[this.w] = yl * this.feedback;
      this.w = this.w + 1 === n ? 0 : this.w + 1;
      outL[s]! += yl;
      outR[s]! += yr;
    }
    this.lpL.flush();
    this.lpR.flush();
    this.hpL.flush();
    this.hpR.flush();
  }
}
