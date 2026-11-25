// Build tool (not part of the app bundle): renders the 16 factory sound slots into
// .factory-cache/*.wav, encodes them to MP3 in public/factory/ and writes factory.json.
// Run with `pnpm factory`. Melodic slots come from the FM engine, synth kits from the drum voice,
// "Studio kit" from CC0 recordings (see ASSET_LICENSES.md).
import { test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FmParams, FmVoice } from './engines/voice';
import { DrumSettings, DrumVoice, modelIndex } from './engines/drum';
import { presetByName } from './engines/fmPresets';
import type { DrumModel } from './engines/types';

const SR = 44100;
const LEAD_IN = 0.08;
const GAP = 0.08;
const PEAK_DB = -1;
const ROOT = process.cwd();
const CACHE = join(ROOT, '.factory-cache');
const OUT = join(ROOT, 'public', 'factory');
const BEATBOY = '/home/ricardo/git/beatboy';
const KIT_DIR = join(BEATBOY, '.kit-cache', 'processed');
const KIT_JSON = join(BEATBOY, 'public', 'kits', 'virtuosity', 'kit.json');

const db = (x: number) => 10 ** (x / 20);
const toDb = (x: number) => 20 * Math.log10(Math.max(1e-9, x));

function peakOf(a: Float32Array, from = 0, to = a.length): number {
  let p = 0;
  for (let i = Math.max(0, from); i < Math.min(a.length, to); i++) p = Math.max(p, Math.abs(a[i]!));
  return p;
}

function normalize(a: Float32Array, targetDb = PEAK_DB): void {
  const p = peakOf(a);
  if (p <= 0) return;
  const g = db(targetDb) / p;
  for (let i = 0; i < a.length; i++) a[i]! *= g;
}

/** Linear fade over the last `seconds` of the array. */
function fadeEnd(a: Float32Array, seconds: number, quarterSine = false): void {
  const n = Math.min(a.length, Math.round(seconds * SR));
  for (let i = 0; i < n; i++) {
    const t = 1 - i / n; // 1 -> 0 across the fade
    a[a.length - n + i]! *= quarterSine ? Math.sin((t * Math.PI) / 2) : t;
  }
}

// ---------------------------------------------------------------- melodic

type Melodic = { name: string; preset: string; root: number; noteOff: number; duration: number };
const MELODIC: Melodic[] = [
  { name: 'Round Bass', preset: 'Round Bass', root: 48, noteOff: 1.0, duration: 1.6 },
  { name: 'Glass Keys', preset: 'Glass Keys', root: 60, noteOff: 1.4, duration: 2.2 },
  { name: 'Electric Piano', preset: 'Electric Piano', root: 60, noteOff: 1.4, duration: 2.3 },
  { name: 'Soft Pad', preset: 'Soft Pad', root: 60, noteOff: 1.9, duration: 3.2 },
  { name: 'Brass', preset: 'Brass', root: 60, noteOff: 1.2, duration: 1.9 },
  { name: 'Pluck Lead', preset: 'Pluck Lead', root: 60, noteOff: 0.8, duration: 1.4 },
  { name: 'Bell', preset: 'Bell', root: 72, noteOff: 2.0, duration: 3.4 },
  { name: 'Marimba', preset: 'Marimba', root: 60, noteOff: 0.7, duration: 1.4 },
];

function renderMelodic(m: Melodic): Float32Array {
  const params = new FmParams();
  params.set(presetByName(m.preset));
  const voice = new FmVoice(SR);
  const n = Math.round(m.duration * SR);
  const note = new Float32Array(n);
  voice.noteOn(params, m.root, 110, 1, false, 0);
  const offAt = Math.round(m.noteOff * SR);
  const BLOCK = 128;
  for (let i = 0; i < n; i += BLOCK) {
    if (i <= offAt && offAt < i + BLOCK) voice.noteOff(params);
    voice.render(params, note, i, Math.min(n, i + BLOCK));
  }
  fadeEnd(note, 0.01);
  normalize(note);
  return note;
}

