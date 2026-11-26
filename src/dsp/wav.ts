// 16-bit PCM WAV encoder (pure). Mono or stereo Float32 in, Uint8Array out.

export function encodeWav(channels: readonly Float32Array[], rate: number): Uint8Array {
  const ch = channels.length;
  const n = channels[0]?.length ?? 0;
  const bytes = 44 + n * ch * 2;
  const out = new Uint8Array(bytes);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, ch, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, channels[c]![i] ?? 0));
      v.setInt16(o, Math.round(x < 0 ? x * 0x8000 : x * 0x7fff), true);
      o += 2;
    }
  }
  return out;
}
