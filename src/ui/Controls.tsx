import type { ComponentChildren } from 'preact';
import { FX_DEFS } from '../engine/fx/ids';
import { playing } from '../engine/host';
import { project } from '../store/project';
import { audPattern, chainDraft, editPattern, heldControls, lastKey, lastKeyVer, padMode, padPopover, queuedPattern, selectedSound, recArmed, writeMode, eraseFlash, sampling, samplingSlot } from './state';
import { getStep, patternDensity, patternIsEmpty } from '../store/edit';
import type { Pattern } from '../store/types';
import { PadPopover } from './PadPopover';
import { targetPattern } from './erase';
import { hasExtras, isTonic, keyLabel, shortHit, stepLabel } from './stepHelpers';

export const Icon = ({ name }: { name: string }) => {
  const paths: Record<string, ComponentChildren> = {
    sound: <path d="M4 10v4h3l5 4V6L7 10zM15 9a4 4 0 0 1 0 6M17.5 6.5a8 8 0 0 1 0 11" />,
    pattern: <path d="M4 6h4v4H4zM10 6h4v4h-4zM16 6h4v4h-4zM4 14h4v4H4zM10 14h4v4h-4z" />,
    bpm: <path d="M12 3l-6 18h12zM12 8v8M12 16l5-6" />,
    sample: <path d="M9 4h6v8a3 3 0 0 1-6 0zM6 11a6 6 0 0 0 12 0M12 17v3M9 20h6" />,
    erase: <path d="M4 16l9-10a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-6 6H8zM9 11l6 6M12 20h8" />,
    rec: <circle cx="12" cy="12" r="6" />,
    fx: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
    play: <path d="M7 4v16l13-8z" />,
    write: <path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4" />,
    undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
    redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    lock: <path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z" />,
  };
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
};

export function FnButton(props: { id: string; label: string; icon: string; variant?: string; lit?: boolean }) {
  const on = props.lit ?? heldControls.value.has(props.id);
  return (
    <div class={`btn ${props.variant ?? ''}${on ? ' on' : ''}`} data-ctl={props.id} role="button" aria-label={props.label} aria-pressed={on}>
      <Icon name={props.icon} />
      <span class="btn-lbl">{props.label}</span>
    </div>
  );
}

const densityCache = new WeakMap<Pattern, number[]>();
const density = (p: Pattern): number[] => {
  let d = densityCache.get(p);
  if (!d) densityCache.set(p, (d = patternDensity(p)));
  return d;
};
/** 16-column step-density bar graph of a pattern (column height = how many sounds hit that step). */
function Bars({ pattern }: { pattern: Pattern | undefined }) {
  const d = pattern ? density(pattern) : [];
  return (
    <span class="bars" aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => {
        const n = d[i] ?? 0;
        return <i key={i} class={n ? 'hit' : ''} style={{ height: n ? `${Math.min(100, 30 + n * 20)}%` : '12%' }} />;
      })}
    </span>
  );
}

const shortName = (n: string) => n.split(' ')[0]!;

