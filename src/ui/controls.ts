// Behaviour of every control (Phase 1). Called by the pointer router.
import { apply, project } from '../store/project';
import { fxPress, playKey, togglePlay } from '../engine/host';
import { FX_DEFAULT_XY, FX_IDS } from '../engine/fx/ids';
import { fxPad, fxXY, heldControls, selectedSound, soundSheetOpen } from './state';
import type { RouterHandlers } from './input/router';
import { lcdMessage } from '../lcd/message';

type PadAction = { t: 'note'; sound: number; key: number } | { t: 'fx'; fx: number } | { t: 'none' };
const padActions = new Map<number, PadAction>();
/** fn/FX buttons currently down: press time and whether anything else was touched meanwhile. */
const fnDown = new Map<string, { t: number; used: boolean }>();

/** Something else was touched: a held SOUND/FX/... is a combo, not a tap. */
export function markUsed(): void {
  for (const f of fnDown.values()) f.used = true;
}

export function selectSound(i: number): void {
  selectedSound.value = i;
  lcdMessage(project.peek().sounds[i]?.name ?? `Sound ${i + 1}`);
}

const TAP_MS = 300;

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
      } else {
        const sound = selectedSound.peek();
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
    // function buttons: remember press time; combos with anything already held make it "used".
    fnDown.set(id, { t: performance.now(), used: h.size > 1 });
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
      return;
    }
    const f = fnDown.get(id);
    fnDown.delete(id);
    if (f && id === 'fn:sound' && !cancelled && !f.used && performance.now() - f.t < TAP_MS) soundSheetOpen.value = true;
  },
  reset() {
    padActions.clear();
    fnDown.clear();
    fxPad.value = null;
  },
};

function markUsedOthers(id: string): void {
  // Pressing a second fn button while another is held makes both combos.
  for (const [k, f] of fnDown) if (k !== id) f.used = true;
}

/** Knob values for the BPM mode. */
export function setBpm(bpm: number): void {
  apply((p) => (p.bpm === bpm ? p : { ...p, bpm }), { merge: 'bpm' });
}
export function setSwing(swing: number): void {
  apply((p) => (p.swing === swing ? p : { ...p, swing }), { merge: 'swing' });
}
