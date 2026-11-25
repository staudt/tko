import { useRef } from 'preact/hooks';
import { apply, project } from '../store/project';
import { getStep, setStep, toggleKey } from '../store/edit';
import { editPattern, selectedSound, setLastKey, stepSheet } from './state';
import { Sheet } from './Sheet';
import { audition } from './controls';
import { keyLabel } from './stepHelpers';
import { lcdMessage } from '../lcd/message';

const pad2 = (n: number) => String(n + 1).padStart(2, '0');
const KEY_HOLD_MS = 400;

/** Quick note picker: tap = this step plays only that key (sheet closes), hold = add/remove a chord member. */
export function StepSheet() {
  const step = stepSheet.value;
  const open = step !== null;
  const close = () => (stepSheet.value = null);
  const snd = selectedSound.value;
  const pat = editPattern.value;
  const sound = project.value.sounds[snd];
  const d = step === null ? null : getStep(project.value, pat, snd, step);
  const s = step ?? 0;
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const cancelHold = () => {
    if (hold.current.timer) clearTimeout(hold.current.timer);
    hold.current.timer = null;
  };
  const addToChord = (k: number) => {
    const on = !!getStep(project.peek(), pat, snd, s) && (getStep(project.peek(), pat, snd, s)!.keys & (1 << k)) !== 0;
    apply((p) => toggleKey(p, pat, snd, s, k));
    if (!on) {
      audition(snd, k);
      setLastKey(snd, k);
    }
  };
  const setOnly = (k: number) => {
    apply((p) => setStep(p, pat, snd, s, { ...(getStep(p, pat, snd, s) ?? {}), keys: 1 << k }));
    audition(snd, k);
    setLastKey(snd, k);
    close();
  };
  return (
    <Sheet open={open} onClose={close} label="Step" title={step === null ? 'Step' : `Step ${pad2(step)} · ${sound?.name ?? ''}`}>
      {open && (
        <>
          <p class="hint">Tap = set note · Hold = add to chord</p>
          <div class="keygrid">
            {Array.from({ length: 16 }, (_, k) => {
              const on = !!d && (d.keys & (1 << k)) !== 0;
              return (
                <button
                  key={k}
                  class={`kcell${on ? ' on' : ''}`}
                  data-testid={`key-${k + 1}`}
                  aria-pressed={on}
                  onPointerDown={() => {
                    hold.current.fired = false;
                    cancelHold();
                    hold.current.timer = setTimeout(() => {
                      hold.current.timer = null;
                      hold.current.fired = true;
                      addToChord(k);
                    }, KEY_HOLD_MS);
                  }}
                  onPointerUp={cancelHold}
                  onPointerCancel={cancelHold}
                  onPointerLeave={cancelHold}
                  onClick={() => {
                    if (hold.current.fired) {
                      hold.current.fired = false;
                      return;
                    }
                    setOnly(k);
                  }}
                >
                  <span class="kn">{k + 1}</span>
                  <span class="kl">{keyLabel(sound, k, project.value)}</span>
                </button>
              );
            })}
          </div>
          <button
            class="wide danger"
            disabled={!d}
            onClick={() => {
              apply((p) => setStep(p, pat, snd, s, null));
              lcdMessage('STEP CLEARED');
              close();
            }}
          >
            Clear step
          </button>
        </>
      )}
    </Sheet>
  );
}
