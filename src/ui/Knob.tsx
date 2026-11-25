import { useRef } from 'preact/hooks';

const DRAG_PX = 160; // full range
const START = 135; // degrees, 270 degree sweep clockwise
const SWEEP = 270;
const R = 40;
const CIRC = 2 * Math.PI * R;
const pt = (deg: number, r: number): [number, number] => [50 + r * Math.cos((deg * Math.PI) / 180), 50 + r * Math.sin((deg * Math.PI) / 180)];
const TICKS = Array.from({ length: 21 }, (_, i) => {
  const a = START + (SWEEP * i) / 20;
  const [x1, y1] = pt(a, 44);
  const [x2, y2] = pt(a, i % 5 === 0 ? 38.5 : 41);
  return { x1, y1, x2, y2, major: i % 5 === 0 };
});

export type KnobProps = {
  letter: string;
  label: string;
  /** 0..1 */
  value: number;
  def: number;
  disabled?: boolean;
  /** `first` is true for the first change of a drag (or a reset). */
  onChange: (v: number, first: boolean) => void;
  testId?: string;
};

/** Generic knob: drag vertically or horizontally (160 px = full range); double-tap resets. Owns its pointer. */
export function Knob(p: KnobProps) {
  const drag = useRef<{ id: number; y: number; x: number; v: number; first: boolean; moved: boolean } | null>(null);
  const lastTap = useRef(0);
  const v = Math.min(1, Math.max(0, p.value));
  const sweepLen = (CIRC * SWEEP) / 360;
  const angle = START + SWEEP * v;
  const [ix, iy] = pt(angle, 22);
  const [ox, oy] = pt(angle, 12);

  return (
    <div
      class={`knob${p.disabled ? ' off' : ''}`}
      role="slider"
      aria-label={p.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-disabled={p.disabled}
      data-testid={p.testId}
      onPointerDown={(e) => {
        if (p.disabled || drag.current) return;
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        drag.current = { id: e.pointerId, y: e.clientY, x: e.clientX, v, first: true, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        if (!d.moved && Math.abs(d.y - e.clientY) + Math.abs(e.clientX - d.x) < 3) return;
        d.moved = true;
        const delta = (d.y - e.clientY + (e.clientX - d.x)) / DRAG_PX;
        p.onChange(Math.min(1, Math.max(0, d.v + delta)), d.first);
        d.first = false;
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        drag.current = null;
        if (d.moved) return;
        const now = performance.now();
        if (now - lastTap.current < 320) {
          p.onChange(p.def, true);
          lastTap.current = 0;
        } else lastTap.current = now;
      }}
      onPointerCancel={() => (drag.current = null)}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        {TICKS.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} class={t.major ? 'tick major' : 'tick'} />
        ))}
        <circle cx="50" cy="50" r={R - 6} class="track" stroke-dasharray={`${sweepLen} ${CIRC}`} transform="rotate(135 50 50)" />
        <circle cx="50" cy="50" r={R - 6} class="arc" stroke-dasharray={`${(sweepLen * v).toFixed(2)} ${CIRC}`} transform="rotate(135 50 50)" />
        <circle cx="50" cy="50" r="25" class="cap" />
        <circle cx="50" cy="50" r="25" class="capshine" />
        <line x1={ox} y1={oy} x2={ix} y2={iy} class="needle" />
        <text x="50" y="55" class="letter">
          {p.letter}
        </text>
      </svg>
    </div>
  );
}
