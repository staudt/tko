// Behaviour of every control (Phase 1 + 2). Called by the pointer router.
import { apply, project } from '../store/project';
import { audibleStep, fxPress, playKey, playing, togglePlay } from '../engine/host';
import { FX_DEFAULT_XY, FX_DEFS, FX_IDS } from '../engine/fx/ids';
import { keyActive, keyLabel } from './stepHelpers';
import { chainDraft, eraseSheetOpen, editPattern, fxPad, fxXY, heldStep, heldControls, lastKey, padMode, padPopover, queuedPattern, recHold, sampleSheetOpen, selectedSound, setLastKey, stepSheet, writeMode, type PadMode } from './state';
import type { RouterHandlers } from './input/router';
import { lcdMessage } from '../lcd/message';
import { clearLane, getStep, setBpm as editBpm, setChain, setLen, setSwing as editSwing, setVolume, toggleStep } from '../store/edit';
import { chainText, lenBetween } from './stepHelpers';
import { clearHits, recordFxDown, recordFxUp, recordHit, recordRelease, toggleArm } from './recorder';
import { targetPattern, eraseBegin, eraseFxHeld, eraseLiveStep, eraseSoundHeld, eraseStepHeld } from './erase';
import { onStep } from './stepTicker';
import { beginRecord, endRecord, recordingSlot } from './sampling';
import { setSettings, settings } from './settings';
import { tempoDown, tempoMove, tempoReset, tempoUp } from './tempo';

type PadAction = { t: 'note'; sound: number; key: number } | { t: 'fx'; fx: number } | { t: 'sample'; slot: number } | { t: 'none' };
const padActions = new Map<number, PadAction>();
/** fn/FX buttons currently down: press time and whether anything else was touched meanwhile. */
const fnDown = new Map<string, { t: number; used: boolean }>();
/** Step pads currently down in write mode (insertion order = press order). */
type StepPress = { step: number; t: number; used: boolean; timer: ReturnType<typeof setTimeout> | null; sheet?: boolean };
const stepPress = new Map<number, StepPress>();

/** Pads pressed in the SOUND / PATTERN tabs: a tap acts on release, a long-press opens the popover. */
type TabPress = { mode: 'sound' | 'pattern'; k: number; timer: ReturnType<typeof setTimeout> | null; fired: boolean };
const tabPress = new Map<number, TabPress>();

