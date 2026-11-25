// Dot-matrix strip: a DPR-aware canvas of COLS x ROWS round dots. Off dots are drawn ghosted.
// Redraws only when its content changes (waveform / step / message); driven by one rAF loop.
import { audibleStep, playing } from '../engine/host';
import { project } from '../store/project';
import { getSample } from '../store/samples';
import { editPattern, selectedSound, writeMode } from './../ui/state';
import { currentMessage, extendMessage } from './message';
import { textColumns } from './font';
import { recFlash } from '../ui/recorder';
import { HIST, MAX_RECORD_SECONDS, meter } from '../ui/sampling';

export const COLS = 96;
export const ROWS = 12;
const WAVE_ROWS = 10; // rows 0..9 waveform, row 11 step row

const peaksCache = new Map<string, Float32Array>();
const pending = new Set<string>();

function computePeaks(l: Float32Array): Float32Array {
  const out = new Float32Array(COLS);
  const per = l.length / COLS;
  let max = 1e-6;
  for (let c = 0; c < COLS; c++) {
    let m = 0;
    const a = Math.floor(c * per);
    const b = Math.max(a + 1, Math.floor((c + 1) * per));
    const stride = Math.max(1, Math.floor((b - a) / 64));
    for (let i = a; i < b && i < l.length; i += stride) m = Math.max(m, Math.abs(l[i]!));
    out[c] = m;
    max = Math.max(max, m);
  }
  for (let c = 0; c < COLS; c++) out[c] = Math.sqrt(out[c]! / max);
  return out;
}

function peaksFor(id: string | null): Float32Array | null {
  if (!id) return null;
  const hit = peaksCache.get(id);
  if (hit) return hit;
  if (!pending.has(id)) {
    pending.add(id);
    void getSample(id).then((s) => {
      pending.delete(id);
      if (s) peaksCache.set(id, computePeaks(s.l));
    });
  }
  return null;
}

/** Fills `dots` (COLS*ROWS, 1 = on) for the current state. Returns a signature to detect changes. */
function compose(dots: Uint8Array, now: number): string {
  const fl = now < recFlash.until ? recFlash.step : -1;
  return `${composeInner(dots, now, fl)}:f${fl}`;
}

/** Live recording: scrolling level history (centered bars), progress bar along the bottom, countdown in the last 3 s. */
function composeMeter(dots: Uint8Array): string {
  dots.fill(0);
  const n = Math.min(meter.w, HIST);
  for (let c = 0; c < n; c++) {
    const v = meter.hist[(meter.w - n + c + HIST * 2) % HIST]!;
    const h = Math.max(1, Math.round(Math.sqrt(v) * WAVE_ROWS));
    const top = Math.floor((WAVE_ROWS - h) / 2);
    const x = COLS - n + c;
    for (let r = top; r < top + h; r++) dots[r * COLS + x] = 1;
  }
  const prog = Math.min(COLS, Math.round((meter.elapsed / MAX_RECORD_SECONDS) * COLS));
  for (let c = 0; c < prog; c++) dots[(ROWS - 1) * COLS + c] = 1;
  const left = MAX_RECORD_SECONDS - meter.elapsed;
  if (left <= 3) {
    const cols = textColumns(String(Math.max(1, Math.ceil(left))));
    for (let c = 0; c < cols.length; c++) for (let r = 0; r < 7; r++) if (cols[c]! & (1 << r)) dots[(r + 1) * COLS + 2 + c] = 1;
  }
  return `rec:${meter.w}:${prog}:${Math.ceil(left)}`;
}

