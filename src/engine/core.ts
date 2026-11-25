// Engine core: sample-accurate clock, 16x16x16 step sequencer with parameter locks, pattern chains,
// a shared pool of sample voices, per-sound tone filter and volume, punch-in FX, master limiter.
// AUDIO THREAD CODE: no allocations in process() and no closures created per block.
// Commands (command()) may copy into preallocated arrays; they run at UI rate, not per block.
// Pure TypeScript with no Web Audio dependency, so it renders offline in Node for tests.
// Clock, event queue and FX wiring adapted from groovebox's engine (same author).
import { CELLS, KEYS, NO_FX, NO_LOCK, PATTERNS, SOUNDS, STEPS, type EngineCommand, type EngineEvent } from './protocol';
import { SampleVoice } from './voice';
import { Limiter } from './limiter';
import { Svf, expMap } from './dsp';
import { Reverb } from './fx/reverb';
import { PingPongDelay } from './fx/delay';
import { DEFAULT_DELAY_FB, DEFAULT_DELAY_STEPS, DEFAULT_REVERB_S, PunchChain } from './fx/punch';
import { FX_DEFAULT_XY, FX_DEFS, FX_IDS } from './fx/ids';

const MAX_BLOCK = 4096;
/** Voices that may sound at once, plus spares so stolen voices can fade out instead of cutting. */
const POLY = 32;
const VOICES = POLY + 8;
/** Voices one sound may hold at once (chords of up to this many keys). */
const PER_SOUND = 6;
const QUEUE = 1024;
const MAX_CHAIN = 64;
const METER_HZ = 30;
/** Steps are scanned this far ahead of the block end. */
const LOOKAHEAD_STEPS = 0.5;
/** A sequenced trigger this close (in steps) after a live hit of the same sound and key is skipped (no flam when recording). */
const LIVE_DEDUP_STEPS = 0.5;
const FX_COUNT = FX_IDS.length;

const EV_ON = 0;
const EV_OFF = 1;
const EV_FX = 2;
const EV_CLICK = 3;
const CLICK_S = 0.03;

/** Tone -1..1 to a low-pass (t < 0) or high-pass (t > 0) cutoff in Hz. */
function toneCutoff(t: number): number {
  return t < 0 ? expMap(1 + t, 180, 20000) : expMap(t, 20, 6000);
}

class SoundState {
  drum = false;
  sampleId = '';
  data: Float32Array | null = null;
  rate = 44100;
  start = 0;
  end = 1;
  readonly slices = new Float64Array(KEYS + 1);
  pitch = 0;
  tone = 0;
  volume = 0.8;
  /** Tone target for the current step (lock or base) and its smoothed value. */
  toneTarget = 0;
  toneNow = 0;
  gain = 0.64;
  readonly svf = new Svf();
  readonly buf = new Float32Array(MAX_BLOCK);
  busy = false;
}

export class Engine {
  readonly sampleRate: number;
  /** Event sink (the worklet forwards to the port; tests collect). Never called per sample. */
  emit: (ev: EngineEvent) => void = () => {};

  private readonly sounds: SoundState[] = [];
  private readonly voices: SampleVoice[] = [];
  private voiceAge = 0;
  private noteIds = 0;
  private readonly samples = new Map<string, { l: Float32Array; rate: number }>();

  // Patterns (index ((pattern * SOUNDS + sound) * STEPS + step)).
  private readonly keys = new Uint16Array(PATTERNS * CELLS);
  private readonly len = new Uint8Array(PATTERNS * CELLS);
  private readonly lockA = new Int8Array(PATTERNS * CELLS).fill(NO_LOCK);
  private readonly lockB = new Int8Array(PATTERNS * CELLS).fill(NO_LOCK);
  private readonly fxLane = new Int8Array(PATTERNS * STEPS).fill(NO_FX);

  // Chain: patterns played in order; a pending chain replaces it at the next pattern start.
  private readonly chain = new Uint8Array(MAX_CHAIN);
  private chainLen = 1;
  private chainPos = 0;
  private readonly pending = new Uint8Array(MAX_CHAIN);
  private pendingLen = 0;

  // Transport and clock: pos(frame) = anchorStep + (frame - anchorFrame) / samplesPerStep,
  // re-anchored only on tempo change, so step times are exact and independent of the block size.
  private playing = false;
  private anchorFrame = 0;
  private anchorStep = 0;
  private nextStep = 0;
  private bpm = 120;
  private swing = 50;
  private frame = 0;

