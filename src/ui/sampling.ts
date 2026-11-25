// Phase 4 logic (main thread): mic sampling into a slot, sample processing, import, resample, restore.
// SAMPLE held + pad k records into slot k while both are held; the Sample sheet drives the same pipeline.
import { effect, signal } from '@preact/signals';
import { apply, project, updateSound } from '../store/project';
import { FACTORY_PREFIX } from '../store/defaults';
import { loadFactory } from '../store/factory';
import { MAX_SLOT_SECONDS, MAX_TOTAL_SECONDS, decodeFile, getSample, saveSample, secondsUsed, type Sample, type SampleMeta } from '../store/samples';
import { MAX_RECORD_SECONDS, MicError, startRecording, type RecordingSession } from '../platform/recorder';
import { trimSilence } from '../platform/trim';
import { crop, fadeEdges, limitLength, normalize, reverse } from '../dsp/process';
import { autoSlices, equalSlices } from '../dsp/slice';
import { ensureSample, playKey, playing, resample, togglePlay } from '../engine/host';
import { lcdMessage } from '../lcd/message';
import { sampling, samplingSlot } from './state';
import { onStep } from './stepTicker';
import { showToast } from './toast';

export const HIST = 96;
/** Live meter of the running recording (written by one rAF loop, read by the LCD strip and the sheet). */
export const meter = { active: false, level: 0, elapsed: 0, hist: new Float32Array(HIST), w: 0, last: 0 };

/** Seconds of user audio used by the project (refreshed when the set of sample ids changes). */
export const usedSeconds = signal(0);
let usedKey = '\0';
effect(() => {
  const ids = project.value.sounds.map((s) => s.sampleId);
  const k = ids.join(',');
  if (k === usedKey) return;
  usedKey = k;
  void secondsUsed(ids).then((v) => (usedSeconds.value = v), () => {});
});
const bump = (sec: number) => (usedSeconds.value += sec);

export const memoryFull = (): boolean => usedSeconds.peek() >= MAX_TOTAL_SECONDS;
function blockedByMemory(): boolean {
  if (!memoryFull()) return false;
  lcdMessage('MEMORY FULL');
  showToast(`Sample memory is full (${MAX_TOTAL_SECONDS} s). Clear a slot to make room.`);
  return true;
}

const sid = (slot: number) => `S${slot + 1}`;
const secs = (s: Sample) => (s.l.length / s.rate).toFixed(1);

// ---- microphone sessions -------------------------------------------------------------------------

type Rec = { slot: number; session: RecordingSession | null; stopped: boolean };
let rec: Rec | null = null;
let raf = 0;

export const recordingSlot = (): number => rec?.slot ?? -1;

function micFail(e: unknown): void {
  const reason = e instanceof MicError ? e.reason : 'failed';
  lcdMessage(reason === 'denied' ? 'MIC DENIED' : reason === 'nomic' ? 'NO MIC' : reason === 'unsupported' ? 'REC UNSUPPORTED' : 'MIC ERROR', 2500);
  showToast(e instanceof MicError ? e.message : 'Could not record from the microphone.', 5000);
}

function loop(now: number): void {
  const s = rec?.session;
  if (!s) {
    meter.active = false;
    raf = 0;
    return;
  }
  raf = requestAnimationFrame(loop);
  meter.level = s.level();
  meter.elapsed = s.elapsed();
  if (now - meter.last >= 40) {
    meter.last = now;
    meter.hist[meter.w % HIST] = meter.level;
    meter.w++;
  }
}

/** Start recording into `slot` (from a user gesture). Resolves once the mic is open (or failed). */
export async function beginRecord(slot: number): Promise<void> {
  if (rec || blockedByMemory()) return;
  const r: Rec = { slot, session: null, stopped: false };
  rec = r;
  sampling.value = true;
  samplingSlot.value = slot;
  meter.hist.fill(0);
  meter.w = 0;
  meter.level = meter.elapsed = 0;
  try {
    const session = await startRecording(() => void endRecord());
    if (r.stopped) {
      session.cancel();
      return;
    }
    r.session = session;
    meter.active = true;
    if (!raf) raf = requestAnimationFrame(loop);
  } catch (e) {
    if (rec === r) {
      rec = null;
      sampling.value = false;
      samplingSlot.value = -1;
      meter.active = false;
    }
    r.stopped = true;
    micFail(e);
  }
}

