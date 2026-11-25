import { useEffect, useRef } from 'preact/hooks';
import { Lcd } from '../lcd/Lcd';
import { Knob } from '../ui/Knob';
import { FnButton, Icon, PadGrid } from '../ui/Controls';
import { SoundSheet } from '../ui/SoundSheet';
import { knobSpecs } from '../ui/knobMap';
import { attachRouter } from '../ui/input/router';
import { handlers } from '../ui/controls';
import { locked, selectedSound } from '../ui/state';

export function KnobRow() {
  const { title, a, b } = knobSpecs();
  return (
    <div class="knobs">
      <Knob letter="A" testId="knob-a" label={a.label} value={a.value} def={a.def} disabled={a.disabled} onChange={a.onChange} />
      <div class="readout" data-testid="readout">
        <div class="ro-title">{title}</div>
        <div class="ro-line">{a.text}</div>
        <div class={`ro-line${b.disabled ? ' dim' : ''}`}>{b.text}</div>
      </div>
      <Knob letter="B" testId="knob-b" label={b.label} value={b.value} def={b.def} disabled={b.disabled} onChange={b.onChange} />
    </div>
  );
}

export function Instrument() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => (root.current ? attachRouter(root.current, handlers) : undefined), []);
  return (
    <div class="app" ref={root} data-sound={selectedSound.value}>
      <header class="hdr">
        <span class="brand">tko</span>
        <button class={`lock${locked.value ? ' on' : ''}`} aria-label="Lock" aria-pressed={locked.value} onClick={() => (locked.value = !locked.value)}>
          <Icon name="lock" />
        </button>
      </header>
      <Lcd />
      <KnobRow />
      <div class="fnrow">
        <FnButton id="fn:sound" label="SOUND" icon="sound" />
        <FnButton id="fn:pattern" label="PATTERN" icon="pattern" />
        <FnButton id="fn:bpm" label="BPM" icon="bpm" />
      </div>
      <PadGrid />
      <SoundSheet />
      <div class="rotate">Rotate your phone</div>
    </div>
  );
}

export function App() {
  return <Instrument />;
}