// ---------------------------------------------------------------- synth drum kits

type Hit = { name: string; model: DrumModel; tune: number; decay: number; tone: number; dur: number; level?: number };
const hit = (name: string, model: DrumModel, tune: number, decay: number, tone: number, dur: number, level = 1): Hit => ({
  name,
  model,
  tune,
  decay,
  tone,
  dur,
  level,
});
const K = (n: string, t: number, d: number, tone: number, dur: number) => hit(n, 'kick', t, d, tone, dur);
const S = (n: string, t: number, d: number, tone: number, dur: number) => hit(n, 'snare', t, d, tone, dur);
const H = (n: string, t: number, d: number, tone: number, dur: number) => hit(n, 'hat', t, d, tone, dur, 0.8);
const P = (n: string, t: number, d: number, tone: number, dur: number) => hit(n, 'perc', t, d, tone, dur);

// Scale offsets (semitones) for the tom ladder: C minor pentatonic over two octaves and a bit; perc base is 240 Hz (~B3).
const LADDER = [-12, -9, -7, -4, -2, 0, 3, 5, 8, 10, 12, 15, 17, 20, 22, 24];
const LADDER_NAMES = ['C2', 'Eb2', 'F2', 'G2', 'Bb2', 'C3', 'Eb3', 'F3', 'G3', 'Bb3', 'C4', 'Eb4', 'F4', 'G4', 'Bb4', 'C5'];

