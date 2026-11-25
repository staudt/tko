import { useEffect, useRef } from 'preact/hooks';
import { Lcd } from '../lcd/Lcd';
import { Knob } from '../ui/Knob';
import { FnButton, Icon, PadGrid } from '../ui/Controls';
import { SoundSheet } from '../ui/SoundSheet';
import { PatternSheet } from '../ui/PatternSheet';
import { BpmSheet } from '../ui/BpmSheet';
import { EraseSheet } from '../ui/EraseSheet';
import { StepSheet } from '../ui/StepSheet';
import { startPlayhead } from '../ui/playhead';
import { canRedo, canUndo, redo, undo } from '../store/project';
import { hintText, knobSpecs } from '../ui/knobMap';
import { attachRouter } from '../ui/input/router';
import { handlers } from '../ui/controls';
import { SettingsSheet } from '../ui/SettingsSheet';
import { locked, selectedSound, settingsOpen } from '../ui/state';

export function KnobRow() {
  const { title, a, b } = knobSpecs();
  return (
    <div class="knobs">
      <div class="knob-col">
        <Knob letter="A" testId="knob-a" label={a.label} value={a.value} def={a.def} disabled={a.disabled} onChange={a.onChange} />
        <div class={`knob-label${a.disabled ? ' dim' : ''}`} data-testid="knob-a-label">{a.text}</div>
      </div>
      <div class="readout" data-testid="readout">
        <div class="ro-title">{title}</div>
        <div class="ro-hint" data-testid="hint">{hintText()}</div>
      </div>
      <div class="knob-col">
        <Knob letter="B" testId="knob-b" label={b.label} value={b.value} def={b.def} disabled={b.disabled} onChange={b.onChange} />
        <div class={`knob-label${b.disabled ? ' dim' : ''}`} data-testid="knob-b-label">{b.text}</div>
      </div>
    </div>
  );
}

export function Instrument() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => (root.current ? attachRouter(root.current, handlers) : undefined), []);
  useEffect(() => (root.current ? startPlayhead(root.current) : undefined), []);
  return (
    <div class="app" ref={root} data-sound={selectedSound.value}>
      <header class="hdr">
        <span class="hdr-l">
          <button class="lock" aria-label="Settings" data-testid="menu" onClick={() => (settingsOpen.value = true)}>
            <Icon name="menu" />
          </button>
          <span class="brand">tko</span>
        </span>
        <span class="hdr-r">
        <button class="lock" aria-label="Undo" disabled={!canUndo.value} onClick={() => undo()}>
          <Icon name="undo" />
        </button>
        <button class="lock" aria-label="Redo" disabled={!canRedo.value} onClick={() => redo()}>
          <Icon name="redo" />
        </button>
        <button class={`lock${locked.value ? ' on' : ''}`} aria-label="Lock" aria-pressed={locked.value} onClick={() => (locked.value = !locked.value)}>
          <Icon name="lock" />
        </button>
        </span>
      </header>
      <Lcd />
      <KnobRow />
      <div class="fnrow">
        <FnButton id="fn:sound" label="SOUND" icon="sound" />
        <FnButton id="fn:pattern" label="PATTERN" icon="pattern" />
        <FnButton id="fn:bpm" label="BPM" icon="bpm" />
        <FnButton id="fn:sample" label="SAMPLE" icon="sample" />
        <FnButton id="fn:erase" label="ERASE" icon="erase" variant="erase" />
      </div>
      <PadGrid />
      <SoundSheet />
      <PatternSheet />
      <BpmSheet />
      <EraseSheet />
      <StepSheet />
      <SettingsSheet />
      <div class="rotate">Rotate your phone</div>
    </div>
  );
}

export function App() {
  return <Instrument />;
}
