import { it } from 'vitest';
import { render, slot, sineSample } from '/home/ricardo/git/tko/tests/unit/render';
import { detectClicks, peak, maxJump } from '/home/ricardo/git/tko/tests/audio/analysis';
it('x', () => {
  for (const vol of [0.8, 0.3, 0.1]) {
    const sr = 48000;
    const cmds: any[] = [];
    for (let s = 0; s < 8; s++) cmds.push(...slot(s, 'melodic', `m${s}`, sineSample(200 + 40 * s, 3, sr), sr, { volume: vol }));
    const at = Array.from({ length: 40 }, (_, i) => ({ time: 0.05 + i * 0.004, cmd: { type: 'play', sound: i % 8, key: (i * 5) % 16, on: true } }));
    const r = render(cmds, 0.8, { at: at as any });
    const c = detectClicks(r.left);
    console.log(vol, peak(r.left), maxJump(r.left), c.length, c.slice(0,3).map(i=>[i, r.left[i-2],r.left[i-1],r.left[i],r.left[i+1]]));
  }
});
