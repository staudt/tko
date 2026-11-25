// One pointer router for the whole instrument surface. Every control carries data-ctl="<id>"; the
// router keeps Map<pointerId, controlId>, publishes the set of held ids (combos are set lookups) and
// releases everything (plus engine panic) whenever a touch can no longer be trusted.
import { heldControls } from '../state';
import { panic } from '../../engine/host';

export type RouterHandlers = {
  down(id: string, pointerId: number, e: PointerEvent): void;
  up(id: string, pointerId: number, cancelled: boolean): void;
  /** Pointer moved while held (only called for controls that care). */
  move?(id: string, pointerId: number, e: PointerEvent): void;
  /** Called after a global release (state reset). */
  reset(): void;
};

export const held = heldControls;

export function attachRouter(root: HTMLElement, h: RouterHandlers): () => void {
  const pointers = new Map<number, string>();
  const publish = () => {
    held.value = new Set(pointers.values());
  };

  const releaseAll = () => {
    if (pointers.size === 0 && held.peek().size === 0) return;
    for (const [pid, id] of pointers) h.up(id, pid, true);
    pointers.clear();
    publish();
    h.reset();
    panic();
  };

  const onDown = (e: PointerEvent) => {
    const el = (e.target as Element | null)?.closest<HTMLElement>('[data-ctl]');
    if (!el || !root.contains(el)) return;
    const id = el.dataset.ctl!;
    for (const v of pointers.values()) if (v === id) return; // already held by another finger
    pointers.set(e.pointerId, id);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers can't be captured */
    }
    publish();
    h.down(id, e.pointerId, e);
  };
  const onUp = (e: PointerEvent) => {
    const id = pointers.get(e.pointerId);
    if (id === undefined) return;
    pointers.delete(e.pointerId);
    publish();
    h.up(id, e.pointerId, e.type === 'pointercancel');
  };
  const onMove = (e: PointerEvent) => {
    const id = pointers.get(e.pointerId);
    if (id !== undefined) h.move?.(id, e.pointerId, e);
  };
  const onCancel = (e: PointerEvent) => {
    if (pointers.has(e.pointerId)) releaseAll();
  };
  const onLostCapture = (e: PointerEvent) => {
    // After a normal pointerup the pointer is already gone from the map.
    if (pointers.has(e.pointerId)) releaseAll();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') releaseAll();
  };
  const block = (e: Event) => e.preventDefault();

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onCancel);
  root.addEventListener('lostpointercapture', onLostCapture);
  root.addEventListener('contextmenu', block);
  root.addEventListener('dblclick', block);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onCancel);
    root.removeEventListener('lostpointercapture', onLostCapture);
    root.removeEventListener('contextmenu', block);
    root.removeEventListener('dblclick', block);
    window.removeEventListener('blur', releaseAll);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
