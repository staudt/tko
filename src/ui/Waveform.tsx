// Waveform editor for the Sample sheet: canvas waveform (DPR aware) with DOM handles on top.
// Melodic: draggable trim start/end bars (nearest handle wins), tap = preview from there to the trim end. Drum: 16 numbered slices, drag a marker, tap a slice to preview it.
// Previews run outside the engine (src/ui/preview.ts), a moving playhead follows them.
import { useEffect, useRef, useState } from 'preact/hooks';
import { apply, project, updateSound } from '../store/project';
import { getSample, type Sample } from '../store/samples';
import { peaks } from '../dsp/peaks';
import { getAudioContext } from '../platform/audio';
import { previewSample, previewState } from './preview';
import { lcdMessage } from '../lcd/message';

const MIN_GAP = 0.004;
const MARKER_REACH = 12; // px
const HANDLE_REACH = 30; // px, so the grab area is >= 60 px wide
const MIN_GAP_S = 0.02;
const LONG_MS = 450;
const MERGE_PX = 8;
const DOUBLE_MS = 320;
const DOUBLE_PX = 24;
const MAX_SLICES = 16;
const fmt = (t: number) => `${t.toFixed(2)} s`;
let dragN = 0;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Drag = { id: number; kind: 'start' | 'end' | 'slice'; idx: number; key: string; moved: boolean; x0: number; timer: ReturnType<typeof setTimeout> | null; fired: boolean };

