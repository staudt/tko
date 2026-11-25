// Main-thread side of the engine: owns the AudioContext and the worklet node, mirrors the project
// store into engine commands (diff by identity), and exposes playhead / activity for rAF readers.
// Adapted from groovebox's host (same author).
import { effect, signal } from '@preact/signals';
import workletUrl from './worklet.ts?worker&url';
import type { EngineCommand, EngineEvent } from './protocol';
import { project } from '../store/project';
import { packPattern, soundParams } from '../store/pack';
import type { Project } from '../store/types';
import { getSample } from '../store/samples';
import { ensureRunning, getAudioContext } from '../platform/audio';

let node: AudioWorkletNode | null = null;
let starting: Promise<void> | null = null;

export const playing = signal(false);
/** True once the audio engine is running (after the first gesture). */
export const audioReady = signal(false);

// Recent step events, read by rAF code (never triggers renders).
const RING = 32;
const ringTime = new Float64Array(RING);
const ringStep = new Int32Array(RING).fill(-1);
const ringPat = new Int32Array(RING);
const ringChain = new Int32Array(RING);
let ringW = 0;

/** Latest meters: master peak and the sounds triggered recently (bit s), decayed by readers. */
export const meters = { master: 0, active: 0, activeAt: new Float64Array(16) };

/** Test builds record every command sent (Playwright reads window.__tko.commands). */
const testLog: EngineCommand[] | null = import.meta.env.MODE === 'test' ? [] : null;
if (testLog) (globalThis as unknown as { __tko: unknown }).__tko = { commands: testLog };

function post(cmd: EngineCommand, transfer?: Transferable[]): void {
  if (!node) return;
  if (testLog && cmd.type !== 'sample') testLog.push(cmd);
  if (transfer) node.port.postMessage(cmd, transfer);
  else node.port.postMessage(cmd);
}

const pendingResamples = new Map<string, (l: Float32Array) => void>();

function onEvent(ev: EngineEvent): void {
  if (ev.type === 'step') {
    if (ev.step < 0) {
      ringStep.fill(-1);
      return;
    }
    ringTime[ringW] = ev.time;
    ringStep[ringW] = ev.step;
    ringPat[ringW] = ev.pattern;
    ringChain[ringW] = ev.chainPos;
    ringW = (ringW + 1) % RING;
  } else if (ev.type === 'meters') {
    meters.master = ev.master;
    meters.active = ev.active;
    const now = performance.now();
    for (let s = 0; s < 16; s++) if (ev.active & (1 << s)) meters.activeAt[s] = now;
  } else if (ev.type === 'resampled') {
    pendingResamples.get(ev.id)?.(ev.l);
    pendingResamples.delete(ev.id);
  }
}

function heardNow(): number {
  const ctx = getAudioContext();
  return ctx.currentTime - (ctx.outputLatency || 0);
}

/** The step currently heard: { step 0..15, pattern, chainPos, at (context time of the step) } or null when stopped. */
export function audibleStep(): { step: number; pattern: number; chainPos: number; at: number } | null {
  if (!node) return null;
  const now = heardNow();
  let best = -1;
  for (let i = 0; i < RING; i++) {
    if (ringStep[i]! >= 0 && ringTime[i]! <= now && (best < 0 || ringTime[i]! > ringTime[best]!)) best = i;
  }
  return best < 0 ? null : { step: ringStep[best]!, pattern: ringPat[best]!, chainPos: ringChain[best]!, at: ringTime[best]! };
}

// Samples already sent to the engine.
const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();

export function ensureSample(id: string | null): Promise<void> {
  if (!id || loaded.has(id)) return Promise.resolve();
  let p = loading.get(id);
  if (!p) {
    p = getSample(id).then((s) => {
      loading.delete(id);
      if (!s || !node) return;
      // A copy is transferred so the main-thread cache stays usable (waveforms).
      const l = s.l.slice();
      post({ type: 'sample', id, l, rate: s.rate }, [l.buffer]);
      loaded.add(id);
    });
    loading.set(id, p);
  }
  return p;
}

