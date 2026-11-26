// WAV export of the current chain (main thread). Drives host.exportAudio, encodes, then shares or downloads.
import { signal } from '@preact/signals';
import { exportAudio, panic, playing } from '../engine/host';
import { encodeWav } from '../dsp/wav';
import { project } from '../store/project';
import { showToast } from './toast';

export type ExportState = { busy: boolean; frac: number; total: number };
export const exportState = signal<ExportState>({ busy: false, frac: 0, total: 0 });
let token = 0;

export const stamp = (d = new Date()): string => {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
};
export const exportFilename = (name: string, bpm: number, d = new Date()): string => {
  const base = name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').slice(0, 32) || 'beat';
  return `tko-${base}-${Math.round(bpm)}bpm-${stamp(d)}.wav`;
};

export function exportSeconds(loops: number): number {
  const p = project.peek();
  return (p.chain.length * 16 * loops * 60) / p.bpm / 4;
}

export function cancelExport(): void {
  if (!exportState.peek().busy) return;
  token++;
  panic();
  playing.value = false;
  exportState.value = { busy: false, frac: 0, total: 0 };
}

export async function runExport(loops: number): Promise<void> {
  if (exportState.peek().busy) return;
  const my = ++token;
  const total = exportSeconds(loops);
  exportState.value = { busy: true, frac: 0, total };
  try {
    const out = await exportAudio(loops, (f) => {
      if (token === my) exportState.value = { busy: true, frac: f, total };
    });
    if (token !== my) return; // cancelled
    const p = project.peek();
    const name = exportFilename(p.name, p.bpm);
    const bytes = encodeWav([out.l], out.rate);
    const file = new File([bytes as BlobPart], name, { type: 'audio/wav' });
    exportState.value = { busy: false, frac: 0, total: 0 };
    let shared = false;
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        shared = true;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return;
      }
    }
    if (!shared) {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    showToast(`Exported ${(out.l.length / out.rate).toFixed(1)} s`);
  } catch (e) {
    if (token === my) {
      exportState.value = { busy: false, frac: 0, total: 0 };
      showToast(`Export failed${e instanceof Error && e.message ? `: ${e.message}` : '.'}`, 5000);
    }
  }
}
