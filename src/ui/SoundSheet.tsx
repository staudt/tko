import { useRef, useState } from 'preact/hooks';
import { apply, project } from '../store/project';
import { clearLane, setKey, setScale } from '../store/edit';
import { KEY_NAMES, SCALES, SCALE_IDS } from '../store/scales';
import { editPattern, selectedSound, soundSheetOpen } from './state';
import { selectSound } from './controls';
import { lcdMessage } from '../lcd/message';
import { Sheet } from './Sheet';

const CARD_HOLD_MS = 400;
const pad2 = (n: number) => String(n + 1).padStart(2, '0');

export function SoundSheet() {
  const open = soundSheetOpen.value;
  const close = () => {
    soundSheetOpen.value = false;
    setPicker(null);
    setMenu(null);
  };
  const [picker, setPicker] = useState<'key' | 'scale' | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const p = project.value;
  const pat = editPattern.value;
  const scaleName = SCALES[p.scale].name;

  const pickKey = (k: number) => {
    apply((q) => setKey(q, k));
    const s = project.peek();
    lcdMessage(`KEY ${KEY_NAMES[s.key]} ${SCALES[s.scale].name}`);
    setPicker(null);
  };
  const pickScale = (id: (typeof SCALE_IDS)[number]) => {
    apply((q) => setScale(q, id));
    const s = project.peek();
    lcdMessage(`KEY ${KEY_NAMES[s.key]} ${SCALES[s.scale].name}`);
    setPicker(null);
  };
  const cancelHold = () => {
    if (hold.current.timer) clearTimeout(hold.current.timer);
    hold.current.timer = null;
  };

  return (
    <Sheet open={open} onClose={close} label="Sounds">
      {open && (
        <>
          <div class="tune">
            <button class={`chip${picker === 'key' ? ' open' : ''}`} data-testid="chip-key" onClick={() => setPicker(picker === 'key' ? null : 'key')}>
              <small>Key</small>
              <b>{KEY_NAMES[p.key]}</b>
            </button>
            <button class={`chip${picker === 'scale' ? ' open' : ''}`} data-testid="chip-scale" onClick={() => setPicker(picker === 'scale' ? null : 'scale')}>
              <small>Scale</small>
              <b>{scaleName}</b>
            </button>
          </div>
          {picker === 'key' && (
            <div class="optgrid" data-testid="key-options">
              {KEY_NAMES.map((n, k) => (
                <button key={n} class={`opt${p.key === k ? ' sel' : ''}`} data-testid={`opt-key-${k}`} onClick={() => pickKey(k)}>
                  {n}
                </button>
              ))}
            </div>
          )}
          {picker === 'scale' && (
            <div class="optgrid scales" data-testid="scale-options">
              {SCALE_IDS.map((id) => (
                <button key={id} class={`opt${p.scale === id ? ' sel' : ''}`} data-testid={`opt-scale-${id}`} onClick={() => pickScale(id)}>
                  {SCALES[id].name}
                </button>
              ))}
            </div>
          )}
          <div class="cards">
            {p.sounds.map((s, i) => (
              <button
                key={i}
                class={`card${i === selectedSound.value ? ' sel' : ''}`}
                data-testid={`card-${i + 1}`}
                onPointerDown={() => {
                  hold.current.fired = false;
                  cancelHold();
                  hold.current.timer = setTimeout(() => {
                    hold.current.timer = null;
                    hold.current.fired = true;
                    setMenu(i);
                  }, CARD_HOLD_MS);
                }}
                onPointerUp={cancelHold}
                onPointerCancel={cancelHold}
                onPointerLeave={cancelHold}
                onClick={() => {
                  if (hold.current.fired) {
                    hold.current.fired = false;
                    return;
                  }
                  selectSound(i);
                  close();
                }}
              >
                <span class="cn">{pad2(i)}</span>
                <span class="cname">{s.name}</span>
                <span class={`badge ${s.kind}`}>{s.kind === 'melodic' ? 'melodic' : 'drum'}</span>
              </button>
            ))}
          </div>
          {menu !== null && (
            <div class="cardmenu" data-testid="card-menu">
              <span>
                {pad2(menu)} {p.sounds[menu]?.name}
              </span>
              <button
                class="wide danger"
                data-testid="clear-lane"
                onClick={() => {
                  const snd = menu;
                  apply((q) => clearLane(q, pat, snd));
                  lcdMessage('CLEARED');
                  setMenu(null);
                }}
              >
                Clear in pattern {pad2(pat)}
              </button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