type Kit = { name: string; hits: Hit[] };
const KITS: Kit[] = [
  {
    name: 'Boom kit',
    hits: [
      K('sub', -8, 0.95, 0.1, 1.5),
      K('boom', -4, 0.8, 0.3, 1.2),
      K('808', -2, 0.62, 0.2, 0.95),
      K('thump', 0, 0.35, 0.5, 0.55),
      S('snare', 0, 0.4, 0.5, 0.55),
      S('snare long', -2, 0.55, 0.7, 0.75),
      S('clap', 3, 0.2, 0.9, 0.35),
      S('snap', 6, 0.1, 1, 0.22),
      H('hat closed', 0, 0.1, 0.6, 0.15),
      H('hat short', 1, 0.2, 0.7, 0.25),
      H('hat open', 2, 0.6, 0.5, 0.8),
      H('hat wash', -2, 0.8, 0.4, 1.1),
      P('tom low', -5, 0.5, 0.2, 0.7),
      P('tom mid', 0, 0.45, 0.2, 0.6),
      P('tom high', 5, 0.4, 0.2, 0.5),
      P('cowbell', 12, 0.2, 0.9, 0.35),
    ],
  },
  {
    name: 'Tight kit',
    hits: [
      K('kick tight', 2, 0.18, 0.7, 0.3),
      K('kick punch', 0, 0.25, 0.6, 0.4),
      K('kick dry', 4, 0.12, 0.8, 0.22),
      K('kick soft', -2, 0.3, 0.3, 0.45),
      S('snare tight', 2, 0.15, 0.6, 0.28),
      S('snare crack', 4, 0.22, 0.85, 0.35),
      S('snare body', -2, 0.3, 0.35, 0.45),
      S('rim', 8, 0.05, 0.9, 0.12),
      H('hat 1', 0, 0.05, 0.8, 0.1),
      H('hat 2', 2, 0.08, 0.6, 0.14),
      H('hat 3', -2, 0.12, 0.7, 0.18),
      H('hat open', 1, 0.35, 0.6, 0.5),
      P('tom low', -4, 0.2, 0.3, 0.35),
      P('tom high', 4, 0.18, 0.3, 0.3),
      P('block', 14, 0.05, 0.5, 0.12),
      P('tick', 20, 0.03, 0.8, 0.08),
    ],
  },
  {
    name: 'Lo-fi perc',
    hits: [
      P('wood low', -4, 0.12, 0.7, 0.2),
      P('wood mid', 2, 0.1, 0.8, 0.18),
      P('wood high', 9, 0.08, 0.8, 0.15),
      P('conga low', -2, 0.3, 0.45, 0.45),
      P('conga high', 5, 0.25, 0.45, 0.4),
      P('bongo', 10, 0.18, 0.4, 0.3),
      P('bell low', 2, 0.55, 1.0, 0.8),
      P('bell high', 12, 0.5, 0.95, 0.75),
      P('clink', 18, 0.2, 0.8, 0.3),
      P('boing', -10, 0.4, 0.9, 0.5),
      P('blip', 14, 0.1, 0.6, 0.15),
      P('tonk', 6, 0.15, 1.0, 0.25),
      H('shaker', 3, 0.15, 0.2, 0.25),
      H('tick', 4, 0.04, 0.9, 0.08),
      S('snap', 5, 0.12, 0.8, 0.22),
      K('thud', 3, 0.2, 0.2, 0.35),
    ],
  },
  {
    name: 'Tom ladder',
    hits: LADDER.map((t, i) => P(LADDER_NAMES[i]!, t, 0.4 - i * 0.008, 0.15, 0.65 - i * 0.02)),
  },
  {
    name: 'Kick bank',
    hits: [
      K('deep sub', -10, 1.0, 0.0, 1.6),
      K('sub 2', -7, 0.85, 0.1, 1.3),
      K('boom', -4, 0.7, 0.25, 1.0),
      K('long', -2, 0.6, 0.35, 0.85),
      K('round', 0, 0.45, 0.4, 0.65),
      K('classic', 0, 0.35, 0.55, 0.5),
      K('punch', 2, 0.3, 0.7, 0.45),
      K('click', 2, 0.25, 1.0, 0.4),
      K('short', 4, 0.15, 0.6, 0.28),
      K('tight', 5, 0.1, 0.75, 0.2),
      K('tick', 8, 0.06, 0.9, 0.14),
      K('mid pitch', 6, 0.4, 0.5, 0.5),
      K('high thump', 9, 0.3, 0.3, 0.4),
      K('zap', 3, 0.2, 1.0, 0.3),
      K('soft', -3, 0.4, 0.0, 0.6),
      K('dirty', -1, 0.5, 0.9, 0.7),
    ],
  },
  {
    name: 'Snare & clap bank',
    hits: [
      S('snare 1', -4, 0.4, 0.4, 0.55),
      S('snare 2', -2, 0.35, 0.5, 0.5),
      S('snare 3', 0, 0.3, 0.55, 0.45),
      S('snare 4', 2, 0.25, 0.6, 0.4),
      S('snare 5', 4, 0.2, 0.7, 0.33),
      S('snare tight', 3, 0.1, 0.6, 0.2),
      S('snare long', -3, 0.7, 0.7, 0.9),
      S('snare rim', 7, 0.08, 0.8, 0.16),
      S('clap 1', 1, 0.25, 0.9, 0.4),
      S('clap 2', 3, 0.3, 1.0, 0.45),
      S('clap short', 5, 0.1, 0.95, 0.2),
      S('clap long', 0, 0.6, 0.8, 0.8),
      S('snap 1', 8, 0.12, 1.0, 0.2),
      S('snap 2', 10, 0.06, 0.9, 0.12),
      S('noise hit', 12, 0.3, 1.0, 0.4),
      S('thump snare', -8, 0.35, 0.2, 0.5),
    ],
  },
  {
    name: 'Hats & metal',
    hits: [
      H('closed 1', 0, 0.04, 0.8, 0.09),
      H('closed 2', 2, 0.06, 0.6, 0.12),
      H('closed 3', -2, 0.08, 0.5, 0.14),
      H('pedal', -4, 0.12, 0.4, 0.2),
      H('half open', 0, 0.3, 0.6, 0.4),
      H('open 1', 1, 0.5, 0.6, 0.65),
      H('open 2', -1, 0.7, 0.5, 0.9),
      H('wash', 3, 0.9, 0.7, 1.2),
      H('hi tick', 6, 0.05, 1.0, 0.1),
      H('lo tick', -6, 0.07, 0.3, 0.12),
      H('shimmer', 5, 0.65, 1.0, 0.9),
      H('dark open', -5, 0.55, 0.0, 0.7),
      P('metal 1', 8, 0.35, 1.0, 0.5),
      P('metal 2', 16, 0.3, 0.9, 0.45),
      P('metal 3', 22, 0.45, 1.0, 0.6),
      P('clang', 4, 0.6, 0.85, 0.8),
    ],
  },
];

