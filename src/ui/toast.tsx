// Small transient message above the pads (errors the LCD strip is too narrow for).
import { signal } from '@preact/signals';

export const toast = signal('');
let timer: ReturnType<typeof setTimeout> | null = null;

export function showToast(text: string, ms = 3500): void {
  toast.value = text;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => (toast.value = ''), ms);
}

export function Toast() {
  const t = toast.value;
  return (
    <div class={`toast${t ? ' show' : ''}`} role="status" aria-live="polite" data-testid="toast">
      {t}
    </div>
  );
}
