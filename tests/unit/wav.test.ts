import { describe, expect, it } from 'vitest';
import { encodeWav } from '../../src/dsp/wav';

describe('wav', () => {
  it('writes a valid 16-bit PCM header and clamps samples', () => {
    const w = encodeWav([new Float32Array([0, 1, -1, 2])], 48000);
    const v = new DataView(w.buffer);
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...w.slice(8, 12))).toBe('WAVE');
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 32767, -32768, 32767]);
  });
});