function renderHit(h: Hit, seed: number): Float32Array {
  const n = Math.round(h.dur * SR);
  const out = new Float32Array(n);
  const voice = new DrumVoice(SR, seed);
  const s = new DrumSettings();
  s.model = modelIndex(h.model);
  s.tune = h.tune;
  s.decay = h.decay;
  s.tone = h.tone;
  voice.trigger(s, 127);
  const BLOCK = 128;
  for (let i = 0; i < n; i += BLOCK) voice.render(out, i, Math.min(n, i + BLOCK));
  fadeEnd(out, Math.min(0.03, h.dur * 0.25));
  normalize(out, PEAK_DB + toDb(h.level ?? 1));
  return out;
}

// ---------------------------------------------------------------- studio kit (CC0 recordings)

const STUDIO_ORDER = [
  'kick', 'snare', 'sidestick', 'clap', 'hatClosed', 'hatPedal', 'hatOpen', 'ride',
  'rideBell', 'crash', 'crash2', 'tomHigh', 'tomMid', 'tomFloor', 'tambourine', 'cowbell',
];
const STUDIO_MAX = 1.2;

function readWav(path: string): Float32Array {
  const b = readFileSync(path);
  let pos = 12;
  let fmt = { tag: 1, ch: 1, bits: 16 };
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(body), ch: b.readUInt16LE(body + 2), bits: b.readUInt16LE(body + 14) };
    if (id === 'data') {
      const bytes = fmt.bits / 8;
      const frames = Math.floor(Math.min(size, b.length - body) / (bytes * fmt.ch));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.ch; c++) {
          const o = body + (i * fmt.ch + c) * bytes;
          sum += fmt.tag === 3 ? b.readFloatLE(o) : fmt.bits === 16 ? b.readInt16LE(o) / 32768 : b.readIntLE(o, 3) / 8388608;
        }
        out[i] = sum / fmt.ch;
      }
      return out;
    }
    pos = body + size + (size & 1);
  }
  throw new Error(`no data chunk in ${path}`);
}

function writeWav(path: string, a: Float32Array): void {
  const b = Buffer.alloc(44 + a.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + a.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(a.length * 2, 40);
  for (let i = 0; i < a.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, a[i]!)) * 32767), 44 + i * 2);
  writeFileSync(path, b);
}

function studioHits(): { name: string; data: Float32Array }[] {
  const kit = JSON.parse(readFileSync(KIT_JSON, 'utf8')) as { sounds: Record<string, { gain?: number }> };
  return STUDIO_ORDER.map((name) => {
    let d: Float32Array = readWav(join(KIT_DIR, `${name}.wav`));
    const gain = kit.sounds[name]?.gain ?? 1;
    if (d.length > STUDIO_MAX * SR) {
      d = d.slice(0, Math.round(STUDIO_MAX * SR));
      fadeEnd(d, 0.35, true);
    }
    d = Float32Array.from(d, (v) => v * gain);
    return { name, data: d };
  });
}

// ---------------------------------------------------------------- assembly + encode

