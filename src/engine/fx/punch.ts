// Punch-in effects chain (hold-to-play FX on the master or one track).
// AUDIO THREAD CODE: no allocations after construction, no closures per block.
//
// Every effect has a wet level that ramps over RAMP_S on press and release, so nothing clicks.
// Stutter, gate and reverse start on a frame chosen by the engine (the next 1/16 when playing).
// Loops (stutter, reverse) are windowed with short fades at their edges.
import { FX_IDS, type FxId } from './ids';
import { Svf, expMap } from '../dsp';
import type { Reverb } from './reverb';
import type { PingPongDelay } from './delay';

const COUNT = FX_IDS.length;
const RAMP_S = 0.005;
const EDGE_S = 0.002;
const HIST_S = 6;
const TAPE_S = 4;
const STUT_MAX_S = 2.5;

const I = (id: FxId) => FX_IDS.indexOf(id);
const STUTTER0 = I('stutter4');
const TAPE = I('tapeStop');
const LOW = I('lowSweep');
const HIGH = I('highSweep');
const LOFI = I('lofi');
const GATE = I('gate');
const REVERSE = I('reverse');
const REV_THROW = I('reverbThrow');
const DEL_THROW = I('delayThrow');
const STUT8T = I('stutter8T');
const SCRATCH = I('scratch');
const OCTAVE = I('octave');
const WOBBLE = I('wobble');
const STUTTER_STEPS = [4, 2, 1, 0.5, 4 / 3]; // 1/4, 1/8, 1/16, 1/32, 1/8T in 16th steps
const WOBBLE_STEPS = [4, 2, 4 / 3, 1]; // 1/4, 1/8, 1/8T, 1/16 per LFO cycle
const OCT_GRAIN_S = 0.05;
const TWO_PI = Math.PI * 2;
/** Stutter division index (0..4) of an effect id, or -1. */
const stutDivOf = (fx: number): number => (fx >= STUTTER0 && fx < STUTTER0 + 4 ? fx - STUTTER0 : fx === STUT8T ? 4 : -1);
const stutFxOf = (div: number): number => (div < 4 ? STUTTER0 + div : STUT8T);

export const DEFAULT_REVERB_S = 2.2;
export const DEFAULT_DELAY_STEPS = 3; // dotted 1/8
export const DEFAULT_DELAY_FB = 0.45;

export class PunchChain {
  /** -1 = master, otherwise a track index. */
  target = -1;

  private readonly sr: number;
  private readonly rampInc: number;
  private readonly on = new Uint8Array(COUNT);
  private readonly startAt = new Float64Array(COUNT);
  private readonly level = new Float64Array(COUNT);
  private readonly x = new Float64Array(COUNT);
  private readonly y = new Float64Array(COUNT);
  private readonly tx = new Float64Array(COUNT);
  private readonly ty = new Float64Array(COUNT);
  private readonly started = new Uint8Array(COUNT);

  // History of the target's dry signal (reverse).
  private readonly histL: Float32Array;
  private readonly histR: Float32Array;
  private histW = 0;

  // Stutter (one unit shared by the four divisions).
  private stutDiv = 1;
  private readonly stutL: Float32Array;
  private readonly stutR: Float32Array;
  private stutPos = 0;
  private stutWritten = 0;
  private stutGain = 1;

  // Scratch: lag (samples behind the write head) of the read pointer and the LFO phase.
  private scrLag = 0;
  private scrPh = 0;

  // Octave: grain phases (0..1) of the up and down shifters and the up/down crossfade weight.
  private octUpPh = 0;
  private octDnPh = 0;
  private octW = 1;
  private readonly octGrain: number;

  // Wobble: filters per channel.
  private readonly wobL = new Svf();
  private readonly wobR = new Svf();

  // Tape stop.
  private readonly tapeL: Float32Array;
  private readonly tapeR: Float32Array;
  private tapeW = 0;
  private tapeRead = 0;
  private tapeT = 0;

