// Fake microphone: replaces navigator.mediaDevices.getUserMedia with a MediaStreamDestination fed by an oscillator
// (silence for the first 200 ms, then a 220 Hz tone in 0.25 s bursts), so recording tests get known audio.
import type { Page } from '@playwright/test';

export async function installFakeMic(page: Page): Promise<void> {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      await ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      osc.frequency.value = 220;
      const g = ctx.createGain();
      g.gain.value = 0;
      const t0 = ctx.currentTime;
      for (let i = 0; i < 48; i++) {
        g.gain.setValueAtTime(0.5, t0 + 0.2 + i * 0.5);
        g.gain.setValueAtTime(0, t0 + 0.45 + i * 0.5);
      }
      const dest = ctx.createMediaStreamDestination();
      osc.connect(g);
      g.connect(dest);
      osc.start();
      return dest.stream;
    };
  });
}

export async function installDeniedMic(page: Page): Promise<void> {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
}

/** A mono 16-bit WAV: `bursts` short decaying 300 Hz clicks spread over `seconds`. */
export function makeWav(seconds = 1, bursts = 4, rate = 22050): Buffer {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const per = n / bursts;
    const t = (i % per) / rate;
    const v = Math.sin(2 * Math.PI * 300 * t) * Math.exp(-t * 25) * 0.8;
    b.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return b;
}
