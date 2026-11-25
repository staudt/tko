// Inline tempo control (the pill in the knob row): drag = tempo, tap = tap tempo, long-press = presets.
import { apply, project } from '../store/project';
import { setBpm, tapTempo } from '../store/edit';
import { lcdMessage } from '../lcd/message';
import { tapCollecting, tapPulse } from './state';

const DEAD_PX = 6;
const PX_PER_BPM = 6;
const TAP_MS = 300;
const LONG_MS = 500;
const TAP_IDLE_MS = 2000;
const PRESETS = [80, 120, 140];

type Press = { pid: number; x: number; t: number; bpm: number; dragging: boolean; long: boolean; timer: ReturnType<typeof setTimeout> | null; n: number };
let press: Press | null = null;
let dragN = 0;
let tapSeq = 0;
let taps: number[] = [];
let tapTimer: ReturnType<typeof setTimeout> | null = null;

/** Next preset after `bpm` in the 80 -> 120 -> 140 -> 80 cycle. */
export function nextPreset(bpm: number): number {
  return PRESETS.find((p) => p > bpm) ?? PRESETS[0]!;
}

/** Tempo for a drag of `dx` pixels from `base`: dead zone, then 1 BPM per 6 px. */
export function dragBpm(base: number, dx: number): number {
  const steps = Math.round(Math.max(0, Math.abs(dx) - DEAD_PX) / PX_PER_BPM);
  return Math.max(30, Math.min(300, base + Math.sign(dx) * steps));
}

export function tempoDown(pid: number, e: PointerEvent): void {
  if (press?.timer) clearTimeout(press.timer);
  const p: Press = { pid, x: e.clientX, t: performance.now(), bpm: project.peek().bpm, dragging: false, long: false, timer: null, n: ++dragN };
  p.timer = setTimeout(() => {
    p.timer = null;
    if (press !== p || p.dragging) return;
    p.long = true;
    const v = nextPreset(project.peek().bpm);
    apply((q) => setBpm(q, v));
    lcdMessage(`${v} BPM`);
  }, LONG_MS);
  press = p;
}

export function tempoMove(pid: number, e: PointerEvent): void {
  const p = press;
  if (!p || p.pid !== pid || p.long) return;
  const dx = e.clientX - p.x;
  if (!p.dragging) {
    if (Math.abs(dx) < DEAD_PX) return;
    p.dragging = true;
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
  }
  const v = dragBpm(p.bpm, dx);
  apply((q) => setBpm(q, v), { merge: `tempo-drag${p.n}` });
}

export function tempoUp(pid: number, cancelled: boolean): void {
  const p = press;
  if (!p || p.pid !== pid) return;
  press = null;
  if (p.timer) clearTimeout(p.timer);
  if (cancelled || p.dragging || p.long) return;
  const now = performance.now();
  if (now - p.t >= TAP_MS) return;
  registerTap(now);
}

function endTaps(): void {
  taps = [];
  tapCollecting.value = false;
  if (tapTimer) clearTimeout(tapTimer);
  tapTimer = null;
}

function registerTap(now: number): void {
  if (taps.length && now - taps[taps.length - 1]! > TAP_IDLE_MS) endTaps();
  if (!taps.length) tapSeq++;
  taps.push(now);
  if (taps.length > 8) taps.shift();
  tapCollecting.value = true;
  tapPulse.value++;
  if (tapTimer) clearTimeout(tapTimer);
  tapTimer = setTimeout(endTaps, TAP_IDLE_MS);
  if (taps.length >= 3) {
    const bpm = tapTempo(taps);
    if (bpm !== null) {
      apply((q) => setBpm(q, bpm), { merge: `taptempo${tapSeq}` });
      lcdMessage(`${bpm} BPM`);
    }
  }
}

export function tempoReset(): void {
  if (press?.timer) clearTimeout(press.timer);
  press = null;
}
