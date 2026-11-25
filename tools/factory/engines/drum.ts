// Synthesized drum voice: kick, snare, hat, perc models.
// AUDIO THREAD CODE: no allocations after construction, no closures per block.
//
// Click-free rules: every hit starts with a short linear attack ramp; a voice that is stolen
// fades out linearly over STEAL_MS; a voice ends only after its envelope is below -80 dB.
import type { DrumModel } from './types';
import { Noise, Svf, TWO_PI, decayCoef, expMap, semis, velGain } from './dsp';

const MODEL_KICK = 0;
const MODEL_SNARE = 1;
const MODEL_HAT = 2;
const MODEL_PERC = 3;
export const modelIndex = (m: DrumModel) => (m === 'kick' ? MODEL_KICK : m === 'snare' ? MODEL_SNARE : m === 'hat' ? MODEL_HAT : MODEL_PERC);

const ATTACK_MS = 0.5;
const STEAL_MS = 5;
const END_LEVEL = 1e-4;
// Classic six-square metallic cluster (Hz) for hats.
const HAT_FREQS = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];

/** Plain numeric params latched at trigger time (so editing never zippers a sounding hit). */
export class DrumSettings {
  model = MODEL_KICK;
  tune = 0;
  decay = 0.5;
  tone = 0.5;
}

export class DrumVoice {
  active = false;
  /** Current output envelope, used to pick the quietest voice to steal. */
  level = 0;

  private sr: number;
  private model = MODEL_KICK;
  private noise: Noise;
  private f1 = new Svf();
  private f2 = new Svf();

  private gain = 0;
  private atk = 0;
  private atkInc = 0;
  private steal = 1;
  private stealInc = 0;
  private stealing = false;

  // Envelopes (exponential, per-sample multipliers).
  private ampEnv = 0;
  private ampK = 0;
  private env2 = 0; // secondary: noise (snare), mod index (perc), click (kick)
  private env2K = 0;
  private pEnv = 0; // pitch envelope
  private pK = 0;

  private freq = 0;
  private pAmt = 0;
  private phase = 0;
  private phase2 = 0;
  private toneMix = 0;
  private hatPh = new Float64Array(6);
  private hatInc = new Float64Array(6);

  constructor(sampleRate: number, seed: number) {
    this.sr = sampleRate;
    this.noise = new Noise(seed);
  }

  trigger(s: DrumSettings, vel: number): void {
    const sr = this.sr;
    this.model = s.model;
    this.active = true;
    this.gain = velGain(vel);
    this.atk = 0;
    this.atkInc = 1 / Math.max(1, (ATTACK_MS / 1000) * sr);
    this.steal = 1;
    this.stealing = false;
    this.phase = 0;
    this.phase2 = 0;
    this.f1.reset();
    this.f2.reset();
    const t = semis(s.tune);
    const tone = s.tone;
    const d = s.decay;
    this.ampEnv = 1;
    this.pEnv = 1;
    this.env2 = 1;
    this.toneMix = tone;
    switch (s.model) {
      case MODEL_KICK:
        this.freq = 48 * t;
        this.pAmt = 2 + tone * 6;
        this.pK = decayCoef(0.03 + 0.05 * (1 - tone), sr);
        this.ampK = decayCoef(expMap(d, 0.12, 1.6), sr);
        this.env2K = decayCoef(0.006, sr);
        this.f1.set(expMap(tone, 1500, 6000), 0.7, sr);
        break;
      case MODEL_SNARE:
        this.freq = 185 * t;
        this.pAmt = 0.6;
        this.pK = decayCoef(0.04, sr);
        this.ampK = decayCoef(expMap(d, 0.08, 0.5), sr);
        this.env2K = decayCoef(expMap(d, 0.12, 0.9), sr);
        this.f1.set(expMap(tone, 900, 5000) * t, 0.6, sr); // noise high-pass
        this.f2.set(expMap(tone, 5000, 14000), 0.5, sr); // noise low-pass
        break;
      case MODEL_HAT:
        this.ampK = decayCoef(expMap(d, 0.03, 1.2), sr);
        for (let i = 0; i < 6; i++) {
          this.hatPh[i] = this.noise.unit();
          this.hatInc[i] = (HAT_FREQS[i]! * 1.6 * t) / sr;
        }
        this.f1.set(expMap(tone, 5500, 11000) * Math.min(1.5, t), 1.2, sr); // high-pass
        this.f2.set(Math.min(16000, 13000 * t), 0.5, sr); // tame aliasing
        break;
      default: // perc: 2-operator FM with a pitch drop (tom / wood / bell by tone)
        this.freq = 240 * t;
        this.pAmt = 0.5;
        this.pK = decayCoef(0.03, sr);
        this.ampK = decayCoef(expMap(d, 0.06, 1.0), sr);
        this.env2K = decayCoef(expMap(d, 0.03, 0.4), sr);
        break;
    }
  }