/** Stop the running recording and turn it into the slot's new sample. */
export async function endRecord(): Promise<void> {
  const r = rec;
  if (!r || r.stopped) return;
  r.stopped = true;
  rec = null;
  sampling.value = false;
  samplingSlot.value = -1;
  meter.active = false;
  if (!r.session) return; // still opening: beginRecord cancels it when it arrives
  try {
    const raw = await r.session.stop();
    await finishRecording(r.slot, raw);
  } catch (e) {
    micFail(e);
  }
}

/** Trim silence (keep a little pre-roll), normalize, fade, save and install into the slot. */
export async function finishRecording(slot: number, raw: Sample): Promise<boolean> {
  const t = trimSilence(raw.l, undefined, raw.rate, -45, 20, 40);
  if (!t || t.l.length < raw.rate * 0.03) {
    lcdMessage('NO SOUND');
    showToast('Nothing was recorded. Hold the pad while you make a sound.');
    return false;
  }
  const l = fadeEdges(normalize(limitLength(t.l, raw.rate, MAX_SLOT_SECONDS), -1), raw.rate);
  await installSample(slot, `Rec ${slot + 1}`, { l, rate: raw.rate }, 'record', true);
  return true;
}

/** Saves `s`, makes it the slot's sample as one undo step (drums get auto slices), optionally auditions key 0. */
export async function installSample(slot: number, name: string, s: Sample, source: SampleMeta['source'], audition = false): Promise<void> {
  let id: string;
  try {
    id = await saveSample(name, s, source);
  } catch (e) {
    lcdMessage('SAVE FAILED');
    showToast(`Could not save the sample: ${e instanceof Error ? e.message : 'storage error'}`, 5000);
    return;
  }
  const drum = project.peek().sounds[slot]?.kind === 'drum';
  const slices = drum ? autoSlices(s.l, s.rate, 16) : [];
  apply((p) => updateSound(p, slot, { sampleId: id, name, start: 0, end: 1, slices, hitNames: undefined }));
  bump(s.l.length / s.rate);
  lcdMessage(`SAMPLED ${sid(slot)} ${secs(s)}S`, 2200);
  if (audition) {
    await ensureSample(id);
    setTimeout(() => {
      playKey(slot, 0, true);
      setTimeout(() => playKey(slot, 0, false), 600);
    }, 40);
  }
}

// ---- import / resample ---------------------------------------------------------------------------

export async function importFile(slot: number, file: File): Promise<void> {
  if (blockedByMemory()) return;
  lcdMessage('IMPORTING…');
  try {
    const s = await decodeFile(file);
    const l = fadeEdges(normalize(limitLength(s.l, s.rate, MAX_SLOT_SECONDS), -1), s.rate);
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 16) || `Import ${slot + 1}`;
    await installSample(slot, name, { l, rate: s.rate }, 'file');
    if (s.l.length / s.rate > MAX_SLOT_SECONDS) showToast(`Only the first ${MAX_SLOT_SECONDS} s were kept.`);
  } catch (e) {
    lcdMessage('IMPORT FAILED');
    showToast(`Could not read that file${e instanceof Error && e.message ? `: ${e.message}` : '.'}`, 5000);
  }
}

/** 'idle' | 'waiting' (for the next pattern start) | 'capturing'. */
export const resampleState = signal<'idle' | 'waiting' | 'capturing'>('idle');
/** 0..1 progress of the capture. */
export const resampleProgress = signal(0);

export async function resampleInto(slot: number, patterns: number): Promise<void> {
  if (resampleState.peek() !== 'idle' || blockedByMemory()) return;
  const wasPlaying = playing.peek();
  resampleState.value = wasPlaying ? 'waiting' : 'capturing';
  resampleProgress.value = 0;
  const dur = ((60 / project.peek().bpm) * 4) * patterns;
  let t0 = wasPlaying ? 0 : performance.now();
  const off = onStep(({ step }) => {
    if (resampleState.peek() === 'waiting' && step === 0) {
      resampleState.value = 'capturing';
      t0 = performance.now();
    }
  });
  const timer = setInterval(() => {
    if (resampleState.peek() === 'capturing') resampleProgress.value = Math.min(1, (performance.now() - t0) / 1000 / dur);
  }, 80);
  try {
    const p = resample(patterns);
    if (!wasPlaying) await togglePlay();
    const raw = await p;
    const l = fadeEdges(normalize(limitLength(raw.l, raw.rate, MAX_SLOT_SECONDS), -1), raw.rate);
    await installSample(slot, 'Resample', { l, rate: raw.rate }, 'resample', true);
  } catch (e) {
    lcdMessage('RESAMPLE FAILED');
    showToast(`Resample failed${e instanceof Error ? `: ${e.message}` : '.'}`);
  } finally {
    off();
    clearInterval(timer);
    resampleState.value = 'idle';
  }
}