let recTimer: ReturnType<typeof setTimeout> | null = null;
const TAB_HOLD_MS = 450;
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
  if (!keyActive(project.peek().sounds[sound], key)) return;
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
  down(id, pid, e) {
    const h = heldControls.peek();
    if (id.startsWith('pad:')) {
      const k = Number(id.slice(4));
      markUsed();
      // REC held + pad: pads play as usual and, while playing, the hit is recorded like an armed take.
      if (h.has('btn:rec')) recHold.value = true;
      if (h.has('fn:erase')) {
        // ERASE held + pad: clear that sound (play mode) or that step (write mode). Silent.
        if (writeMode.peek()) eraseStepHeld(k);
        else eraseSoundHeld(k);
        padActions.set(pid, { t: 'none' });
      } else if (h.has('fn:sample')) {
        // SAMPLE held + pad k: record the mic into slot k until either is released.
        if (recordingSlot() < 0) {
          selectedSound.value = k;
          padActions.set(pid, { t: 'sample', slot: k });
          void beginRecord(k);
        } else padActions.set(pid, { t: 'none' });
      } else if (h.has('fn:sound')) {
        selectSound(k);
        padActions.set(pid, { t: 'none' });
      } else if (h.has('btn:write')) {
        // WRITE held + pad: choose the key new steps are written with (and hear it while held).
        const sound = selectedSound.peek();
        if (keyActive(project.peek().sounds[sound], k)) {
          setLastKey(sound, k);
          playKey(sound, k, true);
          padActions.set(pid, { t: 'note', sound, key: k });
          lcdMessage(`WRITE ${keyLabel(project.peek().sounds[sound], k, project.peek()).toUpperCase()}`);
        } else padActions.set(pid, { t: 'none' });
      } else if (h.has('btn:fx')) {
        fxDown(pid, k, e.timeStamp);
      } else if (h.has('fn:pattern')) {
        const d = chainDraft.peek();
        if (!d.includes(k)) chainDraft.value = [...d, k];
        padActions.set(pid, { t: 'none' });
      } else if (h.has('fn:bpm')) {
        apply((p) => setVolume(p, (k + 1) / 16));
        lcdMessage(`VOL ${k + 1}`);
        padActions.set(pid, { t: 'none' });
      } else if (padMode.peek() === 'fx') {
        fxDown(pid, k, e.timeStamp);
      } else if (padMode.peek() === 'sound' || padMode.peek() === 'pattern') {
        tabDown(pid, k, padMode.peek() as 'sound' | 'pattern');
        padActions.set(pid, { t: 'none' });
      } else if (writeMode.peek()) {
        stepDown(k, pid);
        padActions.set(pid, { t: 'none' });
      } else {
        const sound = selectedSound.peek();
        if (!keyActive(project.peek().sounds[sound], k)) {
          padActions.set(pid, { t: 'none' });
          return;
        }
        setLastKey(sound, k);
        playKey(sound, k, true);
        padActions.set(pid, { t: 'note', sound, key: k });
        recordHit(pid, sound, k, e.timeStamp);
        try {
          navigator.vibrate?.(8);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (id === 'tempo') {
      tempoDown(pid, e);
      return;
    }
    if (id === 'btn:play') {
      markUsed();
      void togglePlay();
      return;
    }
    // function buttons: remember press time; combos with anything already held make it "used".
    fnDown.set(id, { t: performance.now(), used: h.size > 1 });
    if (id === 'fn:pattern') chainDraft.value = [];
    if (id === 'btn:rec') {
      if (recTimer) clearTimeout(recTimer);
      recTimer = setTimeout(() => {
        recTimer = null;
        if (heldControls.peek().has('btn:rec')) recHold.value = true;
      }, TAP_MS);
    }
    if (id === 'fn:erase') eraseBegin();
    if (id.startsWith('fn:') || id === 'btn:fx') markUsedOthers(id);
    // ERASE + FX (either order): clear the fx lane.
    if ((id === 'fn:erase' && h.has('btn:fx')) || (id === 'btn:fx' && h.has('fn:erase'))) {
      eraseFxHeld();
      for (const f of fnDown.values()) f.used = true;
    }
  },
  move(id, pid, e) {
    if (id === 'tempo') tempoMove(pid, e);
  },
  up(id, pid, cancelled) {
    if (id === 'tempo') {
      tempoUp(pid, cancelled);
      return;
    }
    if (id.startsWith('pad:')) {
      const a = padActions.get(pid);
      padActions.delete(pid);
      if (a?.t === 'note') {
        playKey(a.sound, a.key, false);
        recordRelease(pid);
      } else if (a?.t === 'sample') {
        void endRecord();
      } else if (a?.t === 'fx') {
        fxPress(a.fx, false);
        recordFxUp(pid);
        if (fxPad.peek() === a.fx) {
          // knobs follow the most recently pressed effect that is still held
          const rest = [...padActions.values()].filter((x): x is { t: 'fx'; fx: number } => x.t === 'fx');
          const prev = rest.at(-1)?.fx ?? null;
          fxPad.value = prev;
          if (prev !== null) fxXY.value = [...FX_DEFAULT_XY[FX_IDS[prev]!]];
        }
      }
      tabUp(pid, cancelled);
      stepUp(pid, cancelled);
      return;
    }
    const f = fnDown.get(id);
    fnDown.delete(id);
    if (id === 'btn:rec') {
      if (recTimer) clearTimeout(recTimer);
      recTimer = null;
      recHold.value = false;
    }
    if (id === 'fn:sample') for (const a of padActions.values()) if (a.t === 'sample') void endRecord();
    if (id === 'fn:pattern') commitChain(cancelled);
    if (f && !cancelled && !f.used && performance.now() - f.t < TAP_MS) {
      if (id === 'fn:sound') setPadMode('sound');
      else if (id === 'fn:pattern') setPadMode('pattern');
      else if (id === 'fn:bpm') {
        setSettings({ metro: !settings.peek().metro });
        lcdMessage(settings.peek().metro ? 'METRO ON' : 'METRO OFF');
      }
      else if (id === 'fn:sample') sampleSheetOpen.value = true;
      else if (id === 'fn:erase') eraseSheetOpen.value = true;
    }
    if (id === 'btn:rec' && f && !cancelled && !f.used && performance.now() - f.t < TAP_MS) toggleArm();
    if (id === 'btn:fx' && f && !cancelled && !f.used && performance.now() - f.t < TAP_MS) setPadMode('fx');
    // WRITE toggles on a tap; held with a pad it chose the write key instead.
    if (id === 'btn:write' && f && !cancelled && !f.used) {
      writeMode.value = !writeMode.peek();
      if (writeMode.peek()) setPadMode('play');
      lcdMessage(writeMode.peek() ? 'WRITE ON' : 'WRITE OFF');
    }
  },
  reset() {
    void endRecord();
    tempoReset();
    padActions.clear();
    clearHits();
    fnDown.clear();
    if (recTimer) clearTimeout(recTimer);
    recTimer = null;
    recHold.value = false;
    for (const s of stepPress.values()) if (s.timer) clearTimeout(s.timer);
    stepPress.clear();
    heldStep.value = null;
    for (const t of tabPress.values()) if (t.timer) clearTimeout(t.timer);
    tabPress.clear();
    padPopover.value = null;
    chainDraft.value = [];
    fxPad.value = null;
  },
};

/** Live erase: ERASE held alone (past the tap threshold) while playing clears the selected sound's step as the playhead passes. */
onStep(({ step, pattern }) => {
  const f = fnDown.get('fn:erase');
  if (!f || f.used || performance.now() - f.t < TAP_MS || !heldControls.peek().has('fn:erase')) return;
  eraseLiveStep(pattern, step);
});

/** Tap a latching tab: switch to its mode, or back to play when it is already active. */
export function setPadMode(m: PadMode): void {
  const next = padMode.peek() === m ? 'play' : m;
  padMode.value = next;
  padPopover.value = null;
}

/** FX pad pressed (FX held, or the FX tab): effect on while held; knobs follow the latest. */
function fxDown(pid: number, k: number, ts: number): void {
  if (k < FX_DEFS.length && k < FX_IDS.length) {
    fxPad.value = k;
    fxXY.value = [...FX_DEFAULT_XY[FX_IDS[k]!]];
    fxPress(k, true);
    padActions.set(pid, { t: 'fx', fx: k });
    recordFxDown(pid, k, ts);
  } else padActions.set(pid, { t: 'none' });
}

function tabDown(pid: number, k: number, mode: 'sound' | 'pattern'): void {
  padPopover.value = null;
  const tp: TabPress = { mode, k, timer: null, fired: false };
  tp.timer = setTimeout(() => {
    tp.timer = null;
    tp.fired = true;
    padPopover.value = { kind: mode, k };
  }, TAB_HOLD_MS);
  tabPress.set(pid, tp);
}

function tabUp(pid: number, cancelled: boolean): void {
  const tp = tabPress.get(pid);
  if (!tp) return;
  tabPress.delete(pid);
  if (tp.timer) clearTimeout(tp.timer);
  if (cancelled || tp.fired) return;
  if (tp.mode === 'sound') {
    selectSound(tp.k);
    audition(tp.k, 0);
    padMode.value = 'play';
  } else {
    // A tap plays that one pattern (switching at the end of the current one while playing).
    // Chains are built only by holding PATTERN and tapping pads in order.
    setChainAndEdit([tp.k]);
  }
}

/** Popover actions. */
export function popoverClearSound(k: number): void {
  const pat = targetPattern();
  apply((p) => clearLane(p, pat, k));
  lcdMessage(`CLEAR S${String(k + 1).padStart(2, '0')} P${String(pat + 1).padStart(2, '0')}`);
}
export function popoverEditSample(k: number): void {
  selectedSound.value = k;
  sampleSheetOpen.value = true;
  padMode.value = 'play';
}

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
