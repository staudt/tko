import { project } from '../store/project';
import { playing } from '../engine/host';
import { metronomeWanted, settings } from './settings';
import { recArmed, recHold, tapCollecting, tapPulse, tempoDragging } from './state';

const HINT_KEY = 'tko.tempoHint';
const HINT_LAUNCHES = 3;
/** Counted once per app launch (module load): the first few launches nudge the number to show it can be swiped. */
const nudge = (() => {
  try {
    const n = Number(localStorage.getItem(HINT_KEY) ?? '0') || 0;
    if (n >= HINT_LAUNCHES) return false;
    localStorage.setItem(HINT_KEY, String(n + 1));
    return true;
  } catch {
    return false;
  }
})();

/** Tempo pill: drag = tempo, tap = tap tempo, long-press = presets (see tempo.ts). */
export function TempoPill() {
  const p = project.value;
  const collecting = tapCollecting.value;
  const metro = metronomeWanted(settings.value, recArmed.value || recHold.value, playing.value);
  return (
    <div class={`tempo${collecting ? ' collecting' : ''}${tempoDragging.value ? ' dragging' : ''}`} data-ctl="tempo" data-testid="tempo" role="button" aria-label="Tempo" aria-valuenow={p.bpm}>
      <span class="tp-chev l" data-testid="tempo-chev-l" aria-hidden="true">‹</span>
      <span class={`tp-body${nudge ? ' nudge' : ''}`}>
        <span class="tp-num" data-testid="tempo-num">{collecting ? 'TAP' : `♩ ${p.bpm}`}</span>
        {(!collecting && (p.swing !== 50 || metro)) && (
          <span class="tp-side">
            {p.swing !== 50 && <span data-testid="tempo-swing">SW {p.swing}%</span>}
            {metro && <i class="tp-dot" data-testid="tempo-metro" />}
          </span>
        )}
      </span>
      <span class="tp-chev r" data-testid="tempo-chev-r" aria-hidden="true">›</span>
      {tapPulse.value > 0 && <i class="tp-flash" key={tapPulse.value} />}
    </div>
  );
}