function syncAll(p: Project): void {
  post({ type: 'tempo', bpm: p.bpm, swing: p.swing });
  post({ type: 'volume', gain: p.volume });
  p.patterns.forEach((pat, i) => post({ type: 'pattern', index: i, data: packPattern(pat) }));
  post({ type: 'chain', patterns: [...p.chain], now: true });
  p.sounds.forEach((s, i) => {
    post({ type: 'sound', params: soundParams(s, i) });
    void ensureSample(s.sampleId).then(() => post({ type: 'sound', params: soundParams(project.peek().sounds[i]!, i) }));
  });
}

function startSync(): void {
  let prev: Project | null = null;
  effect(() => {
    const p = project.value;
    if (!prev) syncAll(p);
    else {
      if (p.bpm !== prev.bpm || p.swing !== prev.swing) post({ type: 'tempo', bpm: p.bpm, swing: p.swing });
      if (p.volume !== prev.volume) post({ type: 'volume', gain: p.volume });
      if (p.patterns !== prev.patterns) p.patterns.forEach((pat, i) => pat !== prev!.patterns[i] && post({ type: 'pattern', index: i, data: packPattern(pat) }));
      if (p.chain !== prev.chain) post({ type: 'chain', patterns: [...p.chain] });
      if (p.sounds !== prev.sounds)
        p.sounds.forEach((s, i) => {
          if (s === prev!.sounds[i]) return;
          const sampleChanged = s.sampleId !== prev!.sounds[i]?.sampleId;
          post({ type: 'sound', params: soundParams(s, i) });
          if (sampleChanged) void ensureSample(s.sampleId).then(() => post({ type: 'sound', params: soundParams(project.peek().sounds[i]!, i) }));
        });
    }
    prev = p;
  });
  effect(() => {
    if (!playing.value) ringStep.fill(-1);
    post({ type: 'transport', playing: playing.value });
  });
}

/** Call from a user gesture. Creates the context and engine on first call; safe to call repeatedly. */
export function startAudio(): Promise<void> {
  if (!starting) {
    starting = (async () => {
      const ctx = await ensureRunning();
      await ctx.audioWorklet.addModule(workletUrl);
      node = new AudioWorkletNode(ctx, 'tko-engine', { numberOfInputs: 0, outputChannelCount: [2] });
      node.port.onmessage = (e: MessageEvent<EngineEvent>) => onEvent(e.data);
      node.connect(ctx.destination);
      startSync();
      audioReady.value = true;
    })();
    starting.catch(() => (starting = null));
  } else void ensureRunning();
  return starting!;
}

export async function togglePlay(): Promise<void> {
  await startAudio();
  playing.value = !playing.value;
}

/** Live pad press/release. Must be called synchronously from the pointer handler for minimum latency. */
export function playKey(sound: number, key: number, on: boolean, vel = 100): void {
  const id = sound * 16 + key;
  if (!node) {
    // Engine still starting (first touch): play the note once it is up; a release that came in
    // meanwhile is sent right after, so nothing sticks.
    if (on) {
      earlyHeld.add(id);
      void startAudio().then(() => {
        post({ type: 'play', sound, key, on: true, vel });
        if (!earlyHeld.has(id)) post({ type: 'play', sound, key, on: false });
      });
    } else earlyHeld.delete(id);
    return;
  }
  post({ type: 'play', sound, key, on, vel });
}
const earlyHeld = new Set<number>();

export function fxPress(fx: number, on: boolean): void {
  post({ type: 'fx', fx, on });
}

export function fxKnob(fx: number, x: number, y: number): void {
  post({ type: 'fxKnob', fx, x, y });
}

/** Release every note and effect at once (lost touches, app hidden). */
export function panic(): void {
  post({ type: 'panic' });
}

/** Records `patterns` patterns of the master output; starts at the next pattern start while playing. */
export async function resample(patterns = 1): Promise<{ l: Float32Array; rate: number }> {
  await startAudio();
  const ctx = getAudioContext();
  const frames = Math.round(((ctx.sampleRate * 60) / project.peek().bpm) * 4 * patterns);
  const id = `r${Date.now().toString(36)}`;
  const l = new Float32Array(frames);
  return new Promise((resolve) => {
    pendingResamples.set(id, (out) => resolve({ l: out, rate: ctx.sampleRate }));
    post({ type: 'resample', id, l }, [l.buffer]);
  });
}
