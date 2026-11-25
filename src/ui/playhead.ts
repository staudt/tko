// rAF loop for the playhead: toggles a class on the pad elements (no re-render per frame) and
// publishes the audible pattern/chain position to signals only when they change.
import { audibleStep, playing } from '../engine/host';
import { audChainPos, audPattern, editPattern, queuedPattern, writeMode } from './state';

export function startPlayhead(root: HTMLElement): () => void {
  const pads = Array.from(root.querySelectorAll<HTMLElement>('.pad'));
  let raf = 0;
  let cur = -1;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const a = playing.peek() ? audibleStep() : null;
    const pat = a ? a.pattern : -1;
    if (audPattern.peek() !== pat) audPattern.value = pat;
    const pos = a ? a.chainPos : 0;
    if (audChainPos.peek() !== pos) audChainPos.value = pos;
    const q = queuedPattern.peek();
    if (q !== null && (!a || pat === q)) queuedPattern.value = null;
    const target = a && writeMode.peek() && a.pattern === editPattern.peek() ? a.step : -1;
    if (target !== cur) {
      if (cur >= 0) pads[cur]?.removeAttribute('data-ph');
      if (target >= 0) pads[target]?.setAttribute('data-ph', '1');
      cur = target;
    }
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