export function Pad({ k }: { k: number }) {
  const held = heldControls.value;
  const sel = selectedSound.value;
  const sounds = project.value.sounds;
  const eraseMode = held.has('fn:erase') && !writeMode.value;
  const eraseWrite = held.has('fn:erase') && writeMode.value;
  const has = (id: string) => !eraseMode && !eraseWrite && held.has(id);
  const sampleMode = has('fn:sample') || sampling.value;
  const tab = padMode.value;
  const heldSound = !sampleMode && has('fn:sound');
  const heldFx = !heldSound && has('btn:fx');
  const heldPat = !heldSound && !heldFx && has('fn:pattern');
  const bpmMode = !heldSound && !heldFx && !heldPat && has('fn:bpm');
  const keyPick = !heldSound && !heldFx && !heldPat && !bpmMode && has('btn:write');
  // a latched tab shows when no hold-combo overrides it
  const tabbed = !sampleMode && !eraseMode && !eraseWrite && !heldSound && !heldFx && !heldPat && !bpmMode && !keyPick;
  const soundMode = heldSound || (tabbed && tab === 'sound');
  const fxMode = !soundMode && (heldFx || (tabbed && tab === 'fx'));
  const patMode = !soundMode && !fxMode && (heldPat || (tabbed && tab === 'pattern'));
  const writing = !keyPick && !soundMode && !fxMode && !patMode && !bpmMode && !eraseMode && writeMode.value;
  const pressed = held.has(`pad:${k}`);
  let lit = false;
  let label = '';
  let sub = '';
  let dot = false;
  let cls = '';
  if (sampleMode) {
    lit = k === samplingSlot.value;
    label = shortName(sounds[k]?.name ?? '');
    sub = lit ? 'rec' : sounds[k]?.sampleId ? (k < 8 ? 'melodic' : 'drum') : 'empty';
    dot = !!sounds[k]?.sampleId;
    cls += lit ? ' sampling' : '';
  } else if (eraseMode) {
    label = shortName(sounds[k]?.name ?? '');
    sub = k < 8 ? 'melodic' : 'drum';
    dot = !!project.value.patterns[targetPattern(true)]?.lanes[k]?.some((x) => x);
  } else if (soundMode) {
    lit = k === sel;
    label = shortName(sounds[k]?.name ?? '');
    sub = k < 8 ? 'melodic' : 'drum';
    dot = !!project.value.patterns[targetPattern(true)]?.lanes[k]?.some((x) => x);
  } else if (fxMode) {
    const d = FX_DEFS[k];
    label = d ? d.label : '—';
    sub = d ? d.sub : '';
    dot = !!d;
  } else if (patMode) {
    const draft = chainDraft.value;
    const chain = project.value.chain;
    lit = draft.length ? draft.includes(k) : chain.includes(k);
    label = `P${String(k + 1).padStart(2, '0')}`;
    dot = !patternIsEmpty(project.value.patterns[k]);
    if (audPattern.value === k) cls += ' pulse';
    if (queuedPattern.value === k) cls += ' queued';
    const pos = draft.length ? draft.indexOf(k) : chain.indexOf(k);
    if (pos >= 0 && (draft.length || chain.length > 1)) {
      const src = draft.length ? draft : chain;
      sub = '#' + src.flatMap((x, i) => (x === k ? [i + 1] : [])).slice(0, 3).join('·');
    }
    if (queuedPattern.value === k) sub = sub ? `${sub} next` : 'next';
  } else if (bpmMode) {
    const lvl = Math.round(project.value.volume * 16);
    lit = k + 1 <= lvl;
    label = `${Math.round(((k + 1) / 16) * 100)}%`;
    sub = k === 0 ? 'volume' : '';
    cls += k + 1 === lvl ? ' top' : '';
  } else if (keyPick) {
    lastKeyVer.value;
    lit = (lastKey[sel] ?? 0) === k;
    label = keyLabel(sounds[sel], k, project.value);
    sub = k === (lastKey[sel] ?? 0) ? 'write' : '';
  } else if (writing) {
    const d = getStep(project.value, editPattern.value, sel, k);
    lit = !!d;
    dot = !!d && hasExtras(d);
    label = d ? stepLabel(sounds[sel], d, project.value) : '';
  } else {
    const s = sounds[sel];
    dot = s?.kind === 'drum' ? k < (s.slices.length > 1 ? s.slices.length - 1 : 16) : k === 0;
    label = s?.kind === 'melodic' ? keyLabel(s, k, project.value) : shortHit(s?.hitNames?.[k]);
    if (isTonic(s, k, project.value)) cls += ' tonic';
    cls += ' m-play';
  }
  const mode = sampleMode ? 'sound' : eraseMode ? 'erase' : keyPick ? 'sound' : soundMode ? 'sound' : fxMode ? 'fx' : patMode ? 'pattern' : bpmMode ? 'bpm' : writing ? 'write' : '';
  const flashed = eraseFlash.value === k;
  const on = (pressed && !eraseMode && !sampleMode) || ((soundMode || sampleMode) && lit);
  return (
    <div
      class={`pad${on ? ' on' : ''}${lit && !soundMode && !sampleMode ? ' lit' : ''}${mode ? ` m-${mode}` : ''}${cls}${flashed ? ' eflash' : ''}`}
      data-ctl={`pad:${k}`}
      data-testid={`pad-${k + 1}`}
      role="button"
      aria-label={`Pad ${k + 1}`}
      style={{ gridColumn: (k % 4) + 1, gridRow: Math.floor(k / 4) + 1 }}
    >
      <i class={dot ? 'dot on' : 'dot'} />
      <span class="num">{k + 1}</span>
      {label && <span class="lbl">{label}</span>}
      {sub && <span class="sub">{sub}</span>}
      {patMode && <Bars pattern={project.value.patterns[k]} />}
    </div>
  );
}

export function PadGrid() {
  const write = writeMode.value;
  return (
    <div class="pads">
      {Array.from({ length: 16 }, (_, k) => (
        <Pad key={k} k={k} />
      ))}
      {padPopover.value && <PadPopover />}
      <div class="side" style={{ gridColumn: 5, gridRow: 1 }}>
        <FnButton id="btn:rec" label="REC" icon="rec" variant="rec" lit={recArmed.value || heldControls.value.has('btn:rec')} />
      </div>
      <div class="side" style={{ gridColumn: 5, gridRow: 2 }}>
        <FnButton id="btn:fx" label="FX" icon="fx" variant="fx tab" lit={padMode.value === 'fx' || heldControls.value.has('btn:fx')} />
      </div>
      <div class="side" style={{ gridColumn: 5, gridRow: 3 }}>
        <FnButton id="btn:play" label="PLAY" icon="play" lit={playing.value} />
      </div>
      <div class="side" style={{ gridColumn: 5, gridRow: 4 }}>
        <FnButton id="btn:write" label="WRITE" icon="write" lit={write} />
      </div>
    </div>
  );
}
