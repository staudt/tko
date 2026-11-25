import { useEffect, useRef } from 'preact/hooks';
import { playing } from '../engine/host';
import { project } from '../store/project';
import { heldControls, selectedSound } from '../ui/state';
import { Digits } from './SevenSeg';
import { Art } from './Art';
import { startMatrix } from './Matrix';

const pad2 = (n: number) => String(n).padStart(2, '0');

export function Lcd() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => (canvas.current ? startMatrix(canvas.current) : undefined), []);
  const snd = selectedSound.value;
  const p = project.value;
  const isPlaying = playing.value;
  const rec = heldControls.value.has('btn:rec');
  return (
    <div class="lcd" data-testid="lcd" data-snd={snd + 1} aria-label={`SND ${pad2(snd + 1)}`}>
      <div class="lcd-top">
        <span class="lcd-grp">
          <span class="lcd-lbl">SND</span>
          <Digits n={snd + 1} width={2} label={`SND ${pad2(snd + 1)}`} />
        </span>
        <span class="lcd-grp">
          <span class="lcd-lbl">PAT</span>
          <Digits n={(p.chain[0] ?? 0) + 1} width={2} label="PAT 01" />
        </span>
        <span class="lcd-icons">
          <svg viewBox="0 0 14 14" class={isPlaying ? 'seg on' : 'seg'} aria-label="play">
            <path d="M3 1.5v11l9-5.5z" />
          </svg>
          <svg viewBox="0 0 14 14" class={rec ? 'seg on' : 'seg'} aria-label="rec">
            <circle cx="7" cy="7" r="5" />
          </svg>
        </span>
        <span class="lcd-grp bpm">
          <Digits n={p.bpm} width={3} label={`BPM ${p.bpm}`} />
          <span class="lcd-lbl">BPM</span>
        </span>
      </div>
      <div class="lcd-art">
        <Art />
      </div>
      <canvas ref={canvas} class="lcd-strip" />
      <div class="lcd-glare" />
    </div>
  );
}
