import { render } from 'preact';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './ui/tokens.css';
import './ui/ui.css';
import { Lcd } from './lcd/Lcd';
import { Knob } from './ui/Knob';
import { FnButton } from './ui/Controls';
import { applyFactoryMeta } from './store/factoryMeta';

const Cell = ({ label, children }: { label: string; children: preact.ComponentChildren }) => (
  <div class="ld-cell">
    <div class="ro-title">{label}</div>
    {children}
  </div>
);

function LookDev() {
  return (
    <div class="ld">
      <h1>tko look-dev</h1>
      <Lcd />
      <div class="ld-row">
        <Cell label="idle"><div class="pad ld-pad"><i class="dot" /><span class="num">1</span></div></Cell>
        <Cell label="pressed"><div class="pad on ld-pad"><i class="dot" /><span class="num">2</span></div></Cell>
        <Cell label="dot on"><div class="pad ld-pad"><i class="dot on" /><span class="num">3</span></div></Cell>
        <Cell label="sound mode"><div class="pad on m-sound ld-pad"><i class="dot on" /><span class="num">4</span><span class="lbl">Glass</span><span class="sub">melodic</span></div></Cell>
      </div>
      <div class="ld-row">
        <Cell label="knob 0"><Knob letter="A" label="a" value={0} def={0} onChange={() => {}} /></Cell>
        <Cell label="knob .5"><Knob letter="A" label="b" value={0.5} def={0.5} onChange={() => {}} /></Cell>
        <Cell label="knob 1"><Knob letter="B" label="c" value={1} def={1} onChange={() => {}} /></Cell>
        <Cell label="disabled"><Knob letter="B" label="d" value={0.3} def={0} disabled onChange={() => {}} /></Cell>
      </div>
      <div class="ld-row">
        <FnButton id="x1" label="SOUND" icon="sound" />
        <FnButton id="x2" label="BPM" icon="bpm" lit />
        <FnButton id="x3" label="REC" icon="rec" variant="rec" lit />
        <FnButton id="x4" label="FX" icon="fx" variant="fx" />
      </div>
    </div>
  );
}

void applyFactoryMeta().catch(() => {});
render(<LookDev />, document.getElementById('app')!);