type ManifestSlot = {
  slot: number;
  name: string;
  kind: 'melodic' | 'drum';
  file: string;
  root: number;
  start?: number;
  duration?: number;
  hits?: { name: string; start: number; duration: number }[];
};

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const slug = (s: string) => s.toLowerCase().replace(/&/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function assembleDrums(hits: { name: string; data: Float32Array }[]): { data: Float32Array; entries: { name: string; start: number; duration: number }[] } {
  const total = Math.round(LEAD_IN * SR) + hits.reduce((s, h) => s + h.data.length + Math.round(GAP * SR), 0);
  const data = new Float32Array(total);
  const entries: { name: string; start: number; duration: number }[] = [];
  let pos = Math.round(LEAD_IN * SR);
  for (const h of hits) {
    data.set(h.data, pos);
    entries.push({ name: h.name, start: r4(pos / SR), duration: r4(h.data.length / SR) });
    pos += h.data.length + Math.round(GAP * SR);
  }
  return { data, entries };
}

function decodeMp3(path: string): Float32Array {
  const raw = execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

test('render factory sounds', () => {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) rmSync(join(OUT, f));

  const slots: ManifestSlot[] = [];
  const sources: Float32Array[] = [];

  MELODIC.forEach((m, i) => {
    const note = renderMelodic(m);
    const data = new Float32Array(Math.round(LEAD_IN * SR) + note.length);
    data.set(note, Math.round(LEAD_IN * SR));
    sources.push(data);
    slots.push({ slot: i, name: m.name, kind: 'melodic', file: `${String(i + 1).padStart(2, '0')}-${slug(m.name)}.mp3`, root: m.root, start: LEAD_IN, duration: r4(note.length / SR) });
  });

  const drumSets: { name: string; hits: { name: string; data: Float32Array }[] }[] = [
    { name: 'Studio kit', hits: studioHits() },
    ...KITS.map((k, ki) => ({ name: k.name, hits: k.hits.map((h, hi) => ({ name: h.name, data: renderHit(h, 0x9e3779b1 ^ (ki * 977 + hi * 131 + 7)) })) })),
  ];
  drumSets.forEach((set, j) => {
    if (set.hits.length !== 16) throw new Error(`${set.name}: ${set.hits.length} hits`);
    const { data, entries } = assembleDrums(set.hits);
    sources.push(data);
    const i = 8 + j;
    slots.push({ slot: i, name: set.name, kind: 'drum', file: `${String(i + 1).padStart(2, '0')}-${slug(set.name)}.mp3`, root: 60, hits: entries });
  });

  let total = 0;
  slots.forEach((s, i) => {
    const wav = join(CACHE, s.file.replace(/\.mp3$/, '.wav'));
    const src = sources[i]!;
    writeWav(wav, src);
    const mp3 = join(OUT, s.file);
    execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-y', '-i', wav, '-ac', '1', '-ar', String(SR), '-codec:a', 'libmp3lame', '-b:a', '112k', mp3]);
    const size = statSync(mp3).size;
    total += size;
    const dec = decodeMp3(mp3);
    const srcPeak = peakOf(src);
    const decPeak = peakOf(dec);
    const lines: string[] = [];
    // Per-hit peaks from the WAV source, with exact positions.
    const regions = s.kind === 'melodic' ? [{ name: s.name, start: s.start!, duration: s.duration! }] : s.hits!;
    let silent = false;
    for (const h of regions) {
      const p = peakOf(src, Math.round(h.start * SR), Math.round((h.start + h.duration) * SR));
      if (toDb(p) < -30) silent = true;
      lines.push(`${h.name} ${toDb(p).toFixed(1)}`);
    }
    console.log(`${s.file}  ${(size / 1024).toFixed(1)} kB  ${(src.length / SR).toFixed(2)} s  src peak ${toDb(srcPeak).toFixed(2)} dB  mp3 peak ${toDb(decPeak).toFixed(2)} dB${silent ? '  ** QUIET HIT **' : ''}`);
    console.log(`   hits(dB): ${lines.join(' | ')}`);
    if (srcPeak > 1 || srcPeak < 0.1) throw new Error(`${s.file}: bad peak ${srcPeak}`);
    if (silent) throw new Error(`${s.file}: silent hit`);
  });

  writeFileSync(join(OUT, 'factory.json'), JSON.stringify({ version: 1, sampleRate: SR, slots }, null, 2) + '\n');
  console.log(`total ${(total / 1024).toFixed(0)} kB in ${slots.length} files`);
  if (!existsSync(join(OUT, 'factory.json')) || total > 2 * 1024 * 1024) throw new Error('size budget exceeded');
}, 300_000);
