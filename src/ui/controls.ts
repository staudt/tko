// Behaviour of every control (Phase 1 + 2). Called by the pointer router.
import { apply, project } from '../store/project';
import { audibleStep, fxPress, playKey, playing, togglePlay } from '../engine/host';
import { FX_DEFAULT_XY, FX_IDS } from '../engine/fx/ids';
import { chainDraft, bpmSheetOpen, editPattern, fxPad, fxXY, heldStep, heldControls, lastKey, patternSheetOpen, queuedPattern, selectedSound, setLastKey, soundSheetOpen, stepSheet, writeMode } from './state';
import type { RouterHandlers } from './input/router';
import { lcdMessage } from '../lcd/message';
import { getStep, setBpm as editBpm, setChain, setLen, setSwing as editSwing, setVolume, toggleStep } from '../store/edit';
import { chainText, lenBetween } from './stepHelpers';

type PadAction = { t: 'note'; sound: number; key: number } | { t: 'fx'; fx: number } | { t: 'none' };
const padActions = new Map<number, PadAction>();
/** fn/FX buttons currently down: press time and whether anything else was touched meanwhile. */
const fnDown = new Map<string, { t: number; used: boolean }>();
/** Step pads currently down in write mode (insertion order = press order). */
type StepPress = { step: number; t: number; used: boolean; timer: ReturnType<typeof setTimeout> | null; sheet?: boolean };
const stepPress = new Map<number, StepPress>();

const TAP_MS = 300;
const STEP_TAP_MS = 350;
const STEP_HOLD_MS = 450;

/** Something else was touched (a knob turned, another pad): held fn buttons and step pads become combos. */
export function markUsed(): void {
  for (const f of fnDown.values()) f.used = true;
  for (const s of stepPress.values()) s.used = true;
}

function updateHeldStep(): void {
  const first = stepPress.values().next().value as StepPress | undefined;
  heldStep.value = first ? first.step : null;
}

export function selectSound(i: number): void {
  selectedSound.value = i;
  lcdMessage(project.peek().sounds[i]?.name ?? `Sound ${i + 1}`);
}

/** Short note preview (used when a step is turned on and in the step sheet). */
export function audition(sound: number, key: number): void {
  playKey(sound, key, true);
  setTimeout(() => playKey(sound, key, false), 150);
}

function stepDown(step: number, pid: number): void {
  const others = [...stepPress.values()];
  const sound = selectedSound.peek();
  if (others.length) {
    // hold step i + tap step j -> note length
    for (const o of others) o.used = true;
    const i = others[0]!.step;
    const len = lenBetween(i, step);
    const pat = editPattern.peek();
    if (getStep(project.peek(), pat, sound, i)) {
      apply((p) => setLen(p, pat, sound, i, len));
      lcdMessage(`LEN ${len}`);
    }
    stepPress.set(pid, { step, t: performance.now(), used: true, timer: null });
  } else {
    const sp: StepPress = { step, t: performance.now(), used: false, timer: null };
    sp.timer = setTimeout(() => {
      sp.timer = null;
      if (!sp.used && stepPress.get(pid) === sp) {
        sp.used = true;
        sp.sheet = true;
        stepSheet.value = step;
      }
    }, STEP_HOLD_MS);
    stepPress.set(pid, sp);
  }
  updateHeldStep();
}

/** The finger that long-pressed a step lifts over the sheet that just opened: don't let that click hit a sheet button. */
function swallowNextClick(): void {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    off();
  };
  const off = () => window.removeEventListener('click', stop, true);
  window.addEventListener('click', stop, true);
  setTimeout(off, 400);
}

function stepUp(pid: number, cancelled: boolean): void {
  const sp = stepPress.get(pid);
  if (!sp) return;
  stepPress.delete(pid);
  if (sp.timer) clearTimeout(sp.timer);
  updateHeldStep();
  if (sp.sheet) swallowNextClick();
  if (cancelled || sp.used || performance.now() - sp.t >= STEP_TAP_MS) return;
  const sound = selectedSound.peek();
  const pat = editPattern.peek();
  const was = getStep(project.peek(), pat, sound, sp.step);
  const key = lastKey[sound] ?? 0;
  apply((p) => toggleStep(p, pat, sound, sp.step, key));
  if (!was) audition(sound, key);
}

