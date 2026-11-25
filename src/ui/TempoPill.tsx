import { project } from '../store/project';
import { playing } from '../engine/host';
import { metronomeWanted, settings } from './settings';
import { recArmed, tapCollecting, tapPulse } from './state';

/** Tempo pill: drag = tempo, tap = tap tempo, long-press = presets (see tempo.ts). */
export function TempoPill() {
  const p = project.value;
  const collecting = tapCollecting.value;
  const metro = metronomeWanted(settings.value, recArmed.value, playing.value);
  return (
    <div class={`tempo${collecting ? ' collecting' : ''}`} data-ctl="tempo" data-testid="tempo" role="button" aria-label="Tempo" aria-valuenow={p.bpm}>
      <span class="tp-num" data-testid="tempo-num">{collecting ? 'TAP' : `♩ ${p.bpm}`}</span>
      {(!collecting && (p.swing !== 50 || metro)) && (
        <span class="tp-side">
          {p.swing !== 50 && <span data-testid="tempo-swing">SW {p.swing}%</span>}
          {metro && <i class="tp-dot" data-testid="tempo-metro" />}
        </span>
      )}
      {tapPulse.value > 0 && <i class="tp-flash" key={tapPulse.value} />}
    </div>
  );
}
