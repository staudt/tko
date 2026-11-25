// Kitchen-chaos LCD art. The SVG markup is pre-drawn (src/lcd/art/kitchen.ts); this loop only toggles the
// `on` class of segment groups from one rAF callback (no Preact re-renders, no per-frame allocations).
// Priority: recording > held/active FX > most recent hit (compare activeAt) > beat bob > idle.
import { useEffect, useRef } from 'preact/hooks';
import { audibleStep, meters, playing } from '../engine/host';
import { project } from '../store/project';
import { fxPad, heldControls } from '../ui/state';
import { FX_IDS } from '../engine/fx/ids';
import { KITCHEN_MARKUP, KITCHEN_VIEWBOX, SEG_IDS } from './art/kitchen';
import { drawCat, drawPose, drumPose, type CatName, type PoseName } from './art/poses';

/** Look-dev: freeze the art on one pose/frame instead of following the engine. */
export type ForcePose = { pose: PoseName; frame?: number; arg?: number; cat?: CatName; tail?: boolean };

const HIT_MS = 190;
const DRUM_DOWN_MS = 90;
const ids = new Map<string, number>();
SEG_IDS.forEach((id, i) => ids.set(id, i));
const drumCache = new Map<string, PoseName>();

export function Art({ force }: { force?: ForcePose }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const els: (Element | undefined)[] = SEG_IDS.map((id) => svg.querySelector(`[data-seg="${id}"]`) ?? undefined);
    const next = new Uint8Array(SEG_IDS.length);
    const prev = new Uint8Array(SEG_IDS.length);
    let dimmed = false;
    const show = (id: string) => {
      const i = ids.get(id);
      if (i !== undefined) next[i] = 1;
    };
    const flush = (dim: boolean) => {
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== prev[i]) {
          prev[i] = next[i]!;
          els[i]?.classList.toggle('on', next[i] === 1);
        }
        next[i] = 0;
      }
      if (dim !== dimmed) {
        dimmed = dim;
        svg.classList.toggle('dim', dim);
      }
    };

    if (force) {
      const dim = drawPose(force.pose, force.frame ?? 0, force.arg ?? 1, show);
      drawCat(force.cat ?? 'sleep', force.tail ?? false, force.frame ?? 0, show);
      flush(dim);
      return;
    }

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const slow = reduced ? 3 : 1; // multiplier for cyclic periods
    let lastStep = -1;
    let beatAt = -1e9;
    let lastHitAt = 0;
    let parity = 0;
    let awakeUntil = 0;
    let fxSince = 0;
    let fxPrev = -1;
    let raf = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // beat detection (step % 4 === 0), once per step change
      const st = playing.peek() ? audibleStep() : null;
      if (st) {
        if (st.step !== lastStep) {
          lastStep = st.step;
          if (st.step % 4 === 0) beatAt = now;
        }
      } else lastStep = -1;
      const sinceBeat = now - beatAt;

      // newest hit
      let hs = -1;
      let hAt = 0;
      for (let s = 0; s < 16; s++) {
        const a = meters.activeAt[s]!;
        if (a > hAt) { hAt = a; hs = s; }
      }
      if (hAt !== lastHitAt) { lastHitAt = hAt; parity ^= 1; }
      const hitAge = now - hAt;

      const fx = meters.fx >= 0 ? meters.fx : (fxPad.peek() ?? -1);
      if (fx !== fxPrev) { fxPrev = fx; fxSince = now; }
      const rec = heldControls.peek().has('btn:rec');

      if (meters.master > 0.35) awakeUntil = now + 2000;
      let cat: CatName = now < awakeUntil && playing.peek() ? 'awake' : 'sleep';
      let dim = false;

      if (rec) {
        dim = drawPose('sing', Math.floor(now / (250 * slow)) % 3, 0, show);
      } else if (fx >= 0) {
        const id = FX_IDS[fx];
        const t = now - fxSince;
        const cyc = (ms: number, n: number) => Math.floor(now / (ms * slow)) % n;
        if (id === 'lofi' || id === 'gate') cat = 'ears';
        if (id === 'stutter4' || id === 'stutter8' || id === 'stutter16' || id === 'stutter32') {
          const period = id === 'stutter4' ? 320 : id === 'stutter8' ? 240 : id === 'stutter16' ? 170 : 120;
          dim = drawPose('pan', Math.floor(now / Math.max(period, reduced ? 450 : 0)) % 2, 0, show);
        } else if (id === 'tapeStop') {
          // movement slows down the longer the effect is held
          const period = Math.min(1600, 220 + t * 0.9);
          dim = drawPose('tape', Math.floor(now / period) % 2, 0, show);
        } else if (id === 'lowSweep' || id === 'highSweep') dim = drawPose('dial', cyc(200, 3), id === 'highSweep' ? 1 : 0, show);
        else if (id === 'lofi') dim = drawPose('lofi', cyc(180, 4), 0, show);
        else if (id === 'gate') dim = drawPose('gate', reduced ? 1 : Math.floor(now / 90) % 2, 0, show);
        else if (id === 'reverse') dim = drawPose('reverse', cyc(220, 2), 0, show);
        else dim = drawPose('throw', cyc(200, 3), id === 'delayThrow' ? 1 : 0, show);
      } else if (hs >= 0 && hitAge < HIT_MS) {
        const key = Math.max(0, meters.lastKey[hs]!);
        if (hs < 8) {
          dim = drawPose('stir', parity, 1 + (key >> 2), show);
        } else {
          const name = project.peek().sounds[hs]?.hitNames?.[key];
          let pose: PoseName;
          if (name) {
            let c = drumCache.get(name);
            if (!c) drumCache.set(name, (c = drumPose(name, key)));
            pose = c;
          } else pose = drumPose(undefined, key);
          dim = drawPose(pose, hitAge < DRUM_DOWN_MS ? 1 : 0, 0, show);
        }
      } else if (st) {
        dim = drawPose('bob', sinceBeat < 120 ? 1 : 0, 0, show);
      } else {
        // idle: 2.4 s foot tap then a 1.6 s taste, repeating
        const t = now % 4000;
        const f = t < 2400 ? (Math.floor(t / 400) % 2 ? 1 : 0) : 3;
        dim = drawPose('idle', f, 0, show);
      }
      drawCat(cat, st ? sinceBeat < 220 : Math.floor(now / 900) % 2 === 1, Math.floor(now / (700 * slow)), show);
      flush(dim);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [force]);

  return <svg ref={ref} class="art" viewBox={KITCHEN_VIEWBOX} preserveAspectRatio="xMidYMid meet" aria-hidden="true" dangerouslySetInnerHTML={{ __html: KITCHEN_MARKUP }} />;
}