  // Event queue (unordered, scanned linearly).
  private readonly qFrame = new Float64Array(QUEUE);
  private readonly qType = new Uint8Array(QUEUE);
  private readonly qSound = new Int8Array(QUEUE);
  private readonly qKey = new Int8Array(QUEUE);
  private readonly qVel = new Float32Array(QUEUE);
  private readonly qId = new Int32Array(QUEUE);
  private readonly qA = new Int8Array(QUEUE); // pitch lock (EV_ON) / fx index (EV_FX)
  private readonly qB = new Int8Array(QUEUE); // tone lock (EV_ON) / 1 = press (EV_FX)
  private readonly qSeq = new Uint8Array(QUEUE); // 1 = sequencer (dropped on stop)
  private qLen = 0;

  /** Frame of the latest live hit per sound and key (for flam suppression while recording). */
  private readonly lastLive = new Float64Array(SOUNDS * KEYS).fill(-1e12);
  /** Melodic key -> semitone offset (scale) and project transposition. */
  private readonly scale = new Int8Array(KEYS).map((_, k) => k);
  private transpose = 0;

  // FX.
  private readonly reverb: Reverb;
  private readonly delay: PingPongDelay;
  private readonly punch: PunchChain;
  private readonly liveFx = new Uint8Array(FX_COUNT);
  private liveFxCount = 0;
  private laneFx = NO_FX;
  private readonly revIn = new Float32Array(MAX_BLOCK);
  private readonly delIn = new Float32Array(MAX_BLOCK);
  private readonly injRev = new Float32Array(MAX_BLOCK);
  private readonly injDel = new Float32Array(MAX_BLOCK);
  private readonly limiter: Limiter;
  private masterGain = 0.8;
  // Metronome: two pre-rendered clicks (accent / beat), played from clickStart within the block.
  private metronome = false;
  private readonly clickHi: Float32Array;
  private readonly clickLo: Float32Array;
  private click: Float32Array | null = null;
  private clickPos = 0;
  private clickStart = -1;
  /** Block offset of the event being dispatched (set in process()). */
  private dispatchOff = 0;
  private readonly smoothK: number;

  // Resample capture.
  private capId = '';
  private capL: Float32Array | null = null;
  private capPos = 0;
  private capStart = 0;

