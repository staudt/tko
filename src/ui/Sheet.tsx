import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';

/** Bottom sheet shell: backdrop tap or a downward drag on the header closes it; the body scrolls. */
export function Sheet(p: { open: boolean; onClose: () => void; label: string; title?: ComponentChildren; children: ComponentChildren }) {
  const panel = useRef<HTMLDivElement>(null);
  const st = useRef<{ y: number; dy: number; id: number } | null>(null);
  const reset = () => {
    st.current = null;
    if (panel.current) panel.current.style.transform = '';
  };
  return (
    <div class={`sheet-wrap${p.open ? ' open' : ''}`} aria-hidden={!p.open}>
      <div class="backdrop" data-testid="sheet-backdrop" onPointerDown={p.onClose} />
      <div class="sheet sheet2" ref={panel} role="dialog" aria-label={p.label}>
        <div
          class="sheet-head"
          onPointerDown={(e) => {
            st.current = { y: e.clientY, dy: 0, id: e.pointerId };
            try {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
          }}
          onPointerMove={(e) => {
            const s = st.current;
            if (!s || s.id !== e.pointerId) return;
            s.dy = Math.max(0, e.clientY - s.y);
            if (panel.current) panel.current.style.transform = s.dy ? `translateY(${s.dy}px)` : '';
          }}
          onPointerUp={() => {
            const s = st.current;
            reset();
            if (s && s.dy > 70) p.onClose();
          }}
          onPointerCancel={reset}
        >
          <div class="grab" />
          <h2>{p.title ?? p.label}</h2>
        </div>
        <div class="sheet-body">{p.children}</div>
      </div>
    </div>
  );
}