// ---- editing the current sample ------------------------------------------------------------------

export function setKind(slot: number, kind: 'melodic' | 'drum'): void {
  const s = project.peek().sounds[slot];
  if (!s || s.kind === kind) return;
  apply((p) => updateSound(p, slot, { kind, slices: kind === 'melodic' ? [] : s.slices }));
  if (kind === 'drum' && s.slices.length < 2 && s.sampleId) void sliceCurrent(slot, 'auto', true);
}

export async function sliceCurrent(slot: number, how: 'auto' | 'equal', quiet = false): Promise<void> {
  const s = project.peek().sounds[slot];
  if (!s?.sampleId) return;
  let slices: number[];
  if (how === 'equal') slices = equalSlices(16);
  else {
    const smp = await getSample(s.sampleId);
    if (!smp) return;
    slices = autoSlices(smp.l, smp.rate, 16);
  }
  apply((p) => updateSound(p, slot, { slices }));
  if (!quiet) lcdMessage(how === 'auto' ? 'AUTO SLICED' : 'EQUAL SLICES');
}

async function replaceAudio(slot: number, f: (smp: Sample, start: number, end: number) => Sample, patch: (s: Sample, cur: { start: number; end: number; slices: readonly number[] }) => object, label: string): Promise<void> {
  const cur = project.peek().sounds[slot];
  if (!cur?.sampleId) {
    lcdMessage('EMPTY SLOT');
    return;
  }
  const smp = await getSample(cur.sampleId);
  if (!smp) return;
  const out = f(smp, cur.start, cur.end);
  const id = await saveSample(cur.name, out, 'record');
  apply((p) => updateSound(p, slot, { sampleId: id, ...patch(out, cur) }));
  bump(out.l.length / out.rate);
  lcdMessage(label);
}

export const normalizeSlot = (slot: number) => replaceAudio(slot, (s) => ({ l: normalize(s.l, -1), rate: s.rate }), () => ({}), 'NORMALIZED');

export const reverseSlot = (slot: number) =>
  replaceAudio(
    slot,
    (s) => ({ l: reverse(s.l), rate: s.rate }),
    (_s, c) => ({ start: 1 - c.end, end: 1 - c.start, slices: c.slices.length ? [...c.slices].reverse().map((x) => 1 - x) : [] }),
    'REVERSED',
  );

export const cropSlot = (slot: number) =>
  replaceAudio(slot, (s, a, b) => ({ l: crop(s.l, a, b), rate: s.rate }), () => ({ start: 0, end: 1, slices: [] }), 'CROPPED');

export async function restoreFactory(slot: number): Promise<void> {
  try {
    const f = (await loadFactory()).find((x) => x.slot === slot);
    if (!f) {
      lcdMessage('NO FACTORY SOUND');
      return;
    }
    apply((p) =>
      updateSound(p, slot, {
        sampleId: `${FACTORY_PREFIX}${slot}`,
        name: f.name,
        kind: f.kind,
        root: f.root,
        start: 0,
        end: 1,
        slices: f.kind === 'drum' ? f.slices : [],
        hitNames: f.hitNames,
      }),
    );
    lcdMessage(`RESTORED ${sid(slot)}`);
  } catch {
    lcdMessage('RESTORE FAILED');
    showToast('Could not load the factory sounds.');
  }
}

export function clearSlot(slot: number): void {
  apply((p) => updateSound(p, slot, { sampleId: null, name: `Sound ${slot + 1}`, start: 0, end: 1, slices: [], hitNames: undefined }));
  lcdMessage(`CLEARED ${sid(slot)}`);
}

export { MAX_RECORD_SECONDS };