export const handlers: RouterHandlers = {
  down(id, pid) {
    const h = heldControls.peek();
    if (id.startsWith('pad:')) {
      const k = Number(id.slice(4));
      markUsed();
      if (h.has('fn:sound')) {
        selectSound(k);
        padActions.set(pid, { t: 'none' });
      } else if (h.has('btn:fx')) {
        if (k < FX_IDS.length) {
          fxPad.value = k;
          fxXY.value = [...FX_DEFAULT_XY[FX_IDS[k]!]];
          fxPress(k, true);
          padActions.set(pid, { t: 'fx', fx: k });
        } else padActions.set(pid, { t: 'none' });
      } else if (h.has('fn:pattern')) {
        const d = chainDraft.peek();
        if (!d.includes(k)) chainDraft.value = [...d, k];
        padActions.set(pid, { t: 'none' });
      } else if (h.has('fn:bpm')) {
        apply((p) => setVolume(p, (k + 1) / 16));
        lcdMessage(`VOL ${k + 1}`);
        padActions.set(pid, { t: 'none' });
      } else if (writeMode.peek()) {
        stepDown(k, pid);
        padActions.set(pid, { t: 'none' });
      } else {
        const sound = selectedSound.peek();
        setLastKey(sound, k);
        playKey(sound, k, true);
        padActions.set(pid, { t: 'note', sound, key: k });
        try {
          navigator.vibrate?.(8);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (id === 'btn:play') {
      markUsed();
      void togglePlay();
      return;
    }
    if (id === 'btn:write') {
      writeMode.value = !writeMode.peek();
      lcdMessage(writeMode.peek() ? 'WRITE ON' : 'WRITE OFF');
      return;
    }
    // function buttons: remember press time; combos with anything already held make it "used".
    fnDown.set(id, { t: performance.now(), used: h.size > 1 });
    if (id === 'fn:pattern') chainDraft.value = [];
    if (id.startsWith('fn:') || id === 'btn:fx') markUsedOthers(id);
  },
  up(id, pid, cancelled) {
    if (id.startsWith('pad:')) {
      const a = padActions.get(pid);
      padActions.delete(pid);
      if (a?.t === 'note') {
        playKey(a.sound, a.key, false);
      } else if (a?.t === 'fx') {
        fxPress(a.fx, false);
        if (fxPad.peek() === a.fx) fxPad.value = null;
      }
      stepUp(pid, cancelled);
      return;
    }
    const f = fnDown.get(id);
    fnDown.delete(id);
    if (id === 'fn:pattern') commitChain(cancelled);
    if (f && !cancelled && !f.used && performance.now() - f.t < TAP_MS) {
      if (id === 'fn:sound') soundSheetOpen.value = true;
      else if (id === 'fn:pattern') patternSheetOpen.value = true;
      else if (id === 'fn:bpm') bpmSheetOpen.value = true;
    }
  },
  reset() {
    padActions.clear();
    fnDown.clear();
    for (const s of stepPress.values()) if (s.timer) clearTimeout(s.timer);
    stepPress.clear();
    heldStep.value = null;
    chainDraft.value = [];
    fxPad.value = null;
  },
};

function commitChain(cancelled: boolean): void {
  const d = chainDraft.peek();
  chainDraft.value = [];
  if (cancelled || !d.length) return;
  setChainAndEdit(d);
}

/** Apply a chain, edit its first pattern, queue it while playing. */
export function setChainAndEdit(chain: readonly number[]): void {
  apply((p) => setChain(p, chain));
  editPattern.value = chain[0]!;
  lcdMessage(chain.length > 1 ? chainText(chain) : `PATTERN ${chain[0]! + 1}`);
  if (playing.peek()) {
    const a = audibleStep();
    queuedPattern.value = a && a.pattern === chain[0] ? null : chain[0]!;
  }
}

function markUsedOthers(id: string): void {
  // Pressing a second fn button while another is held makes both combos.
  for (const [k, f] of fnDown) if (k !== id) f.used = true;
}

/** Knob values for the BPM mode. */
export function setBpm(bpm: number): void {
  apply((p) => editBpm(p, bpm), { merge: 'bpm' });
}
export function setSwing(swing: number): void {
  apply((p) => editSwing(p, swing), { merge: 'swing' });
}
