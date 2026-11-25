import { useEffect, useRef } from 'preact/hooks';
import { playing } from '../engine/host';
import { project } from '../store/project';
import { audChainPos, audPattern, editPattern, heldControls, queuedPattern, recArmed, sampling, selectedSound } from '../ui/state';
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
  const aud = audPattern.value;
  const patShown = isPlaying && aud >= 0 ? aud : editPattern.value;
  const queued = queuedPattern.value;
  const chain = p.chain;
  const idx = isPlaying && aud >= 0 ? audChainPos.value % chain.length : Math.max(0, chain.indexOf(patShown));
  const next = queued ?? (chain.length > 1 ? chain[(idx + 1) % chain.length]! : null);
  const armed = recArmed.value;
  const rec = armed || heldControls.value.has('btn:rec') || sampling.value;
  return (
    <div class="lcd" data-testid="lcd" data-snd={snd + 1} data-pat={patShown + 1} aria-label={`SND ${pad2(snd + 1)}`}>
      <div class="lcd-top">
        <span class="lcd-grp">
          <span class="lcd-lbl">SND</span>
          <Digits n={snd + 1} width={2} label={`SND ${pad2(snd + 1)}`} />
        </span>
        <span class="lcd-grp">
          <span class="lcd-lbl">PAT</span>
          <Digits n={patShown + 1} width={2} label={`PAT ${pad2(patShown + 1)}`} />
          {next !== null && (
            <span class={`lcd-chain${queued !== null ? ' q' : ''}`} data-testid="lcd-chain">
              →{pad2(next + 1)}
            </span>
          )}
        </span>
        <span class="lcd-icons">
          <svg viewBox="0 0 14 14" class={isPlaying ? 'seg on' : 'seg'} aria-label="play">
            <path d="M3 1.5v11l9-5.5z" />
          </svg>
          <svg viewBox="0 0 14 14" class={`${rec ? 'seg on' : 'seg'}${armed && isPlaying ? ' blink' : ''}`} aria-label="rec">
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
