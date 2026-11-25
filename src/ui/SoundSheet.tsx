import { useRef } from 'preact/hooks';
import { project } from '../store/project';
import { selectedSound, soundSheetOpen } from './state';
import { selectSound } from './controls';

export function SoundSheet() {
  const open = soundSheetOpen.value;
  const panel = useRef<HTMLDivElement>(null);
  const st = useRef<{ y: number; dy: number; id: number } | null>(null);
  const moved = useRef(false);
  const close = () => (soundSheetOpen.value = false);
  const sounds = project.value.sounds;
  return (
    <div class={`sheet-wrap${open ? ' open' : ''}`} aria-hidden={!open}>
      <div class="backdrop" data-testid="sheet-backdrop" onPointerDown={close} />
      <div
        class="sheet"
        ref={panel}
        role="dialog"
        aria-label="Sounds"
        onPointerDown={(e) => {
          st.current = { y: e.clientY, dy: 0, id: e.pointerId };
          moved.current = false;
        }}
        onPointerMove={(e) => {
          const s = st.current;
          if (!s || s.id !== e.pointerId) return;
          s.dy = Math.max(0, e.clientY - s.y);
          if (s.dy > 8) moved.current = true;
          if (panel.current) panel.current.style.transform = s.dy ? `translateY(${s.dy}px)` : '';
        }}
        onPointerUp={() => {
          const s = st.current;
          st.current = null;
          if (panel.current) panel.current.style.transform = '';
          if (s && s.dy > 70) close();
        }}
        onPointerCancel={() => {
          st.current = null;
          if (panel.current) panel.current.style.transform = '';
        }}
      >
        <div class="grab" />
        <h2>Sounds</h2>
        <div class="cards">
          {sounds.map((s, i) => (
            <button
              key={i}
              class={`card${i === selectedSound.value ? ' sel' : ''}`}
              data-testid={`card-${i + 1}`}
              onClick={() => {
                if (moved.current) return;
                selectSound(i);
                close();
              }}
            >
              <span class="cn">{String(i + 1).padStart(2, '0')}</span>
              <span class="cname">{s.name}</span>
              <span class={`badge ${s.kind}`}>{s.kind === 'melodic' ? 'melodic' : 'drum'}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
