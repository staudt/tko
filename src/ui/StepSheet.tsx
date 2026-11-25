import { useRef } from 'preact/hooks';
import { apply, project } from '../store/project';
import { getStep, setLen, setLock, setStep, toggleKey } from '../store/edit';
import { editPattern, selectedSound, stepSheet } from './state';
import { Sheet } from './Sheet';
import { audition } from './controls';
import { keyLabel, knobToPitch, knobToTone } from './stepHelpers';
import { lcdMessage } from '../lcd/message';

const pad2 = (n: number) => String(n + 1).padStart(2, '0');

export function StepSheet() {
  const step = stepSheet.value;
  const open = step !== null;
  const close = () => (stepSheet.value = null);
  const snd = selectedSound.value;
  const pat = editPattern.value;
  const sound = project.value.sounds[snd];
  const d = step === null ? null : getStep(project.value, pat, snd, step);
  const drag = useRef(0);
  const s = step ?? 0;
  const lockSlider = (which: 'A' | 'B') => {
    const val = which === 'A' ? d?.lockA : d?.lockB;
    const min = which === 'A' ? -12 : -100;
    const max = which === 'A' ? 12 : 100;
    const text = val === undefined ? 'off' : which === 'A' ? `${val > 0 ? '+' : ''}${val} st` : val === 0 ? 'open' : `${val < 0 ? 'LP' : 'HP'} ${Math.abs(val)}`;
    return (
      <div class="lockrow">
        <span class="lk-name">{which === 'A' ? 'Pitch' : 'Tone'}</span>
        <input
          type="range"
          class={val === undefined ? 'unset' : ''}
          min={min}
          max={max}
          step={1}
          value={val ?? 0}
          disabled={!d}
          aria-label={`Lock ${which === 'A' ? 'pitch' : 'tone'}`}
          data-testid={`lock-${which.toLowerCase()}`}
          onPointerDown={() => drag.current++}
          onInput={(e) => {
            const v = Number((e.currentTarget as HTMLInputElement).value);
            const conv = which === 'A' ? knobToPitch((v + 12) / 24) : knobToTone((v + 100) / 200);
            apply((p) => setLock(p, pat, snd, s, which, which === 'A' ? conv : v), { merge: `sl${which}:${snd}:${s}:${drag.current}` });
          }}
        />
        <span class="lk-val">{text}</span>
        <button class="mini" aria-label={`Reset lock ${which}`} disabled={val === undefined} onClick={() => apply((p) => setLock(p, pat, snd, s, which, null))}>
          reset
        </button>
      </div>
    );
  };
  return (
    <Sheet open={open} onClose={close} label="Step" title={step === null ? 'Step' : `Step ${pad2(step)} · ${sound?.name ?? ''}`}>
      {open && (
        <>
          <div class="keygrid">
            {Array.from({ length: 16 }, (_, k) => {
              const on = !!d && (d.keys & (1 << k)) !== 0;
              return (
                <button
                  key={k}
                  class={`kcell${on ? ' on' : ''}`}
                  data-testid={`key-${k + 1}`}
                  aria-pressed={on}
                  onClick={() => {
                    apply((p) => toggleKey(p, pat, snd, s, k));
                    if (!on) audition(snd, k);
                  }}
                >
                  <span class="kn">{k + 1}</span>
                  <span class="kl">{keyLabel(sound, k)}</span>
                </button>
              );
            })}
          </div>
          <div class="lenrow">
            <span class="lk-name">Length</span>
            <button class="mini sq" aria-label="Shorter" disabled={!d} onClick={() => apply((p) => setLen(p, pat, snd, s, ((d?.len ?? 0) + 16) % 17))}>
              −
            </button>
            <span class="lenval" data-testid="len-val">
              {d?.len ? `${d.len} step${d.len > 1 ? 's' : ''}` : 'Natural'}
            </span>
            <button class="mini sq" aria-label="Longer" disabled={!d} onClick={() => apply((p) => setLen(p, pat, snd, s, ((d?.len ?? 0) + 1) % 17))}>
              +
            </button>
          </div>
          {lockSlider('A')}
          {lockSlider('B')}
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
