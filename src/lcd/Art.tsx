// Placeholder kitchen-chaos art: original line shapes, every segment always drawn and ghosted until lit.
// Segment ids are the contract for future art; the rAF loop only toggles the `on` class.
import { useEffect, useRef } from 'preact/hooks';
import { meters, playing } from '../engine/host';
import { project } from '../store/project';
import { selectedSound } from '../ui/state';

export function Art() {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const els = new Map<string, Element>();
    svg.querySelectorAll('[data-seg]').forEach((e) => els.set((e as HTMLElement).dataset.seg!, e));
    const last = new Map<string, boolean>();
    const set = (id: string, on: boolean) => {
      if (last.get(id) === on) return;
      last.set(id, on);
      els.get(id)?.classList.toggle('on', on);
    };
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const sel = project.peek().sounds[selectedSound.peek()];
      const melodic = sel?.kind !== 'drum';
      let mel = false;
      let drum = false;
      for (let s = 0; s < 16; s++) {
        const age = now - meters.activeAt[s]!;
        if (s < 8 ? age < 350 : age < 140) s < 8 ? (mel = true) : (drum = true);
      }
      set('pot', melodic);
      set('steam1', mel);
      set('steam2', mel);
      set('steam3', mel);
      set('knife', !melodic);
      set('chop', drum);
      set('hat', playing.peek());
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg ref={ref} class="art" viewBox="0 0 160 40" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {/* pot with steam */}
      <g data-seg="pot" class="seg">
        <path d="M14 18h30v12a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6z" />
        <path d="M10 20h4M44 20h4" />
        <path d="M18 18a11 4 0 0 1 22 0" />
      </g>
      <path data-seg="steam1" class="seg" d="M22 14c-3-3 3-5 0-9" />
      <path data-seg="steam2" class="seg" d="M29 14c-3-3 3-5 0-11" />
      <path data-seg="steam3" class="seg" d="M36 14c-3-3 3-5 0-9" />
      {/* chef hat */}
      <g data-seg="hat" class="seg">
        <path d="M68 30h24v4H68z" />
        <path d="M69 30c-7-1-8-9-2-11 0-6 8-8 13-4 5-4 13-2 13 4 6 2 5 10-2 11" />
      </g>
      {/* knife on a board */}
      <g data-seg="knife" class="seg">
        <path d="M112 31h38v4h-38z" />
        <path d="M116 22l22-6c3-1 4 2 1 3l-8 9h-15z" />
      </g>
      <path data-seg="chop" class="seg" d="M120 12l3 5M128 10l1 6M136 12l-2 5" />
    </svg>
  );
}