  private masterPeak = 0;
  private active = 0;
  private readonly meterKeys: number[] = new Array<number>(SOUNDS).fill(-1);
  private meterFrames = 0;
  private readonly meterEvery: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.limiter = new Limiter(sampleRate);
    this.reverb = new Reverb(sampleRate);
    this.delay = new PingPongDelay(sampleRate);
    this.punch = new PunchChain(sampleRate);
    this.smoothK = 1 - Math.exp(-1 / (0.01 * sampleRate));
    this.meterEvery = Math.round(sampleRate / METER_HZ);
    for (let s = 0; s < SOUNDS; s++) {
      const st = new SoundState();
      for (let k = 0; k <= KEYS; k++) st.slices[k] = k / KEYS;
      this.sounds.push(st);
    }
    for (let v = 0; v < VOICES; v++) this.voices.push(new SampleVoice(sampleRate));
    const clickLen = Math.round(CLICK_S * sampleRate);
    this.clickHi = new Float32Array(clickLen);
    this.clickLo = new Float32Array(clickLen);
    for (let i = 0; i < clickLen; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t / 0.006) * Math.min(1, i / 16);
      this.clickHi[i] = Math.sin(2 * Math.PI * 1760 * t) * env * 0.45;
      this.clickLo[i] = Math.sin(2 * Math.PI * 1320 * t) * env * 0.3;
    }
  }

  /** Output latency added by the engine (limiter lookahead), in samples. */
  get latency(): number {
    return this.limiter.latency;
  }

  /** Align the engine's frame counter with the host clock (AudioWorkletGlobalScope.currentFrame). */
  syncFrame(frame: number): void {
    this.frame = frame;
  }

  get samplesPerStep(): number {
    return (this.sampleRate * 60) / this.bpm / 4;
  }

  private timeOf(frame: number): number {
    return (frame + this.limiter.latency) / this.sampleRate;
  }

  command(cmd: EngineCommand): void {
    switch (cmd.type) {
      case 'transport':
        if (cmd.playing && !this.playing) {
          this.playing = true;
          this.anchorFrame = this.frame;
          this.anchorStep = 0;
          this.nextStep = 0;
          this.chainPos = 0;
          this.takePendingChain();
        } else if (!cmd.playing && this.playing) {
          this.playing = false;
          for (let i = this.qLen - 1; i >= 0; i--) if (this.qSeq[i] === 1) this.removeAt(i);
          // Sequenced notes lose their pending releases: release them now (they ring out briefly).
          for (let v = 0; v < VOICES; v++) {
            const voice = this.voices[v]!;
            if (voice.active && !voice.live && voice.gate) voice.release();
          }
          this.setLaneFx(NO_FX, this.frame);
          this.emit({ type: 'step', step: -1, pattern: this.chain[this.chainPos]!, chainPos: this.chainPos, time: this.timeOf(this.frame) });
        }
        break;
      case 'tempo':
        if (this.playing) {
          this.anchorStep = this.posAt(this.frame);
          this.anchorFrame = this.frame;
        }
        this.bpm = Math.min(300, Math.max(30, cmd.bpm));
        this.swing = Math.min(75, Math.max(50, cmd.swing));
        break;
      case 'scale':
        for (let k = 0; k < KEYS; k++) this.scale[k] = Math.max(-48, Math.min(48, Math.round(cmd.offsets[k] ?? k)));
        this.transpose = Math.max(-12, Math.min(12, Math.round(cmd.key)));
        break;
      case 'metronome':
        this.metronome = cmd.on;
        break;
      case 'volume':
        this.masterGain = Math.min(1, Math.max(0, cmd.gain));
        break;
      case 'pattern': {
        const p = cmd.index;
        if (p < 0 || p >= PATTERNS) return;
        const d = cmd.data;
        this.keys.set(d.keys.subarray(0, CELLS), p * CELLS);
        this.len.set(d.len.subarray(0, CELLS), p * CELLS);
        this.lockA.set(d.lockA.subarray(0, CELLS), p * CELLS);
        this.lockB.set(d.lockB.subarray(0, CELLS), p * CELLS);
        this.fxLane.set(d.fx.subarray(0, STEPS), p * STEPS);
        break;
      }
      case 'chain': {
        const n = Math.max(1, Math.min(MAX_CHAIN, cmd.patterns.length));
        for (let i = 0; i < n; i++) this.pending[i] = Math.min(PATTERNS - 1, Math.max(0, cmd.patterns[i] ?? 0));
        this.pendingLen = n;
        if (cmd.now || !this.playing) {
          this.takePendingChain();
          this.chainPos = 0;
        }
        break;
      }
      case 'sound': {
        const p = cmd.params;
        const st = this.sounds[p.index];
        if (!st) return;
        const drum = p.kind === 'drum';
        if (drum !== st.drum || p.sampleId !== st.sampleId) this.fadeSound(p.index);
        st.drum = drum;
        st.sampleId = p.sampleId ?? '';
        const smp = p.sampleId ? this.samples.get(p.sampleId) : undefined;
        st.data = smp?.l ?? null;
        st.rate = smp?.rate ?? 44100;
        st.start = Math.min(1, Math.max(0, Math.min(p.start, p.end)));
        st.end = Math.min(1, Math.max(0, Math.max(p.start, p.end)));
        if (p.slices.length === KEYS + 1) for (let k = 0; k <= KEYS; k++) st.slices[k] = Math.min(1, Math.max(0, p.slices[k]!));
        else for (let k = 0; k <= KEYS; k++) st.slices[k] = k / KEYS;
        st.pitch = Math.min(24, Math.max(-24, p.pitch));
        st.tone = Math.min(1, Math.max(-1, p.tone));
        st.toneTarget = st.tone;
        st.volume = Math.min(1, Math.max(0, p.volume));
        if (!st.busy) st.toneNow = st.tone;
        break;
      }
      case 'sample': {
        const data = { l: cmd.l, rate: cmd.rate };
        this.samples.set(cmd.id, data);
        for (let s = 0; s < SOUNDS; s++) {
          const st = this.sounds[s]!;
          if (st.sampleId !== cmd.id) continue;
          this.fadeSound(s); // voices must not keep reading a replaced buffer
          st.data = data.l;
          st.rate = data.rate;
        }
        break;
      }
      case 'sampleFree':
        this.samples.delete(cmd.id);
        break;
      case 'play': {
        const s = cmd.sound | 0;
        const k = cmd.key | 0;
        if (s < 0 || s >= SOUNDS || k < 0 || k >= KEYS) return;
        if (cmd.on) {
          this.lastLive[s * KEYS + k] = this.frame;
          this.enqueue(this.frame, EV_ON, s, k, cmd.vel ?? 100, 0, NO_LOCK, NO_LOCK, 0);
        } else if (!this.sounds[s]!.drum) {
          this.enqueue(this.frame, EV_OFF, s, k, 0, 0, 0, 0, 0);
        }
        break;
      }
      case 'fx': {
        const k = cmd.fx | 0;
        if (k < 0 || k >= FX_COUNT) return;
        if (cmd.on === (this.liveFx[k] === 1)) return;
        this.liveFx[k] = cmd.on ? 1 : 0;
        this.liveFxCount += cmd.on ? 1 : -1;
        if (cmd.on) {
          // A live press takes over from the recorded lane.
          if (this.laneFx !== NO_FX && this.laneFx !== k) this.setLaneFx(NO_FX, this.frame);
          const [dx, dy] = FX_DEFAULT_XY[FX_IDS[k]!];
          this.punch.setXY(k, dx, dy, true);
        }
        if (this.laneFx === k && !cmd.on) this.laneFx = NO_FX;
        const snaps = FX_DEFS[k]!.snaps && this.playing;
        this.punch.press(k, cmd.on, snaps && cmd.on ? this.nextSixteenth() : this.frame);
        break;
      }
      case 'fxKnob': {
        const k = cmd.fx | 0;
        if (k >= 0 && k < FX_COUNT) this.punch.setXY(k, cmd.x, cmd.y);
        break;
      }
      case 'resample':
        this.capId = cmd.id;
        this.capL = cmd.l;
        this.capPos = 0;
        this.capStart = this.playing ? this.nextPatternStart() : this.frame;
        break;
      case 'panic':
        this.qLen = 0;
        for (let v = 0; v < VOICES; v++) this.voices[v]!.stealFade();
        this.punch.releaseAll();
        this.liveFx.fill(0);
        this.liveFxCount = 0;
        this.laneFx = NO_FX;
        break;
    }
  }

  private takePendingChain(): void {
    if (this.pendingLen <= 0) return;
    this.chain.set(this.pending.subarray(0, this.pendingLen));
    this.chainLen = this.pendingLen;
    this.pendingLen = 0;
  }

  private fadeSound(s: number): void {
    for (let v = 0; v < VOICES; v++) {
      const voice = this.voices[v]!;
      if (voice.active && voice.sound === s) voice.stealFade();
    }
  }

  private enqueue(frame: number, type: number, sound: number, key: number, vel: number, id: number, a: number, b: number, seq: number): void {
    if (this.qLen >= QUEUE) return; // drop rather than allocate
    const i = this.qLen++;
    this.qFrame[i] = frame;
    this.qType[i] = type;
    this.qSound[i] = sound;
    this.qKey[i] = key;
    this.qVel[i] = vel;
    this.qId[i] = id;
    this.qA[i] = a;
    this.qB[i] = b;
    this.qSeq[i] = seq;
  }

  private removeAt(i: number): void {
    const last = --this.qLen;
    this.qFrame[i] = this.qFrame[last]!;
    this.qType[i] = this.qType[last]!;
    this.qSound[i] = this.qSound[last]!;
    this.qKey[i] = this.qKey[last]!;
    this.qVel[i] = this.qVel[last]!;
    this.qId[i] = this.qId[last]!;
    this.qA[i] = this.qA[last]!;
    this.qB[i] = this.qB[last]!;
    this.qSeq[i] = this.qSeq[last]!;
  }

  private posAt(frame: number): number {
    return this.anchorStep + (frame - this.anchorFrame) / this.samplesPerStep;
  }

  private frameAt(step: number): number {
    return this.anchorFrame + (step - this.anchorStep) * this.samplesPerStep;
  }

  private nextSixteenth(from = this.frame): number {
    const next = Math.ceil(this.posAt(from) - 1e-9);
    return Math.max(from, Math.round(this.frameAt(next)));
  }

  private nextPatternStart(): number {
    const next = Math.ceil((this.posAt(this.frame) - 1e-9) / STEPS) * STEPS;
    return Math.max(this.frame, Math.round(this.frameAt(next)));
  }

  /** Swing delays every odd 16th by (2 * swing - 1) steps: 50 % = straight, 75 % = dotted. */
  private swingDelay(step: number): number {
    return (step & 1) === 1 ? (2 * this.swing) / 100 - 1 : 0;
  }

  /** Queue an FX lane change at frame f (press of `fx`, release of the current lane FX). */
  private setLaneFx(fx: number, f: number): void {
    if (fx === this.laneFx) return;
    if (this.laneFx !== NO_FX && this.liveFx[this.laneFx] === 0) this.enqueue(f, EV_FX, 0, 0, 0, 0, this.laneFx, 0, 0);
    if (fx !== NO_FX) this.enqueue(f, EV_FX, 0, 0, 0, 0, fx, 1, 1);
    this.laneFx = fx;
  }

  /** Enqueue all steps whose time falls before the end of this block (plus lookahead). */
  private schedule(blockStart: number, frames: number): void {
    const posEnd = this.posAt(blockStart + frames);
    while (this.nextStep - LOOKAHEAD_STEPS < posEnd) {
      const s = this.nextStep;
      const local = s % STEPS;
      if (local === 0 && s > 0) {
        if (this.pendingLen > 0) {
          this.takePendingChain();
          this.chainPos = 0;
        } else this.chainPos = (this.chainPos + 1) % this.chainLen;
      }
      const pat = this.chain[this.chainPos]!;
      const at = Math.max(blockStart, this.frameAt(s + this.swingDelay(s)));
      this.emit({ type: 'step', step: local, pattern: pat, chainPos: this.chainPos, time: this.timeOf(at) });
      if (this.metronome && local % 4 === 0) this.enqueue(this.frameAt(s), EV_CLICK, 0, 0, 0, 0, local === 0 ? 1 : 0, 0, 1);
      for (let snd = 0; snd < SOUNDS; snd++) {
        const i = (pat * SOUNDS + snd) * STEPS + local;
        const mask = this.keys[i]!;
        if (mask === 0) continue;
        const n = this.len[i]!;
        const offAt = n > 0 ? Math.max(at + 1, this.frameAt(s + n + this.swingDelay(s + n))) : -1;
        for (let k = 0; k < KEYS; k++) {
          if ((mask & (1 << k)) === 0) continue;
          const id = ++this.noteIds;
          this.enqueue(at, EV_ON, snd, k, 100, id, this.lockA[i]!, this.lockB[i]!, 1);
          if (offAt >= 0) this.enqueue(offAt, EV_OFF, snd, k, 0, id, 0, 0, 1);
        }
      }
      if (this.liveFxCount === 0) this.setLaneFx(this.fxLane[pat * STEPS + local]!, at);
      this.nextStep++;
    }
  }

  private noteOn(snd: number, key: number, vel: number, id: number, lockA: number, lockB: number): void {
    const st = this.sounds[snd]!;
    const d = st.data;
    if (!d) return;
    this.active |= 1 << snd;
    this.meterKeys[snd] = key;
    st.toneTarget = lockB === NO_LOCK ? st.tone : lockB / 100;
    const n = d.length;
    let from: number;
    let to: number;
    let semis = st.pitch + (lockA === NO_LOCK ? 0 : lockA);
    if (st.drum) {
      from = Math.floor(st.slices[key]! * n);
      to = Math.ceil(st.slices[key + 1]! * n);
    } else {
      from = Math.floor(st.start * n);
      to = Math.ceil(st.end * n);
      semis += this.scale[key]! + this.transpose;
    }
    // Choke: the same drum slice retriggers; enforce the per-sound voice cap (oldest first).
    let count = 0;
    let oldest = -1;
    for (let v = 0; v < VOICES; v++) {
      const voice = this.voices[v]!;
      if (!voice.active || voice.stealing || voice.sound !== snd) continue;
      if (st.drum && voice.key === key) {
        voice.stealFade();
        continue;
      }
      count++;
      if (oldest < 0 || voice.age < this.voices[oldest]!.age) oldest = v;
    }
    if (count >= PER_SOUND && oldest >= 0) this.voices[oldest]!.stealFade();
    // Global polyphony: fade out the quietest sounding voice when POLY are already sounding.
    let sounding = 0;
    let quietest = -1;
    for (let v = 0; v < VOICES; v++) {
      const voice = this.voices[v]!;
      if (!voice.active || voice.stealing) continue;
      sounding++;
      if (quietest < 0 || voice.loudness() < this.voices[quietest]!.loudness()) quietest = v;
    }
    if (sounding >= POLY && quietest >= 0) this.voices[quietest]!.stealFade();
    // Free voice, else the quietest (already fading) one.
    let pick = -1;
    let quiet = Infinity;
    for (let v = 0; v < VOICES; v++) {
      const voice = this.voices[v]!;
      if (!voice.active) {
        pick = v;
        break;
      }
      const l = voice.loudness();
      if (l < quiet) {
        quiet = l;
        pick = v;
      }
    }
    this.voices[pick]!.noteOn(d, st.rate, from, to, semis, vel, snd, key, id, id === 0, ++this.voiceAge);
  }

  private noteOff(snd: number, key: number, id: number): void {
    for (let v = 0; v < VOICES; v++) {
      const voice = this.voices[v]!;
      if (!voice.active || !voice.gate || voice.sound !== snd || voice.key !== key) continue;
      if (id === 0 ? voice.live : voice.id === id) voice.release();
    }
  }

  private dispatch(i: number): void {
    const type = this.qType[i]!;
    if (type === EV_ON && this.qSeq[i] === 1) {
      // A live hit of the same sound and key just before this sequenced one (recording): skip it, no flam.
      const since = this.qFrame[i]! - this.lastLive[this.qSound[i]! * KEYS + this.qKey[i]!]!;
      if (since >= 0 && since < LIVE_DEDUP_STEPS * this.samplesPerStep) return;
    }
    if (type === EV_CLICK) {
      this.click = this.qA[i] === 1 ? this.clickHi : this.clickLo;
      this.clickPos = 0;
      this.clickStart = this.dispatchOff;
      return;
    }
    if (type === EV_ON) this.noteOn(this.qSound[i]!, this.qKey[i]!, this.qVel[i]!, this.qId[i]!, this.qA[i]!, this.qB[i]!);
    else if (type === EV_OFF) this.noteOff(this.qSound[i]!, this.qKey[i]!, this.qId[i]!);
    else {
      const k = this.qA[i]!;
      const on = this.qB[i] === 1;
      const f = Math.round(this.qFrame[i]!);
      if (on) {
        const [dx, dy] = FX_DEFAULT_XY[FX_IDS[k]!];
        this.punch.setXY(k, dx, dy, true);
        this.punch.press(k, true, FX_DEFS[k]!.snaps ? this.nextSixteenth(f) : f);
      } else this.punch.press(k, false, f);
    }
  }

  private renderVoices(from: number, to: number): void {
    if (to <= from) return;
    for (let v = 0; v < VOICES; v++) {
      const voice = this.voices[v]!;
      if (!voice.active) continue;
      const st = this.sounds[voice.sound]!;
      st.busy = true;
      voice.render(st.buf, from, to);
    }
  }

  /** Renders `frames` samples into left/right (overwrites). */
  process(left: Float32Array, right: Float32Array, frames: number): void {
    const n = Math.min(frames, MAX_BLOCK);
    const blockStart = this.frame;
    const blockEnd = blockStart + n;
    for (let s = 0; s < SOUNDS; s++) {
      const st = this.sounds[s]!;
      if (st.busy) st.buf.fill(0, 0, n);
      st.busy = false;
    }
    if (this.playing) this.schedule(blockStart, n);

    // Render up to each due event, fire it, continue: sample-accurate triggers.
    let cursor = 0;
    for (;;) {
      let best = -1;
      let bestF = blockEnd;
      for (let i = 0; i < this.qLen; i++) {
        const f = this.qFrame[i]!;
        if (f < bestF) {
          bestF = f;
          best = i;
        }
      }
      if (best < 0) break;
      const off = Math.max(cursor, Math.min(n, Math.round(bestF - blockStart)));
      this.renderVoices(cursor, off);
      cursor = off;
      this.dispatchOff = off;
      this.dispatch(best);
      this.removeAt(best);
    }
    this.renderVoices(cursor, n);

    // Mix: per-sound tone filter (coefficients every 32 samples) and smoothed volume, mono to center.
    left.fill(0, 0, n);
    const k = this.smoothK;
    const kTone = 1 - Math.exp(-32 / (0.02 * this.sampleRate));
    for (let s = 0; s < SOUNDS; s++) {
      const st = this.sounds[s]!;
      const target = st.volume * st.volume;
      if (!st.busy) {
        st.gain = target;
        st.toneNow = st.toneTarget;
        continue;
      }
      const buf = st.buf;
      const svf = st.svf;
      let g = st.gain;
      let t = st.toneNow;
      const filtered = Math.abs(t) > 0.01 || Math.abs(st.toneTarget) > 0.01;
      for (let i = 0; i < n; i++) {
        if (filtered && (i & 31) === 0) {
          t += (st.toneTarget - t) * kTone;
          svf.set(toneCutoff(t), 0.75, this.sampleRate);
        }
        g += (target - g) * k;
        let y = buf[i]!;
        if (filtered) {
          svf.tick(y);
          y = t < 0 ? svf.low : svf.high;
        }
        left[i]! += y * g;
      }
      if (!filtered) t = st.toneTarget;
      svf.flush();
      st.gain = g;
      st.toneNow = t;
    }
    right.set(left.subarray(0, n));

    // Punch-in FX on the master; throws feed the reverb and delay buses.
    const sps = this.samplesPerStep;
    this.revIn.fill(0, 0, n);
    this.delIn.fill(0, 0, n);
    const punch = this.punch;
    if (punch.busy) punch.process(left, right, n, blockStart, sps, this.injRev, this.injDel, this.reverb, this.delay);
    else {
      punch.record(left, right, n);
      this.reverb.setDecay(DEFAULT_REVERB_S);
      this.delay.setTime((DEFAULT_DELAY_STEPS * sps) / this.sampleRate);
      this.delay.setFeedback(DEFAULT_DELAY_FB);
    }
    for (let i = 0; i < n; i++) {
      this.revIn[i]! += this.injRev[i]!;
      this.delIn[i]! += this.injDel[i]!;
    }
    this.injRev.fill(0, 0, n);
    this.injDel.fill(0, 0, n);
    this.reverb.process(this.revIn, left, right, n);
    this.delay.process(this.delIn, left, right, n);

    const mg = this.masterGain;
    for (let i = 0; i < n; i++) {
      left[i] = left[i]! * mg;
      right[i] = right[i]! * mg;
    }
    if (this.capL) this.capture(left, right, n, blockStart);
    // Metronome after the capture point: never recorded into resamples.
    const ck = this.click;
    if (ck) {
      let i = this.clickStart >= 0 ? this.clickStart : 0;
      this.clickStart = -1;
      for (; i < n && this.clickPos < ck.length; i++, this.clickPos++) {
        left[i]! += ck[this.clickPos]!;
        right[i]! += ck[this.clickPos]!;
      }
      if (this.clickPos >= ck.length) this.click = null;
    }
    this.limiter.process(left, right, n);

    let mp = this.masterPeak;
    for (let i = 0; i < n; i++) {
      const a = Math.max(Math.abs(left[i]!), Math.abs(right[i]!));
      if (a > mp) mp = a;
    }
    this.masterPeak = mp;
    this.frame = blockEnd;

    this.meterFrames += n;
    if (this.meterFrames >= this.meterEvery) {
      this.meterFrames = 0;
      if (this.playing || this.masterPeak > 1e-4 || this.active !== 0 || this.liveFxCount > 0) {
        let fx = this.laneFx;
        for (let f = 0; f < FX_COUNT; f++) if (this.liveFx[f]) fx = f;
        // Throttled (~30 Hz): the only allocation is the structured clone done by postMessage.
        this.emit({ type: 'meters', master: this.masterPeak, active: this.active, keys: this.meterKeys, fx });
        this.masterPeak = 0;
        this.active = 0;
      }
    }
  }

  private capture(l: Float32Array, r: Float32Array, n: number, f0: number): void {
    const cl = this.capL!;
    for (let i = 0; i < n; i++) {
      if (f0 + i < this.capStart) continue;
      if (this.capPos >= cl.length) break;
      cl[this.capPos++] = (l[i]! + r[i]!) * 0.5;
    }
    if (this.capPos >= cl.length) {
      this.capL = null;
      this.emit({ type: 'resampled', id: this.capId, l: cl });
    }
  }
}
