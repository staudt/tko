// Sample playback voice (adapted from groovebox sampler/voice.ts, same author).
// AUDIO THREAD CODE: no allocations after construction, no closures per block.
//
// Click-free rules: ~1 ms attack, release ramp on note-off, automatic fade over the last END_FADE_S
// before the region end, and a fast fade when a voice is stolen or choked.

const END_FADE_S = 0.003;
const STEAL_S = 0.005;
const ATTACK_S = 0.001;
const RELEASE_S = 0.06;

/** 4-point cubic Hermite interpolation of x at fractional index p (clamped to the buffer). */
function hermite(x: Float32Array, p: number): number {
  const n = x.length;
  const i = Math.floor(p);
  const f = p - i;
  const xm1 = x[i - 1 < 0 ? 0 : i - 1]!;
  const x0 = x[i < 0 ? 0 : i >= n ? n - 1 : i]!;
  const x1 = x[i + 1 >= n ? n - 1 : i + 1]!;
  const x2 = x[i + 2 >= n ? n - 1 : i + 2]!;
  const c = (x1 - xm1) * 0.5;
  const v = x0 - x1;
  const w = c + v;
  const a = w + v + (x2 - x0) * 0.5;
  const b = w + a;
  return ((a * f - b) * f + c) * f + x0;
}

export class SampleVoice {
  active = false;
  /** Held (live melodic note) or waiting for a sequenced release. */
  gate = false;
  live = false;
  sound = -1;
  key = -1;
  id = 0;
  age = 0;
  stealing = false;

  private readonly sr: number;
  private data: Float32Array | null = null;
  private pos = 0;
  private inc = 0;
  private to = 0;
  private gain = 0;
  private env = 0;
  private readonly atkInc: number;
  private readonly relK: number;
  private released = false;
  private steal = 1;
  private readonly stealInc: number;
  private fadeLen = 1;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    this.atkInc = 1 / Math.max(1, ATTACK_S * sampleRate);
    this.relK = Math.exp(-6.907755 / Math.max(1, RELEASE_S * sampleRate));
    this.stealInc = 1 / Math.max(1, STEAL_S * sampleRate);
  }

  /** Plays source frames [from, to) of `data` (recorded at `rate`) transposed by `semis`. */
  noteOn(data: Float32Array, rate: number, from: number, to: number, semis: number, vel: number, sound: number, key: number, id: number, live: boolean, age: number): void {
    if (data.length < 4) return;
    this.pos = Math.max(0, from);
    this.to = Math.min(data.length, Math.max(from + 2, to));
    this.inc = (rate / this.sr) * Math.pow(2, semis / 12);
    this.data = data;
    this.active = true;
    this.gate = true;
    this.live = live;
    this.sound = sound;
    this.key = key;
    this.id = id;
    this.age = age;
    this.stealing = false;
    this.steal = 1;
    this.released = false;
    this.gain = Math.pow(Math.min(127, Math.max(0, vel)) / 127, 1.5);
    this.env = 0;
    this.fadeLen = Math.max(1, END_FADE_S * rate);
  }

  /** Starts the release ramp. */
  release(): void {
    this.gate = false;
    this.released = true;
  }

  /** Fast fade-out (voice stolen or choked). */
  stealFade(): void {
    if (!this.active || this.stealing) return;
    this.stealing = true;
  }

  loudness(): number {
    return this.env * this.steal * this.gain;
  }

  /** Adds frames [from, to) into out. */
  render(out: Float32Array, from: number, to: number): void {
    const d = this.data;
    if (!this.active || !d) return;
    for (let i = from; i < to; i++) {
      const left = this.to - 1 - this.pos;
      if (left <= 0) {
        this.active = false;
        break;
      }
      if (this.released) {
        this.env *= this.relK;
        if (this.env < 1e-4) {
          this.active = false;
          break;
        }
      } else if (this.env < 1) this.env = Math.min(1, this.env + this.atkInc);
      let g = this.env * this.gain * Math.min(1, left / this.fadeLen);
      if (this.stealing) {
        this.steal -= this.stealInc;
        if (this.steal <= 0) {
          this.active = false;
          break;
        }
        g *= this.steal;
      }
      out[i]! += hermite(d, this.pos) * g;
      this.pos += this.inc;
    }
  }
}
