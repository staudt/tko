import { useEffect, useRef, useState } from 'preact/hooks';
import { project } from '../store/project';
import { editPattern, eraseSheetOpen, selectedSound } from './state';
import { Sheet } from './Sheet';
import { sheetClearAll, sheetClearFx, sheetClearPattern, sheetClearSound, targetPattern } from './erase';

const pad2 = (n: number) => String(n + 1).padStart(2, '0');

export function EraseSheet() {
  const open = eraseSheetOpen.value;
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setArmed(false);
  };
  useEffect(() => {
    if (!open) disarm();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open]);
  const close = () => {
    disarm();
    eraseSheetOpen.value = false;
  };
  const snd = selectedSound.value;
  editPattern.value;
  const pat = targetPattern(true);
  const name = project.value.sounds[snd]?.name ?? `Sound ${snd + 1}`;
  const run = (f: () => void) => () => {
    f();
    close();
  };
  return (
    <Sheet open={open} onClose={close} label="Erase">
      <div class="erasebtns">
        <button class="bigact danger" data-testid="erase-sound" onClick={run(() => sheetClearSound(targetPattern(), snd))}>
          Clear {name} in pattern {pad2(pat)}
        </button>
        <button class="bigact danger" data-testid="erase-fx" onClick={run(() => sheetClearFx(targetPattern()))}>
          Clear FX in pattern {pad2(pat)}
        </button>
        <button class="bigact danger" data-testid="erase-pattern" onClick={run(() => sheetClearPattern(targetPattern()))}>
          Clear pattern {pad2(pat)}
        </button>
        <button
          class={`bigact danger${armed ? ' armed' : ''}`}
          data-testid="erase-all"
          onClick={() => {
            if (armed) return run(sheetClearAll)();
            setArmed(true);
            timer.current = setTimeout(() => setArmed(false), 3000);
          }}
        >
          {armed ? 'Tap again to clear all 16 patterns' : 'Clear ALL patterns'}
        </button>
      </div>
    </Sheet>
  );
}