function composeInner(dots: Uint8Array, now: number, fl: number): string {
  if (meter.active) return composeMeter(dots);
  dots.fill(0);
  const i = selectedSound.peek();
  const s = project.peek().sounds[i];
  const msg = currentMessage(now);
  const write = writeMode.peek();
  const pat = editPattern.peek();
  const aud = playing.peek() ? audibleStep() : null;
  const step = aud && (!write || aud.pattern === pat) ? aud.step : -1;
  const lane = write ? project.peek().patterns[pat]?.lanes[i] : undefined;
  // step row
  for (let st = 0; st < 16; st++) {
    const x0 = st * 6;
    const on = st === step;
    for (let k = 0; k < 4; k++) dots[(ROWS - 1) * COLS + x0 + 1 + k] = on ? 1 : st % 4 === 0 ? 1 : 0;
    if (on) for (let r = ROWS - 2; r <= ROWS - 1; r++) for (let k = 0; k < 4; k++) dots[r * COLS + x0 + 1 + k] = 1;
    else for (let k = 0; k < 4; k++) dots[(ROWS - 1) * COLS + x0 + 1 + k] = st % 4 === 0 ? 1 : 0;
    // a just-recorded step: a tall block
    if (st === fl) for (let r = ROWS - 5; r <= ROWS - 1; r++) for (let k = 0; k < 4; k++) dots[r * COLS + x0 + 1 + k] = 1;
  }
  if (msg) {
    const cols = textColumns(msg.text);
    const overflow = cols.length - COLS;
    let off = 0;
    if (overflow > 0) {
      extendMessage((overflow + 20) * 28 + 800);
      off = Math.max(0, Math.min(overflow, Math.floor((msg.since - 300) / 28)));
    } else off = Math.floor(overflow / 2);
    for (let c = 0; c < COLS; c++) {
      const m = cols[c + off] ?? 0;
      for (let r = 0; r < 7; r++) if (m & (1 << r)) dots[(r + 1) * COLS + c] = 1;
    }
    return `m${msg.version}:${off}:${step}`;
  }
  if (write) {
    // the selected lane: filled step = big 4x4 block, empty = one dot
    let sg = `e${step}:`;
    for (let st = 0; st < 16; st++) {
      const x0 = st * 6 + 1;
      const filled = !!lane?.[st];
      sg += filled ? '1' : '0';
      if (filled) for (let r = 2; r < 6; r++) for (let k = 0; k < 4; k++) dots[r * COLS + x0 + k] = 1;
      else dots[3 * COLS + x0 + 1] = dots[3 * COLS + x0 + 2] = dots[4 * COLS + x0 + 1] = dots[4 * COLS + x0 + 2] = 1;
    }
    return sg;
  }
  const peaks = peaksFor(s?.sampleId ?? null);
  if (peaks && s) {
    const gap = new Set<number>();
    if (s.kind === 'drum') for (let k = 1; k < s.slices.length - 1; k++) gap.add(Math.round(s.slices[k]! * COLS));
    for (let c = 0; c < COLS; c++) {
      if (gap.has(c)) continue;
      const h = Math.max(1, Math.round(peaks[c]! * WAVE_ROWS));
      const top = Math.floor((WAVE_ROWS - h) / 2);
      for (let r = top; r < top + h; r++) dots[r * COLS + c] = 1;
    }
    // trim markers (melodic): blank everything outside the region
    if (s.kind === 'melodic') {
      const a = Math.round(s.start * COLS);
      const b = Math.round(s.end * COLS);
      for (let c = 0; c < COLS; c++) if (c < a || c >= b) for (let r = 0; r < WAVE_ROWS; r++) dots[r * COLS + c] = 0;
    }
  }
  return `w${i}:${s?.start}:${s?.end}:${peaks ? 1 : 0}:${s?.sampleId}:${step}`;
}

export function startMatrix(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const dots = new Uint8Array(COLS * ROWS);
  let sig = '';
  let cssW = 0;
  let cssH = 0;
  let raf = 0;
  const style = getComputedStyle(canvas);
  const colors = () => ({ on: style.getPropertyValue('--lcd-ink').trim() || '#1b2417', ghost: style.getPropertyValue('--lcd-ghost').trim() || 'rgba(27,36,23,.08)' });

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (Math.abs(r.width - cssW) < 0.5 && Math.abs(r.height - cssH) < 0.5) return false;
    cssW = r.width;
    cssH = r.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    return true;
  };

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const c = colors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const pitch = Math.min(cssW / COLS, cssH / ROWS);
    const rad = pitch * 0.38;
    const ox = (cssW - pitch * COLS) / 2;
    const oy = (cssH - pitch * ROWS) / 2;
    for (const [on, color] of [[0, c.ghost], [1, c.on]] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let r = 0; r < ROWS; r++)
        for (let k = 0; k < COLS; k++) {
          if (dots[r * COLS + k] !== on) continue;
          const x = ox + (k + 0.5) * pitch;
          const y = oy + (r + 0.5) * pitch;
          ctx.moveTo(x + rad, y);
          ctx.arc(x, y, rad, 0, Math.PI * 2);
        }
      ctx.fill();
    }
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const resized = resize();
    const next = compose(dots, now);
    if (resized || next !== sig) {
      sig = next;
      draw();
    }
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