  // Sweeps.
  private readonly lowL = new Svf();
  private readonly lowR = new Svf();
  private readonly highL = new Svf();
  private readonly highR = new Svf();
  private lowCut = 18000;
  private highCut = 30;

  // Lo-fi.
  private holdN = 0;
  private holdL = 0;
  private holdR = 0;

  // Gate.
  private gateG = 1;
  private readonly gateK: number;

  // Reverse.
  private revAnchor = 0;
  private revK = 0;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    this.octGrain = Math.round(OCT_GRAIN_S * sampleRate);
    this.rampInc = 1 / (RAMP_S * sampleRate);
    this.gateK = 1 - Math.exp(-1 / (0.001 * sampleRate)); // edges reach 50 % ~0.7 ms after the grid
    this.histL = new Float32Array(Math.ceil(HIST_S * sampleRate));
    this.histR = new Float32Array(this.histL.length);
    this.stutL = new Float32Array(Math.ceil(STUT_MAX_S * sampleRate));
    this.stutR = new Float32Array(this.stutL.length);
    this.tapeL = new Float32Array(Math.ceil(TAPE_S * sampleRate));
    this.tapeR = new Float32Array(this.tapeL.length);
  }

  /** Records the target's dry signal while idle, so Reverse always has the last beat. */
  record(l: Float32Array, r: Float32Array, n: number): void {
    const hn = this.histL.length;
    let w = this.histW;
    for (let i = 0; i < n; i++) {
      this.histL[w] = l[i]!;
      this.histR[w] = r[i]!;
      w = w + 1 === hn ? 0 : w + 1;
    }
    this.histW = w;
  }

  /** True if any effect is on or still fading out. */
  get busy(): boolean {
    for (let k = 0; k < COUNT; k++) if (this.on[k] || this.level[k]! > 0) return true;
    return false;
  }

  isOn(fx: number): boolean {
    return this.on[fx] === 1;
  }

  /** Press or release. `at` is the absolute frame where a press takes effect. */
  press(fx: number, on: boolean, at: number): void {
    const div = stutDivOf(fx);
    if (div >= 0) {
      // One stutter unit: a new division restarts it; releasing another division does nothing.
      if (on) {
        for (let d = 0; d < 5; d++) this.on[stutFxOf(d)] = 0;
        this.stutDiv = div;
        this.started[STUTTER0] = 0;
        this.on[STUTTER0] = 1;
        this.startAt[STUTTER0] = at;
        this.on[fx] = 1;
      } else if (this.stutDiv === div) {
        for (let d = 0; d < 5; d++) this.on[stutFxOf(d)] = 0;
      }
      return;
    }
    this.on[fx] = on ? 1 : 0;
    if (on) {
      this.startAt[fx] = at;
      this.started[fx] = 0;
    }
  }

  setXY(fx: number, x: number, y: number, immediate = false): void {
    const cx = Math.min(1, Math.max(0, x));
    const cy = Math.min(1, Math.max(0, y));
    const k = stutDivOf(fx) >= 0 ? STUTTER0 : fx;
    this.tx[k] = cx;
    this.ty[k] = cy;
    if (immediate) {
      this.x[k] = cx;
      this.y[k] = cy;
    }
  }

  releaseAll(): void {
    this.on.fill(0);
  }

  /**
   * Processes the target signal in place. `f0` = absolute frame of sample 0, `sps` = samples per 16th.
   * Throws accumulate into injRev / injDel (mono), consumed by the engine's reverb and delay.
   */
  process(l: Float32Array, r: Float32Array, n: number, f0: number, sps: number, injRev: Float32Array, injDel: Float32Array, reverb: Reverb, delay: PingPongDelay): void {
    // History (reverse needs audio from before the press).
    const hl = this.histL;
    const hr = this.histR;
    const hn = hl.length;
    let w = this.histW;
    for (let i = 0; i < n; i++) {
      hl[w] = l[i]!;
      hr[w] = r[i]!;
      w = w + 1 === hn ? 0 : w + 1;
    }
    const histStart = this.histW; // index of sample 0 of this block in the history
    this.histW = w;

    // XY smoothing (per block).
    for (let k = 0; k < COUNT; k++) {
      this.x[k] = this.x[k]! + (this.tx[k]! - this.x[k]!) * 0.25;
      this.y[k] = this.y[k]! + (this.ty[k]! - this.y[k]!) * 0.25;
    }

    if (this.active(STUTTER0)) this.stutter(l, r, n, f0, sps);
    if (this.active(REVERSE)) this.reverse(l, r, n, f0, sps, histStart);
    if (this.active(SCRATCH)) this.scratch(l, r, n, f0, sps, histStart);
    if (this.active(OCTAVE)) this.octave(l, r, n, f0, histStart);
    if (this.active(TAPE)) this.tape(l, r, n, f0);
    if (this.active(WOBBLE)) this.wobble(l, r, n, f0, sps);
    if (this.active(GATE)) this.gate(l, r, n, f0, sps);
    if (this.active(LOFI)) this.lofi(l, r, n, f0);
    if (this.active(LOW)) this.sweep(l, r, n, f0, LOW);
    if (this.active(HIGH)) this.sweep(l, r, n, f0, HIGH);

    // Throws: send the target into the shared buses; the tails ring on after release.
    if (this.active(REV_THROW)) {
      this.throwInto(l, r, n, f0, REV_THROW, injRev, 0.35 + this.y[REV_THROW]! * 1.1);
      reverb.setDecay(this.on[REV_THROW] ? 1.5 + this.x[REV_THROW]! * 7.5 : DEFAULT_REVERB_S);
    } else reverb.setDecay(DEFAULT_REVERB_S);
    if (this.active(DEL_THROW)) {
      this.throwInto(l, r, n, f0, DEL_THROW, injDel, 0.9);
      if (this.on[DEL_THROW]) {
        const steps = [1, 2, 3, 4][Math.min(3, Math.floor(this.x[DEL_THROW]! * 4))]!;
        delay.setTime((steps * sps) / this.sr);
        delay.setFeedback(0.25 + this.y[DEL_THROW]! * 0.6);
      }
    } else {
      delay.setTime((DEFAULT_DELAY_STEPS * sps) / this.sr);
      delay.setFeedback(DEFAULT_DELAY_FB);
    }
  }

  private active(k: number): boolean {
    return this.on[k] === 1 || this.level[k]! > 0;
  }

  /** Advances the wet level of effect k for absolute frame f; returns it. */
  private step(k: number, f: number): number {
    const want = this.on[k] === 1 && f >= this.startAt[k]! ? 1 : 0;
    let lv = this.level[k]!;
    if (want > lv) lv = Math.min(1, lv + this.rampInc);
    else if (want < lv) lv = Math.max(0, lv - this.rampInc);
    this.level[k] = lv;
    return lv;
  }

  /** True on the first sample where effect k is on and its start frame is reached. */
  private begins(k: number, f: number): boolean {
    if (this.on[k] === 1 && this.started[k] === 0 && f >= this.startAt[k]!) {
      this.started[k] = 1;
      return true;
    }
    return false;
  }

  private edge(pos: number, len: number): number {
    const e = Math.min(EDGE_S * this.sr, len / 4);
    if (pos < e) return pos / e;
    if (pos > len - e) return (len - pos) / e;
    return 1;
  }

  private stutter(l: Float32Array, r: Float32Array, n: number, f0: number, sps: number): void {
    const k = STUTTER0;
    const frac = [1, 0.5, 0.25, 0.125][Math.min(3, Math.floor(this.x[k]! * 4))]!;
    const decay = 1 - this.y[k]! * 0.45;
    const full = Math.min(this.stutL.length, Math.max(32, Math.round(STUTTER_STEPS[this.stutDiv]! * sps)));
    for (let i = 0; i < n; i++) {
      const f = f0 + i;
      if (this.begins(k, f)) {
        this.stutPos = 0;
        this.stutWritten = 0;
        this.stutGain = 1;
      }
      const lv = this.step(k, f);
      if (lv === 0 && this.started[k] === 0) continue;
      const dl = l[i]!;
      const dr = r[i]!;
      if (this.stutWritten < full) {
        this.stutL[this.stutWritten] = dl;
        this.stutR[this.stutWritten] = dr;
        this.stutWritten++;
      }
      const len = Math.max(32, Math.min(this.stutWritten < full ? full : this.stutWritten, Math.round(full * frac)));
      if (this.stutPos >= len) this.stutPos = 0;
      const g = this.edge(this.stutPos, len) * this.stutGain;
      const wl = this.stutL[this.stutPos]! * g;
      const wr = this.stutR[this.stutPos]! * g;
      this.stutPos++;
      if (this.stutPos >= len) {
        this.stutPos = 0;
        this.stutGain *= decay;
      }
      l[i] = dl + (wl - dl) * lv;
      r[i] = dr + (wr - dr) * lv;
    }
    if (this.level[k] === 0 && this.on[k] === 0) this.started[k] = 0;
  }

  private reverse(l: Float32Array, r: Float32Array, n: number, f0: number, sps: number, histStart: number): void {
    const k = REVERSE;
    const steps = [4, 2, 1][Math.min(2, Math.floor(this.x[k]! * 3))]!;
    const len = Math.min(this.histL.length - 1, Math.max(64, Math.round(steps * sps)));
    const mix = this.y[k]!;
    const hn = this.histL.length;
    for (let i = 0; i < n; i++) {
      const f = f0 + i;
      if (this.begins(k, f)) {
        this.revAnchor = (histStart + i) % hn; // first sample at/after the press boundary
        this.revK = 0;
      }
      const lv = this.step(k, f);
      if (lv === 0) continue;
      const p = this.revK % len;
      let idx = this.revAnchor - 1 - p;
      if (idx < 0) idx += hn;
      const g = this.edge(p, len);
      const dl = l[i]!;
      const dr = r[i]!;
      const wl = dl + (this.histL[idx]! * g - dl) * mix;
      const wr = dr + (this.histR[idx]! * g - dr) * mix;
      this.revK++;
      l[i] = dl + (wl - dl) * lv;
      r[i] = dr + (wr - dr) * lv;
    }
    if (this.level[k] === 0 && this.on[k] === 0) this.started[k] = 0;
  }

  /** Vinyl scratch: reads the dry history about a beat back at a rate swinging between forward and backward. */
  private scratch(l: Float32Array, r: Float32Array, n: number, f0: number, sps: number, histStart: number): void {
    const k = SCRATCH;
    const hn = this.histL.length;
    const base = Math.min(hn - 512, Math.max(256, 4 * sps));
    const periodSteps = 2 * Math.pow(0.25, this.x[k]!); // 1/8 note .. 1/32 note per cycle
    const dPh = TWO_PI / (periodSteps * sps);
    const depth = 0.5 + this.y[k]! * 2;
    // Pulls the pointer back toward the base lag so a long hold never runs into the overwritten part of the ring.
    const pull = 1 / (0.1 * this.sr);
    for (let i = 0; i < n; i++) {
      const f = f0 + i;
      if (this.begins(k, f)) {
        this.scrLag = base;
        this.scrPh = 0;
      }
      const lv = this.step(k, f);
      if (lv === 0) continue;
      const rate = depth * Math.cos(this.scrPh) + Math.max(0, this.scrLag - base) * pull;
      this.scrPh += dPh;
      if (this.scrPh >= TWO_PI) this.scrPh -= TWO_PI;
      let lag = this.scrLag + 1 - rate;
      if (lag < 2) lag = 2;
      else if (lag > hn - 4) lag = hn - 4;
      this.scrLag = lag;
      let p = histStart + i - lag;
      while (p < 0) p += hn;
      const i0 = Math.floor(p);
      const fr = p - i0;
      const a = i0 % hn;
      const b = a + 1 === hn ? 0 : a + 1;
      const wl = this.histL[a]! + (this.histL[b]! - this.histL[a]!) * fr;
      const wr = this.histR[a]! + (this.histR[b]! - this.histR[a]!) * fr;
      const dl = l[i]!;
      const dr = r[i]!;
      l[i] = dl + (wl - dl) * lv;
      r[i] = dr + (wr - dr) * lv;
    }
    if (this.level[k] === 0 && this.on[k] === 0) this.started[k] = 0;
  }

  /** Reads the dry history `lag` samples behind sample index `pos` (linear interpolation). Returns via the out fields. */
  private rdL = 0;
  private rdR = 0;
  private readHist(pos: number, lag: number): void {
    const hn = this.histL.length;
    let p = pos - lag;
    while (p < 0) p += hn;
    const i0 = Math.floor(p);
    const fr = p - i0;
    const a = i0 % hn;
    const b = a + 1 === hn ? 0 : a + 1;
    this.rdL = this.histL[a]! + (this.histL[b]! - this.histL[a]!) * fr;
    this.rdR = this.histR[a]! + (this.histR[b]! - this.histR[a]!) * fr;
  }

  /** Octave: two crossfaded grains per direction read the history at ratio 2 (up) or 0.5 (down). */
  private octave(l: Float32Array, r: Float32Array, n: number, f0: number, histStart: number): void {
    const k = OCTAVE;
        const W = this.octGrain;
    const mix = this.y[k]!;
    const wantUp = this.x[k]! >= 0.5 ? 1 : 0;
    const swK = 1 - Math.exp(-1 / (0.02 * this.sr));
    const upInc = 1 / W; // lag W..0 shrinks by one sample per sample: reads at ratio 2
    const dnInc = 0.5 / W; // lag 0..W grows by half a sample per sample: reads at ratio 0.5
    for (let i = 0; i < n; i++) {
      const f = f0 + i;
      if (this.begins(k, f)) {
        this.octUpPh = 0;
        this.octDnPh = 0;
        this.octW = wantUp;
      }
      const lv = this.step(k, f);
      if (lv === 0) continue;
      this.octW += (wantUp - this.octW) * swK;
      const wu = this.octW;
      const pos = histStart + i;
      let sl = 0;
      let sr = 0;
      if (wu > 1e-4) {
        const p1 = this.octUpPh;
        const p2 = p1 >= 0.5 ? p1 - 0.5 : p1 + 0.5;
        const s1 = Math.sin(Math.PI * p1);
        const s2 = Math.sin(Math.PI * p2);
        this.readHist(pos, 2 + (1 - p1) * W);
        sl += this.rdL * s1 * s1 * wu;
        sr += this.rdR * s1 * s1 * wu;
        this.readHist(pos, 2 + (1 - p2) * W);
        sl += this.rdL * s2 * s2 * wu;
        sr += this.rdR * s2 * s2 * wu;
      }
      if (wu < 1 - 1e-4) {
        const p1 = this.octDnPh;
        const p2 = p1 >= 0.5 ? p1 - 0.5 : p1 + 0.5;
        const s1 = Math.sin(Math.PI * p1);
        const s2 = Math.sin(Math.PI * p2);
        this.readHist(pos, 2 + p1 * W);
        sl += this.rdL * s1 * s1 * (1 - wu);
        sr += this.rdR * s1 * s1 * (1 - wu);
        this.readHist(pos, 2 + p2 * W);
        sl += this.rdL * s2 * s2 * (1 - wu);
        sr += this.rdR * s2 * s2 * (1 - wu);
      }
      this.octUpPh += upInc;
      if (this.octUpPh >= 1) this.octUpPh -= 1;
      this.octDnPh += dnInc;
      if (this.octDnPh >= 1) this.octDnPh -= 1;
      const g = mix * lv;
      const dl = l[i]!;
      const dr = r[i]!;
      l[i] = dl + (sl - dl) * g;
      r[i] = dr + (sr - dr) * g;
    }
    if (this.level[k] === 0 && this.on[k] === 0) this.started[k] = 0;
  }

  /** Tempo-synced resonant low-pass wobble; the LFO phase restarts on press so it locks to the grid. */
  private wobble(l: Float32Array, r: Float32Array, n: number, f0: number, sps: number): void {
    const k = WOBBLE;
    const period = WOBBLE_STEPS[Math.min(3, Math.floor(this.x[k]! * 4))]! * sps;
    const depthOct = 0.2 + this.y[k]! * 2.46; // about 200 Hz .. 8 kHz around 1.27 kHz at full depth
    for (let i = 0; i < n; i++) {
      const f = f0 + i;
      if (this.begins(k, f)) {
        this.wobL.reset();
        this.wobR.reset();
      }
      if ((i & 7) === 0) {
        const ph = (((f - this.startAt[k]!) % period) + period) % period / period;
        const lfo = 0.5 - 0.5 * Math.cos(TWO_PI * ph); // closed on the grid, opens mid-cycle
        const fc = 1265 * Math.pow(2, (lfo * 2 - 1) * depthOct);
        this.wobL.set(fc, 3.5, this.sr);
        this.wobR.set(fc, 3.5, this.sr);
      }
      const lv = this.step(k, f);
      if (lv === 0) continue;
      this.wobL.tick(l[i]!);
      this.wobR.tick(r[i]!);
      l[i] = l[i]! + (this.wobL.low - l[i]!) * lv;
      r[i] = r[i]! + (this.wobR.low - r[i]!) * lv;
    }
    this.wobL.flush();
    this.wobR.flush();
    if (this.level[k] === 0 && this.on[k] === 0) this.started[k] = 0;
  }

  private tape(l: Float32Array, r: Float32Array, n: number, f0: number): void {
    const k = TAPE;
    const tn = this.tapeL.length;
    const dur = 2.5 - this.x[k]! * 2.3; // "speed": higher = faster stop
    const curve = 0.5 + this.y[k]! * 1.5;
    for (let i = 0; i < n; i++) {
      const f = f0 + i;
      if (this.begins(k, f)) {
        this.tapeRead = this.tapeW;
        this.tapeT = 0;
      }
      const lv = this.step(k, f);
      if (lv === 0 && this.started[k] === 0) continue;
      const dl = l[i]!;
      const dr = r[i]!;
      this.tapeL[this.tapeW] = dl;
      this.tapeR[this.tapeW] = dr;
      this.tapeW = this.tapeW + 1 === tn ? 0 : this.tapeW + 1;
      const t = this.tapeT / this.sr;
      this.tapeT++;
      const rate = t >= dur ? 0 : Math.pow(1 - t / dur, curve);
      // A stopped tape is silent: fade out over the last stretch instead of holding one sample (DC).
      const fade = Math.min(1, rate * 6);
      let p = this.tapeRead;
      const i0 = p | 0;
      const fr = p - i0;
      const i1 = i0 + 1 === tn ? 0 : i0 + 1;
      const wl = (this.tapeL[i0]! + (this.tapeL[i1]! - this.tapeL[i0]!) * fr) * fade;
      const wr = (this.tapeR[i0]! + (this.tapeR[i1]! - this.tapeR[i0]!) * fr) * fade;
      p += rate;
      if (p >= tn) p -= tn;
      this.tapeRead = p;
      l[i] = dl + (wl - dl) * lv;
      r[i] = dr + (wr - dr) * lv;
    }
    if (this.level[k] === 0 && this.on[k] === 0) this.started[k] = 0;
  }

  private gate(l: Float32Array, r: Float32Array, n: number, f0: number, sps: number): void {
    const k = GATE;
    const periodSteps = [2, 1, 0.5][Math.min(2, Math.floor(this.x[k]! * 3))]!;
    const period = periodSteps * sps;
    const depth = 0.3 + this.y[k]! * 0.7;
    for (let i = 0; i < n; i++) {
      const f = f0 + i;
      if (this.begins(k, f)) this.gateG = 1;
      const lv = this.step(k, f);
      if (lv === 0) continue;
      const ph = ((f - this.startAt[k]!) % period) / period;
      const want = ph < 0.5 ? 1 : 1 - depth;
      this.gateG += (want - this.gateG) * this.gateK;
      const g = 1 + (this.gateG - 1) * lv;
      l[i] = l[i]! * g;
      r[i] = r[i]! * g;
    }
    if (this.level[k] === 0 && this.on[k] === 0) this.started[k] = 0;
  }

  private lofi(l: Float32Array, r: Float32Array, n: number, f0: number): void {
    const k = LOFI;
    const bits = Math.round(16 - this.x[k]! * 13);
    const q = Math.pow(2, bits - 1);
    const hold = 1 + Math.floor(this.y[k]! * 23);
    for (let i = 0; i < n; i++) {
      const lv = this.step(k, f0 + i);
      if (lv === 0) continue;
      if (this.holdN <= 0) {
        this.holdL = Math.round(l[i]! * q) / q;
        this.holdR = Math.round(r[i]! * q) / q;
        this.holdN = hold;
      }
      this.holdN--;
      l[i] = l[i]! + (this.holdL - l[i]!) * lv;
      r[i] = r[i]! + (this.holdR - r[i]!) * lv;
    }
  }

  private sweep(l: Float32Array, r: Float32Array, n: number, f0: number, k: number): void {
    const low = k === LOW;
    const fa = low ? this.lowL : this.highL;
    const fb = low ? this.lowR : this.highR;
    const target = low ? expMap(this.x[k]!, 150, 18000) : expMap(this.x[k]!, 30, 8000);
    const q = 0.7 + this.y[k]! * 7;
    for (let i = 0; i < n; i++) {
      const f = f0 + i;
      if (this.begins(k, f)) {
        // Each press sweeps in from fully open.
        if (low) this.lowCut = 18000;
        else this.highCut = 30;
        fa.reset();
        fb.reset();
      }
      if ((i & 31) === 0) {
        // Glide toward the XY cutoff evenly in pitch (log frequency), ~0.25 s; coefficients every 32 samples.
        const kk = 1 - Math.exp(-32 / (0.06 * this.sr));
        if (low) this.lowCut *= Math.pow(target / this.lowCut, kk);
        else this.highCut *= Math.pow(target / this.highCut, kk);
        const c = low ? this.lowCut : this.highCut;
        fa.set(c, q, this.sr);
        fb.set(c, q, this.sr);
      }
      const lv = this.step(k, f);
      if (lv === 0) continue;
      fa.tick(l[i]!);
      fb.tick(r[i]!);
      const wl = low ? fa.low : fa.high;
      const wr = low ? fb.low : fb.high;
      l[i] = l[i]! + (wl - l[i]!) * lv;
      r[i] = r[i]! + (wr - r[i]!) * lv;
    }
    fa.flush();
    fb.flush();
    if (this.level[k] === 0 && this.on[k] === 0) this.started[k] = 0;
  }

  private throwInto(l: Float32Array, r: Float32Array, n: number, f0: number, k: number, inj: Float32Array, amount: number): void {
    for (let i = 0; i < n; i++) {
      const lv = this.step(k, f0 + i);
      if (lv === 0) continue;
      inj[i]! += (l[i]! + r[i]!) * 0.5 * lv * amount;
    }
  }
}