  /** Fade out quickly (voice stealing / choke). */
  release(): void {
    if (!this.active || this.stealing) return;
    this.stealing = true;
    this.stealInc = 1 / Math.max(1, (STEAL_MS / 1000) * this.sr);
  }

  /** Adds this voice into out[from..to). */
  render(out: Float32Array, from: number, to: number): void {
    if (!this.active) return;
    switch (this.model) {
      case MODEL_KICK:
        this.renderKick(out, from, to);
        break;
      case MODEL_SNARE:
        this.renderSnare(out, from, to);
        break;
      case MODEL_HAT:
        this.renderHat(out, from, to);
        break;
      default:
        this.renderPerc(out, from, to);
    }
    this.f1.flush();
    this.f2.flush();
    // Snare: the noise tail can outlast the body, so it counts toward the voice's life.
    const env = this.model === MODEL_SNARE ? Math.max(this.ampEnv, this.env2) : this.ampEnv;
    this.level = env * this.steal;
    if (env < END_LEVEL || this.steal <= 0) {
      this.active = false;
      this.level = 0;
    }
  }

  /** Shared per-sample gain: attack ramp * steal fade * velocity. Advances both ramps. */
  private ramp(): number {
    if (this.atk < 1) this.atk = Math.min(1, this.atk + this.atkInc);
    if (this.stealing) this.steal = Math.max(0, this.steal - this.stealInc);
    return this.atk * this.steal * this.gain;
  }

  private renderKick(out: Float32Array, from: number, to: number): void {
    const inv = 1 / this.sr;
    const click = 0.12 + this.toneMix * 0.35;
    for (let i = from; i < to; i++) {
      const f = this.freq * (1 + this.pAmt * this.pEnv);
      this.phase += f * inv;
      if (this.phase >= 1) this.phase -= 1;
      this.f1.tick(this.noise.next());
      const body = Math.sin(TWO_PI * this.phase) * this.ampEnv;
      const cl = this.f1.low * this.env2 * click;
      out[i]! += (body + cl) * this.ramp();
      this.ampEnv *= this.ampK;
      this.pEnv *= this.pK;
      this.env2 *= this.env2K;
      if (this.steal <= 0) break;
    }
  }

  private renderSnare(out: Float32Array, from: number, to: number): void {
    const inv = 1 / this.sr;
    const noiseAmt = 0.45 + this.toneMix * 0.45;
    const bodyAmt = 1 - this.toneMix * 0.5;
    for (let i = from; i < to; i++) {
      const f = this.freq * (1 + this.pAmt * this.pEnv);
      this.phase += f * inv;
      if (this.phase >= 1) this.phase -= 1;
      this.phase2 += f * 1.78 * inv;
      if (this.phase2 >= 1) this.phase2 -= 1;
      const body = (Math.sin(TWO_PI * this.phase) * 0.65 + Math.sin(TWO_PI * this.phase2) * 0.35) * this.ampEnv * bodyAmt;
      this.f1.tick(this.noise.next());
      this.f2.tick(this.f1.high);
      const nz = this.f2.low * this.env2 * noiseAmt * 1.6;
      out[i]! += (body + nz) * this.ramp();
      this.ampEnv *= this.ampK;
      this.pEnv *= this.pK;
      this.env2 *= this.env2K;
      if (this.steal <= 0) break;
    }
  }

  private renderHat(out: Float32Array, from: number, to: number): void {
    const metal = 1 - this.toneMix * 0.6;
    const ph = this.hatPh;
    const inc = this.hatInc;
    for (let i = from; i < to; i++) {
      let sq = 0;
      for (let k = 0; k < 6; k++) {
        let p = ph[k]! + inc[k]!;
        if (p >= 1) p -= 1;
        ph[k] = p;
        sq += p < 0.5 ? 1 : -1;
      }
      const src = (sq / 6) * metal + this.noise.next() * (1 - metal * 0.7);
      this.f1.tick(src);
      this.f2.tick(this.f1.high);
      out[i]! += this.f2.low * this.ampEnv * 3 * this.ramp();
      this.ampEnv *= this.ampK;
      if (this.steal <= 0) break;
    }
  }

  private renderPerc(out: Float32Array, from: number, to: number): void {
    const inv = 1 / this.sr;
    const index = this.toneMix * 5;
    for (let i = from; i < to; i++) {
      const f = this.freq * (1 + this.pAmt * this.pEnv);
      this.phase2 += f * 1.48 * inv;
      if (this.phase2 >= 1) this.phase2 -= 1;
      this.phase += f * inv;
      if (this.phase >= 1) this.phase -= 1;
      const mod = Math.sin(TWO_PI * this.phase2) * index * this.env2;
      out[i]! += Math.sin(TWO_PI * this.phase + mod) * this.ampEnv * this.ramp();
      this.ampEnv *= this.ampK;
      this.pEnv *= this.pK;
      this.env2 *= this.env2K;
      if (this.steal <= 0) break;
    }
  }
}
