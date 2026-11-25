// What knobs A and B do in each mode (value mapping, readout text, store edits).
import { apply, project, updateSound } from '../store/project';
import { fxKnob } from '../engine/host';
import { FX_DEFAULT_XY, FX_DEFS, FX_IDS } from '../engine/fx/ids';
import { keyLabel } from './stepHelpers';
import { editPattern, fxPad, fxXY, heldStep, knobMode, lastKey, lastKeyVer, padMode, recArmed, selectedSound, writeMode } from './state';
import { KEY_NAMES, SCALES, SCALE_IDS } from '../store/scales';
import { lcdMessage } from '../lcd/message';
import { playing } from '../engine/host';
import { getStep, setKey, setLock, setScale, setStep } from '../store/edit';
import { knobToPitch, knobToTone, pitchToKnob, toneToKnob } from './stepHelpers';
import { markUsed, setBpm, setSwing } from './controls';

export type KnobSpec = { label: string; text: string; value: number; def: number; disabled?: boolean; onChange: (v: number, first: boolean) => void };
export type KnobSpecs = { title: string; a: KnobSpec; b: KnobSpec };

let dragN = 0;
const drags = { A: 0, B: 0 };
const key = (k: 'A' | 'B', first: boolean, i: number) => {
  if (first) drags[k] = ++dragN;
  return `knob${k}:${i}:${drags[k]}`;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const toneText = (t: number) => (Math.abs(t) < 0.005 ? 'OPEN' : `${t < 0 ? 'LP' : 'HP'} ${Math.round(Math.abs(t) * 100)}`);

/** One-line gesture hint under the readout title. */
export function hintText(): string {
  const mode = knobMode.value;
  if (mode === 'fx') return 'knobs: effect X / Y';
  if (mode === 'bpm') return 'A: tempo · B: swing · pad: volume';
  if (mode === 'trim') return project.value.sounds[selectedSound.value]?.kind === 'drum' ? 'A: volume · pad: select sound' : 'A: trim start · B: trim end · pad: select';
  if (mode === 'lock') return 'A: lock pitch · B: lock tone · tap: length';
  if (mode === 'tune') return 'tap: select sound · hold: actions · knobs: key/scale';
  if (padMode.value === 'pattern') return 'tap: pattern · more taps: chain · hold: copy/paste';
  if (padMode.value === 'fx') return 'hold pads: effects · knobs: shape';
  if (recArmed.value && playing.value) return 'FX+pad: record fx · hold ERASE: erase';
  if (writeMode.value) return 'tap: step · hold+knob: lock · ERASE+step: clear';
  return 'hold SAMPLE+pad: record · ERASE+pad: clear';
}

export function knobSpecs(): KnobSpecs {
  const mode = knobMode.value;
  const i = selectedSound.value;
  const p = project.value;
  const s = p.sounds[i];
  const pad = (n: number) => String(n + 1).padStart(2, '0');

  if (mode === 'fx') {
    const k = fxPad.value!;
    const def = FX_DEFS[k]!;
    const [x, y] = fxXY.value;
    const d = FX_DEFAULT_XY[FX_IDS[k]!];
    const send = (nx: number, ny: number) => {
      fxXY.value = [nx, ny];
      fxKnob(k, nx, ny);
    };
    return {
      title: `${def.label} ${def.sub}`.toUpperCase(),
      a: { label: `FX ${def.x}`, text: `${def.x} ${Math.round(x * 100)}`.toUpperCase(), value: x, def: d[0], onChange: (v, f) => (f && markUsed(), send(v, fxXY.peek()[1])) },
      b: { label: `FX ${def.y}`, text: `${def.y} ${Math.round(y * 100)}`.toUpperCase(), value: y, def: d[1], onChange: (v, f) => (f && markUsed(), send(fxXY.peek()[0], v)) },
    };
  }
  if (mode === 'lock' && heldStep.value !== null) {
    const st = heldStep.value;
    const pat = editPattern.value;
    const cur = getStep(p, pat, i, st);
    const snd = i;
    const change = (which: 'A' | 'B', v: number, first: boolean, def: number, map: (v: number) => number) => {
      if (first) markUsed();
      const k = key(which, first, snd * 16 + st);
      if (first && v === def) {
        // double tap: remove that lock (never creates a step)
        apply((q) => setLock(q, pat, snd, st, which, null));
        return;
      }
      apply(
        (q) => {
          const base = getStep(q, pat, snd, st) ? q : setStep(q, pat, snd, st, { keys: 1 << (lastKey[snd] ?? 0) });
          return setLock(base, pat, snd, st, which, map(v));
        },
        { merge: k },
      );
    };
    return {
      title: `STEP ${pad(st)}`,
      a: {
        label: 'Lock pitch',
        text: cur?.lockA === undefined ? '—' : `LOCK PITCH ${signed(cur.lockA)}`,
        value: cur?.lockA === undefined ? 0.5 : pitchToKnob(cur.lockA),
        def: 0.5,
        onChange: (v, f) => change('A', v, f, 0.5, knobToPitch),
      },
      b: {
        label: 'Lock tone',
        text: cur?.lockB === undefined ? '—' : `LOCK TONE ${toneText(cur.lockB / 100)}`,
        value: cur?.lockB === undefined ? 0.5 : toneToKnob(cur.lockB),
        def: 0.5,
        onChange: (v, f) => change('B', v, f, 0.5, knobToTone),
      },
    };
  }
  if (mode === 'bpm') {
    return {
      title: 'BPM',
      a: { label: 'Tempo', text: `TEMPO ${p.bpm}`, value: (p.bpm - 40) / 200, def: 0.4, onChange: (v, f) => (f && markUsed(), setBpm(Math.round(40 + clamp01(v) * 200))) },
      b: { label: 'Swing', text: `SWING ${p.swing}%`, value: (p.swing - 50) / 25, def: 0, onChange: (v, f) => (f && markUsed(), setSwing(Math.round(50 + clamp01(v) * 25))) },
    };
  }
  if (mode === 'tune') {
    const nScales = SCALE_IDS.length;
    const si = Math.max(0, SCALE_IDS.indexOf(p.scale));
    const shortScale = (id: (typeof SCALE_IDS)[number]) => SCALES[id].name.replace('Chromatic', 'Chrom').replace('Major pentatonic', 'Maj pent').replace('Minor pentatonic', 'Min pent');
    const say = () => {
      const q = project.peek();
      lcdMessage(`KEY ${KEY_NAMES[q.key]} ${shortScale(q.scale)}`);
    };
    return {
      title: `KEY ${KEY_NAMES[p.key]} · ${shortScale(p.scale)}`.toUpperCase(),
      a: {
        label: 'Key',
        text: `KEY ${KEY_NAMES[p.key]}`,
        value: p.key / 11,
        def: 0,
        onChange: (v, f) => {
          const mk = key('A', f, 100);
          const k = Math.round(clamp01(v) * 11);
          if (k === project.peek().key) return;
          apply((q) => setKey(q, k), { merge: mk });
          say();
        },
      },
      b: {
        label: 'Scale',
        text: `SCALE ${shortScale(p.scale)}`.toUpperCase(),
        value: si / (nScales - 1),
        def: 0,
        onChange: (v, f) => {
          const mk = key('B', f, 100);
          const id = SCALE_IDS[Math.round(clamp01(v) * (nScales - 1))]!;
          if (id === project.peek().scale) return;
          apply((q) => setScale(q, id), { merge: mk });
          say();
        },
      },
    };
  }
  if (mode === 'trim' && s) {
    if (s.kind === 'drum') {
      return {
        title: `SOUND ${pad(i)}`,
        a: {
          label: 'Volume',
          text: `VOL ${Math.round(s.volume * 100)}%`,
          value: s.volume,
          def: 0.8,
          onChange: (v, f) => (f && markUsed(), apply((q) => updateSound(q, i, { volume: Math.round(clamp01(v) * 100) / 100 }), { merge: key('A', f, i) })),
        },
        b: { label: 'n/a', text: '—', value: 0, def: 0, disabled: true, onChange: () => {} },
      };
    }
    return {
      title: `SOUND ${pad(i)} TRIM`,
      a: {
        label: 'Trim start',
        text: `START ${Math.round(s.start * 100)}%`,
        value: s.start,
        def: 0,
        onChange: (v, f) => (f && markUsed(), apply((q) => updateSound(q, i, { start: Math.min(clamp01(v), (q.sounds[i]?.end ?? 1) - 0.01) }), { merge: key('A', f, i) })),
      },
      b: {
        label: 'Trim end',
        text: `END ${Math.round(s.end * 100)}%`,
        value: s.end,
        def: 1,
        onChange: (v, f) => (f && markUsed(), apply((q) => updateSound(q, i, { end: Math.max(clamp01(v), (q.sounds[i]?.start ?? 0) + 0.01) }), { merge: key('B', f, i) })),
      },
    };
  }
  const pitch = s?.pitch ?? 0;
  const tone = s?.tone ?? 0;
  return {
    title: s ? (writeMode.value ? `WRITE · ${keyLabel(s, (lastKeyVer.value, lastKey[i] ?? 0), p)}` : `${pad(i)} ${s.name}`).toUpperCase() : pad(i),
    a: {
      label: 'Pitch',
      text: `PITCH ${signed(Math.round(pitch))}`,
      value: (pitch + 12) / 24,
      def: 0.5,
      onChange: (v, f) => apply((q) => updateSound(q, i, { pitch: Math.round(-12 + clamp01(v) * 24) }), { merge: key('A', f, i) }),
    },
    b: {
      label: 'Tone',
      text: `TONE ${toneText(tone)}`,
      value: (tone + 1) / 2,
      def: 0.5,
      onChange: (v, f) => apply((q) => updateSound(q, i, { tone: Math.abs(v - 0.5) < 0.02 ? 0 : Math.round((clamp01(v) * 2 - 1) * 100) / 100 }), { merge: key('B', f, i) }),
    },
  };
}
