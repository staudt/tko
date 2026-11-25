// Waveform editor for the Sample sheet: canvas waveform (DPR aware) with DOM handles on top.
// Melodic: draggable trim start/end, tap = audition key 0. Drum: 16 numbered slices, drag a marker, tap a slice to audition it.
import { useEffect, useRef, useState } from 'preact/hooks';
import { apply, project, updateSound } from '../store/project';
import { getSample, type Sample } from '../store/samples';
import { peaks } from '../dsp/peaks';
import { playKey } from '../engine/host';

const MIN_GAP = 0.004;
const MARKER_REACH = 12; // px
let dragN = 0;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Drag = { id: number; kind: 'start' | 'end' | 'slice'; idx: number; key: string; moved: boolean; x0: number };

export function Waveform({ slot }: { slot: number }) {
  const s = project.value.sounds[slot];
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const aud = useRef<{ id: number; key: number } | null>(null);
  const [smp, setSmp] = useState<Sample | null>(null);
  const [width, setWidth] = useState(0);
  const sampleId = s?.sampleId ?? null;

  useEffect(() => {
    let live = true;
    setSmp(null);
    if (sampleId) void getSample(sampleId).then((x) => live && setSmp(x), () => {});
    return () => {
      live = false;
    };
  }, [sampleId]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  useEffect(() => {
    const c = cv.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const h = c.getBoundingClientRect().height || 110;
    c.width = Math.round(width * dpr);
    c.height = Math.round(h * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const mid = c.height / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, Math.round(mid), c.width, Math.max(1, dpr));
    if (!smp || smp.l.length === 0) return;
    let pk: Float32Array;
    try {
      pk = peaks(smp.l, c.width, 0, smp.l.length);
    } catch {
      return;
    }
    ctx.fillStyle = '#ffa53a';
    for (let x = 0; x < c.width; x++) {
      const lo = pk[2 * x] ?? 0;
      const hi = pk[2 * x + 1] ?? 0;
      const y0 = mid - Math.min(1, Math.max(-1, hi)) * mid * 0.92;
      const y1 = mid - Math.min(1, Math.max(-1, lo)) * mid * 0.92;
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }, [smp, width]);

  if (!s) return null;
  const drum = s.kind === 'drum';
  const sl = s.slices.length >= 2 ? s.slices : null;

  const frac = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return clamp((clientX - r.left) / Math.max(1, r.width), 0, 1);
  };
  const sliceAt = (v: number) => {
    if (!sl) return Math.min(15, Math.floor(v * 16));
    for (let k = 0; k < sl.length - 1; k++) if (v < sl[k + 1]!) return Math.min(15, k);
    return Math.min(15, sl.length - 2);
  };
  const auditionOn = (id: number, key: number) => {
    aud.current = { id, key };
    playKey(slot, key, true);
  };
  const auditionOff = (id: number) => {
    if (aud.current?.id !== id) return;
    playKey(slot, aud.current.key, false);
    aud.current = null;
  };
  const capture = (e: PointerEvent) => {
    try {
      box.current?.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers */
    }
  };

  const onBoxDown = (e: PointerEvent) => {
    if (drag.current || aud.current) return;
    capture(e);
    const v = frac(e.clientX);
    if (drum && sl) {
      const w = box.current!.getBoundingClientRect().width;
      let best = -1;
      let bd = MARKER_REACH;
      for (let k = 1; k < sl.length - 1; k++) {
        const d = Math.abs(sl[k]! - v) * w;
        if (d <= bd) {
          bd = d;
          best = k;
        }
      }
      if (best > 0) {
        drag.current = { id: e.pointerId, kind: 'slice', idx: best, key: `wf:${slot}:${++dragN}`, moved: false, x0: e.clientX };
        return;
      }
      auditionOn(e.pointerId, sliceAt(v));
    } else auditionOn(e.pointerId, 0);
  };
  const startHandle = (kind: 'start' | 'end') => (e: PointerEvent) => {
    e.stopPropagation();
    if (drag.current) return;
    capture(e);
    drag.current = { id: e.pointerId, kind, idx: 0, key: `wf:${slot}:${++dragN}`, moved: true, x0: e.clientX };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x0) < 3) return;
      d.moved = true;
    }
    const v = frac(e.clientX);
    apply(
      (p) => {
        const cur = p.sounds[slot];
        if (!cur) return p;
        if (d.kind === 'start') return updateSound(p, slot, { start: clamp(v, 0, cur.end - 0.01) });
        if (d.kind === 'end') return updateSound(p, slot, { end: clamp(v, cur.start + 0.01, 1) });
        const arr = cur.slices.slice();
        arr[d.idx] = clamp(v, (arr[d.idx - 1] ?? 0) + MIN_GAP, (arr[d.idx + 1] ?? 1) - MIN_GAP);
        return updateSound(p, slot, { slices: arr });
      },
      { merge: d.key },
    );
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    if (d && d.id === e.pointerId) {
      drag.current = null;
      if (!d.moved && d.kind === 'slice') {
        // a tap on a marker: audition the slice that starts there
        playKey(slot, d.idx, true);
        setTimeout(() => playKey(slot, d.idx, false), 200);
      }
    }
    auditionOff(e.pointerId);
  };

  return (
    <div class="wfwrap">
      <div class="wf" ref={box} data-testid="wave" onPointerDown={onBoxDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <canvas ref={cv} class="wf-cv" />
        {!sampleId && <div class="wf-empty">empty slot</div>}
        {!drum && sampleId && (
          <>
            <div class="wf-dim" style={{ left: 0, width: `${s.start * 100}%` }} />
            <div class="wf-dim" style={{ right: 0, width: `${(1 - s.end) * 100}%` }} />
            <div class="wf-h" data-testid="handle-start" style={{ left: `${s.start * 100}%` }} onPointerDown={startHandle('start')}>
              <i />
            </div>
            <div class="wf-h" data-testid="handle-end" style={{ left: `${s.end * 100}%` }} onPointerDown={startHandle('end')}>
              <i />
            </div>
          </>
        )}
        {drum && sampleId && sl && (
          <>
            {sl.slice(1, -1).map((x, k) => (
              <div key={k} class="wf-m" data-testid={`marker-${k + 1}`} style={{ left: `${x * 100}%` }} />
            ))}
            {sl.slice(0, -1).map((x, k) => (
              <span key={k} class="wf-n" style={{ left: `${((x + (sl[k + 1] ?? 1)) / 2) * 100}%` }}>
                {k + 1}
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
