import { useState } from 'preact/hooks';
import { cancelExport, exportSeconds, exportState, runExport } from './exportWav';

export function ExportRow() {
  const [loops, setLoops] = useState(1);
  const st = exportState.value;
  return (
    <>
      <div class="setsec">Export</div>
      <div class="exrow" data-testid="export-row">
        <div class="seg2" role="group" aria-label="Loops">
          {[1, 2, 4].map((n) => (
            <button key={n} class={`mini${loops === n ? ' on' : ''}`} data-testid={`export-x${n}`} aria-pressed={loops === n} disabled={st.busy} onClick={() => setLoops(n)}>
              {`${n}×`}
            </button>
          ))}
        </div>
        <button class="wide" data-testid="export-wav" disabled={st.busy} onClick={() => void runExport(loops)}>
          Export WAV
        </button>
      </div>
      {st.busy ? (
        <div class="exprog" data-testid="export-progress">
          <div class="lvl-bar">
            <i style={{ width: `${Math.round(st.frac * 100)}%` }} />
          </div>
          <small>{`Recording ${(st.frac * st.total).toFixed(1)} / ${st.total.toFixed(1)} s…`}</small>
          <button class="mini" data-testid="export-cancel" onClick={cancelExport}>
            Cancel
          </button>
        </div>
      ) : (
        <small class="exhint">{`${exportSeconds(loops).toFixed(1)} s of the current chain, mono WAV`}</small>
      )}
    </>
  );
}