export function Waveform({ slot }: { slot: number }) {
  const s = project.value.sounds[slot];
  const box = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const lastTap = useRef({ t: 0, x: 0 });
  const [note, setNote] = useState('');
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (txt: string) => {
    lcdMessage(txt);
    setNote(txt);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(''), 1400);
  };
  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    if (drag.current?.timer) clearTimeout(drag.current.timer);
  }, []);
  const head = useRef<HTMLDivElement>(null);
  const [bubble, setBubble] = useState<{ kind: 'start' | 'end'; txt: string } | null>(null);
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
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = head.current;
      if (!el) return;
      const st = previewState.peek();
      if (st.playing && st.sampleId === sampleId && st.durS > 0) {
        const f = Math.min(1, Math.max(0, (getAudioContext().currentTime - st.startedAt) / st.durS));
        el.style.display = 'block';
        el.style.left = `${(st.from01 + (st.to01 - st.from01) * f) * 100}%`;
      } else el.style.display = 'none';
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sampleId]);

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
  const capture = (e: PointerEvent) => {
    try {
      wrap.current?.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers */
    }
  };

  const onBoxDown = (e: PointerEvent) => {
    if (drag.current) return;
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
        drag.current = { id: e.pointerId, kind: 'slice', idx: best, key: `wf:${slot}:${++dragN}`, moved: false, x0: e.clientX, timer: null, fired: false };
        const d = drag.current;
        d.timer = setTimeout(() => {
          d.timer = null;
          if (drag.current !== d || d.moved) return;
          d.fired = true;
          removeMarker(d.idx, null);
          flash('SLICE REMOVED');
        }, LONG_MS);
        return;
      }
      const now = performance.now();
      const lt = lastTap.current;
      if (now - lt.t < DOUBLE_MS && Math.abs(e.clientX - lt.x) < DOUBLE_PX) {
        lastTap.current = { t: 0, x: 0 };
        if (sl.length - 1 < MAX_SLICES) {
          addMarker(v);
          flash('SLICE ADDED');
        }
        return;
      }
      lastTap.current = { t: now, x: e.clientX };
      previewSlice(sliceAt(v));
    } else if (drum) {
      if (sampleId) void previewSample(sampleId, 0, 1);
    } else if (sampleId) {
      const dx = (x: number) => Math.abs(x - v) * box.current!.getBoundingClientRect().width;
      const ds = dx(s.start);
      const de = dx(s.end);
      if (Math.min(ds, de) <= HANDLE_REACH) {
        const kind = ds < de || (ds === de && v <= s.start) ? 'start' : 'end';
        beginDrag(e, kind);
      } else void previewSample(sampleId, v >= s.start && v < s.end ? v : s.start, s.end);
    }
  };
  /** Removes boundary `idx` (merging two slices); `merge` joins it to the running drag's undo step. */
  const removeMarker = (idx: number, merge: string | null) =>
    apply(
      (p) => {
        const cur = p.sounds[slot];
        if (!cur || cur.slices.length <= 2 || idx < 1 || idx > cur.slices.length - 2) return p;
        return updateSound(p, slot, { slices: cur.slices.filter((_, i) => i !== idx) });
      },
      { merge },
    );
  const addMarker = (v: number) =>
    apply((p) => {
      const cur = p.sounds[slot];
      if (!cur || cur.slices.length < 2 || cur.slices.length - 1 >= MAX_SLICES) return p;
      const i = cur.slices.findIndex((x) => x > v);
      if (i < 1) return p;
      const lo = cur.slices[i - 1]!;
      const hi = cur.slices[i]!;
      if (hi - lo < 2 * MIN_GAP) return p;
      const arr = cur.slices.slice();
      arr.splice(i, 0, clamp(v, lo + MIN_GAP, hi - MIN_GAP));
      return updateSound(p, slot, { slices: arr });
    });
  const previewSlice = (k: number) => {
    if (!sampleId) return;
    const a = sl ? (sl[k] ?? 0) : k / 16;
    const b = sl ? (sl[k + 1] ?? 1) : (k + 1) / 16;
    void previewSample(sampleId, a, b);
  };
  const minGap = () => (smp && smp.l.length > 0 ? Math.min(0.25, MIN_GAP_S / (smp.l.length / smp.rate)) : 0.01);
  const timeOf = (v: number) => fmt(v * (smp ? smp.l.length / smp.rate : 0));
  const beginDrag = (e: PointerEvent, kind: 'start' | 'end') => {
    drag.current = { id: e.pointerId, kind, idx: 0, key: `wf:${slot}:${++dragN}`, moved: true, x0: e.clientX, timer: null, fired: false };
    setBubble({ kind, txt: timeOf(kind === 'start' ? s.start : s.end) });
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x0) < 3) return;
      d.moved = true;
      if (d.timer) clearTimeout(d.timer);
      d.timer = null;
    }
    const v = frac(e.clientX);
    const g = minGap();
    if (d.kind !== 'slice') {
      const nv = d.kind === 'start' ? clamp(v, 0, s.end - g) : clamp(v, s.start + g, 1);
      setBubble({ kind: d.kind, txt: timeOf(nv) });
    }
    apply(
      (p) => {
        const cur = p.sounds[slot];
        if (!cur) return p;
        if (d.kind === 'start') return updateSound(p, slot, { start: clamp(v, 0, cur.end - g) });
        if (d.kind === 'end') return updateSound(p, slot, { end: clamp(v, cur.start + g, 1) });
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
      if (d.timer) clearTimeout(d.timer);
      if (d.kind === 'slice' && d.moved && wrap.current && box.current) {
        // dropped onto a neighbouring marker: merge the two
        const cur = project.peek().sounds[slot]?.slices ?? [];
        const w = box.current.getBoundingClientRect().width;
        const x = cur[d.idx];
        if (x !== undefined) {
          const near = [d.idx - 1, d.idx + 1].some((j) => cur[j] !== undefined && Math.abs(cur[j]! - x) * w <= MERGE_PX);
          if (near) {
            removeMarker(d.idx, d.key);
            flash('SLICE REMOVED');
          }
        }
      } else if (!d.moved && !d.fired && d.kind === 'slice') {
        // a tap on a marker: preview the slice that starts there
        previewSlice(d.idx);
      }
      setBubble(null);
    }
  };

  return (
    <div class="wfwrap" onPointerDown={onBoxDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} ref={wrap}>
      <div class="wf" ref={box} data-testid="wave" data-start={s.start.toFixed(4)} data-end={s.end.toFixed(4)}>
        <canvas ref={cv} class="wf-cv" />
        {sampleId && <div class="wf-play" ref={head} />}
        {note && (
          <span class="wf-note" data-testid="slice-note">
            {note}
          </span>
        )}
        {!sampleId && <div class="wf-empty">empty slot</div>}
        {!drum && sampleId && (
          <>
            <div class="wf-dim" style={{ left: 0, width: `${s.start * 100}%` }} />
            <div class="wf-dim" style={{ right: 0, width: `${(1 - s.end) * 100}%` }} />
            <div class="wf-h" data-testid="handle-start" style={{ left: `${s.start * 100}%` }}>
              <i />
              <b class="top" />
              <b class="bot" />
            </div>
            <div class="wf-h" data-testid="handle-end" style={{ left: `${s.end * 100}%` }}>
              <i />
              <b class="top" />
              <b class="bot" />
            </div>
            <span class="wf-t l" data-testid="label-start" style={{ left: `${s.start * 100}%` }}>
              {timeOf(s.start)}
            </span>
            <span class="wf-t r" data-testid="label-end" style={{ left: `${s.end * 100}%` }}>
              {timeOf(s.end)}
            </span>
            {bubble && (
              <span class="wf-bub" data-testid="bubble" style={{ left: `${(bubble.kind === 'start' ? s.start : s.end) * 100}%` }}>
                {bubble.txt}
              </span>
            )}
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
