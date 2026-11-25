import type { ComponentChildren } from 'preact';
import { FX_DEFS } from '../engine/fx/ids';
import { playing } from '../engine/host';
import { project } from '../store/project';
import { audPattern, chainDraft, editPattern, heldControls, queuedPattern, selectedSound, writeMode } from './state';
import { getStep, patternIsEmpty } from '../store/edit';
import { hasExtras, stepLabel } from './stepHelpers';

export const Icon = ({ name }: { name: string }) => {
  const paths: Record<string, ComponentChildren> = {
    sound: <path d="M4 10v4h3l5 4V6L7 10zM15 9a4 4 0 0 1 0 6M17.5 6.5a8 8 0 0 1 0 11" />,
    pattern: <path d="M4 6h4v4H4zM10 6h4v4h-4zM16 6h4v4h-4zM4 14h4v4H4zM10 14h4v4h-4z" />,
    bpm: <path d="M12 3l-6 18h12zM12 8v8M12 16l5-6" />,
    rec: <circle cx="12" cy="12" r="6" />,
    fx: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
    play: <path d="M7 4v16l13-8z" />,
    write: <path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4" />,
    undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
    redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />,
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

const shortName = (n: string) => n.split(' ')[0]!;

export function Pad({ k }: { k: number }) {
  const held = heldControls.value;
  const sel = selectedSound.value;
  const sounds = project.value.sounds;
  const soundMode = held.has('fn:sound');
  const fxMode = !soundMode && held.has('btn:fx');
  const patMode = !soundMode && !fxMode && held.has('fn:pattern');
  const bpmMode = !soundMode && !fxMode && !patMode && held.has('fn:bpm');
  const writing = !soundMode && !fxMode && !patMode && !bpmMode && writeMode.value;
  const pressed = held.has(`pad:${k}`);
  let lit = false;
  let label = '';
  let sub = '';
  let dot = false;
  let cls = '';
  if (soundMode) {
    lit = k === sel;
    label = shortName(sounds[k]?.name ?? '');
    sub = k < 8 ? 'melodic' : 'drum';
    dot = !!sounds[k]?.sampleId;
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
    if (pos >= 0 && (draft.length || chain.length > 1)) sub = `#${pos + 1}`;
  } else if (bpmMode) {
    const lvl = Math.round(project.value.volume * 16);
    lit = k + 1 <= lvl;
    label = `${Math.round(((k + 1) / 16) * 100)}%`;
    sub = k === 0 ? 'volume' : '';
    cls += k + 1 === lvl ? ' top' : '';
  } else if (writing) {
    const d = getStep(project.value, editPattern.value, sel, k);
    lit = !!d;
    dot = !!d && hasExtras(d);
    label = d ? stepLabel(sounds[sel], d) : '';
  } else {
    const s = sounds[sel];
    dot = s?.kind === 'drum' ? k < (s.slices.length > 1 ? s.slices.length - 1 : 16) : k === 0;
  }
  const mode = soundMode ? 'sound' : fxMode ? 'fx' : patMode ? 'pattern' : bpmMode ? 'bpm' : writing ? 'write' : '';
  const on = pressed || (soundMode && lit);
  return (
    <div
      class={`pad${on ? ' on' : ''}${lit && !soundMode ? ' lit' : ''}${mode ? ` m-${mode}` : ''}${cls}`}
      data-ctl={`pad:${k}`}
      data-testid={`pad-${k + 1}`}
      role="button"
      aria-label={`Pad ${k + 1}`}
      style={{ gridColumn: (k % 4) + 2, gridRow: Math.floor(k / 4) + 1 }}
    >
      <i class={dot ? 'dot on' : 'dot'} />
      <span class="num">{k + 1}</span>
      {label && <span class="lbl">{label}</span>}
      {sub && <span class="sub">{sub}</span>}
    </div>
  );
}

export function PadGrid() {
  const soundMode = heldControls.value.has('fn:sound');
  const write = writeMode.value;
  return (
    <div class="pads">
      <div class={`bracket top${soundMode ? ' hot' : ''}`} style={{ gridRow: '1 / 3' }}>
        <span>melodic</span>
      </div>
      <div class={`bracket bottom${soundMode ? ' hot' : ''}`} style={{ gridRow: '3 / 5' }}>
        <span>drum</span>
      </div>
      {Array.from({ length: 16 }, (_, k) => (
        <Pad key={k} k={k} />
      ))}
      <div class="side" style={{ gridColumn: 6, gridRow: 1 }}>
        <FnButton id="btn:rec" label="REC" icon="rec" variant="rec" />
      </div>
      <div class="side" style={{ gridColumn: 6, gridRow: 2 }}>
        <FnButton id="btn:fx" label="FX" icon="fx" variant="fx" />
      </div>
      <div class="side" style={{ gridColumn: 6, gridRow: 3 }}>
        <FnButton id="btn:play" label="PLAY" icon="play" lit={playing.value} />
      </div>
      <div class="side" style={{ gridColumn: 6, gridRow: 4 }}>
        <FnButton id="btn:write" label="WRITE" icon="write" lit={write} />
      </div>
    </div>
  );
}
