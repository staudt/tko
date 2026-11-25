import { useRef } from 'preact/hooks';
import { apply, project } from '../store/project';
import { setBpm, setSwing, setVolume, tapTempo } from '../store/edit';
import { bpmSheetOpen } from './state';
import { Sheet } from './Sheet';
import { lcdMessage } from '../lcd/message';

const taps: number[] = [];

export function BpmSheet() {
  const open = bpmSheetOpen.value;
  const p = project.value;
  const rep = useRef<{ delay: ReturnType<typeof setTimeout> | null; iv: ReturnType<typeof setInterval> | null }>({ delay: null, iv: null });
  const drag = useRef<{ id: number; x: number; bpm: number } | null>(null);
  const dragN = useRef(0);
  const tapEl = useRef<HTMLDivElement>(null);

  const nudge = (d: number) => apply((q) => setBpm(q, q.bpm + d), { merge: 'bpm-sheet' });
  const stopRep = () => {
    if (rep.current.delay) clearTimeout(rep.current.delay);
    if (rep.current.iv) clearInterval(rep.current.iv);
    rep.current = { delay: null, iv: null };
  };
  const holdBtn = (d: number, label: string, text: string) => (
    <button
      class="mini big"
      aria-label={label}
      data-testid={`bpm-${d > 0 ? 'up' : 'down'}`}
      onPointerDown={(e) => {
        stopRep();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        dragN.current++;
        apply((q) => setBpm(q, q.bpm + d), { merge: `bpm-nudge${dragN.current}` });
        rep.current.delay = setTimeout(() => (rep.current.iv = setInterval(() => nudge(d), 70)), 380);
      }}
      onPointerUp={stopRep}
      onPointerCancel={stopRep}
      onLostPointerCapture={stopRep}
    >
      {text}
    </button>
  );

  return (
    <Sheet
      open={open}
      onClose={() => {
        stopRep();
        bpmSheetOpen.value = false;
      }}
      label="Tempo"
    >
      <div class="bpmrow">
        {holdBtn(-1, 'Slower', '−')}
        <div
          class="bpmread"
          data-testid="bpm-read"
          onPointerDown={(e) => {
            drag.current = { id: e.pointerId, x: e.clientX, bpm: project.peek().bpm };
            dragN.current++;
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId) return;
            const v = Math.round(d.bpm + (e.clientX - d.x) / 4);
            apply((q) => setBpm(q, v), { merge: `bpm-drag${dragN.current}` });
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <span class="bpmnum">{p.bpm}</span>
          <span class="bpmunit">BPM · drag</span>
        </div>
        {holdBtn(1, 'Faster', '+')}
      </div>
      <div class="presets">
        {[80, 120, 140].map((b) => (
          <button key={b} class={`mini big${p.bpm === b ? ' on' : ''}`} data-testid={`preset-${b}`} onClick={() => apply((q) => setBpm(q, b))}>
            {b}
          </button>
        ))}
      </div>
      <div
        class="tappad"
        ref={tapEl}
        role="button"
        aria-label="Tap tempo"
        data-testid="tap-pad"
        onPointerDown={() => {
          const now = performance.now();
          if (taps.length && now - taps[taps.length - 1]! > 2000) taps.length = 0;
          taps.push(now);
          if (taps.length > 8) taps.shift();
          const bpm = tapTempo(taps);
          tapEl.current?.classList.remove('hit');
          void tapEl.current?.offsetWidth;
          tapEl.current?.classList.add('hit');
          if (bpm !== null) {
            apply((q) => setBpm(q, bpm), { merge: 'bpm-tap' });
            lcdMessage(`${bpm} BPM`);
          }
        }}
      >
        TAP
      </div>
      <div class="lockrow">
        <span class="lk-name">Swing</span>
        <input type="range" min={50} max={75} step={1} value={p.swing} aria-label="Swing" data-testid="swing-slider" onInput={(e) => apply((q) => setSwing(q, Number((e.currentTarget as HTMLInputElement).value)), { merge: 'swing-sheet' })} />
        <span class="lk-val">{p.swing}%</span>
      </div>
      <div class="lockrow">
        <span class="lk-name">Volume</span>
        <input type="range" min={0} max={100} step={1} value={Math.round(p.volume * 100)} aria-label="Master volume" data-testid="vol-slider" onInput={(e) => apply((q) => setVolume(q, Number((e.currentTarget as HTMLInputElement).value) / 100), { merge: 'vol-sheet' })} />
        <span class="lk-val">{Math.round(p.volume * 100)}%</span>
      </div>
    </Sheet>
  );
}
