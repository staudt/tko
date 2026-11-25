// Sample preview: plays a region of a stored sample once with a plain AudioBufferSourceNode (outside the engine),
// so taps and Play are not gated by the finger and recordings can be heard in full.
import { signal } from '@preact/signals';
import { ensureRunning } from '../platform/audio';
import { getSample, type Sample } from '../store/samples';

export type PreviewState = { playing: boolean; startedAt: number; from01: number; to01: number; durS: number; sampleId: string | null; n: number };
export const previewState = signal<PreviewState>({ playing: false, startedAt: 0, from01: 0, to01: 1, durS: 0, sampleId: null, n: 0 });

let cur: { src: AudioBufferSourceNode; gain: GainNode; timer: number } | null = null;
let token = 0;
const bufs = new WeakMap<Sample, AudioBuffer>();

function detach(): void {
  const c = cur;
  cur = null;
  if (!c) return;
  clearTimeout(c.timer);
  c.src.onended = null;
  try {
    c.gain.gain.cancelScheduledValues(0);
    c.src.stop();
  } catch {
    /* already stopped */
  }
  try {
    c.src.disconnect();
    c.gain.disconnect();
  } catch {
    /* ignore */
  }
}

export function stopPreview(): void {
  token++;
  detach();
  if (previewState.peek().playing) previewState.value = { ...previewState.peek(), playing: false };
}

export async function previewSample(sampleId: string, start01 = 0, end01 = 1): Promise<void> {
  const my = ++token;
  detach();
  const ctxP = ensureRunning(); // keep inside the gesture
  const [ctx, smp] = await Promise.all([ctxP, getSample(sampleId)]);
  if (my !== token || !smp || smp.l.length === 0) return;
  const from = Math.min(1, Math.max(0, start01));
  const to = Math.min(1, Math.max(from, end01));
  const dur = smp.l.length / smp.rate;
  const offS = from * dur;
  const durS = (to - from) * dur;
  if (durS < 0.005) return;
  let buf = bufs.get(smp);
  if (!buf) {
    buf = ctx.createBuffer(1, smp.l.length, smp.rate);
    buf.copyToChannel(smp.l as Float32Array<ArrayBuffer>, 0);
    bufs.set(smp, buf);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = 0.9;
  src.connect(gain);
  gain.connect(ctx.destination);
  const done = () => {
    if (cur?.src !== src) return;
    detach();
    previewState.value = { ...previewState.peek(), playing: false };
  };
  src.onended = done;
  const timer = window.setTimeout(done, durS * 1000 + 400);
  cur = { src, gain, timer };
  const at = ctx.currentTime + 0.01;
  src.start(at, offS, durS);
  previewState.value = { playing: true, startedAt: at, from01: from, to01: to, durS, sampleId, n: previewState.peek().n + 1 };
}
