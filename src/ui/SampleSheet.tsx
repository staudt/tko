import { useEffect, useRef, useState } from 'preact/hooks';
import { apply, project, updateSound } from '../store/project';
import { MAX_TOTAL_SECONDS, getSample } from '../store/samples';
import { previewSample, previewState, stopPreview } from './preview';
import { sampleSheetOpen, sampling, samplingSlot, selectedSound } from './state';
import { Sheet } from './Sheet';
import { Waveform } from './Waveform';
import { beginRecord, cropSlot, clearSlot, endRecord, importFile, MAX_RECORD_SECONDS, meter, normalizeSlot, resampleInto, resampleProgress, resampleState, restoreFactory, reverseSlot, setKind, sliceCurrent, usedSeconds } from './sampling';

const pad2 = (n: number) => String(n + 1).padStart(2, '0');

function LevelMeter() {
  const bar = useRef<HTMLElement>(null);
  const txt = useRef<HTMLElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (bar.current) bar.current.style.width = `${Math.round(Math.min(1, Math.sqrt(meter.level)) * 100)}%`;
      if (txt.current) txt.current.textContent = `${meter.elapsed.toFixed(1)} / ${MAX_RECORD_SECONDS} s`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div class="lvl" data-testid="level">
      <div class="lvl-bar">
        <i ref={bar} />
      </div>
      <small ref={txt} />
    </div>
  );
}

export function SampleSheet() {
  const open = sampleSheetOpen.value;
  const slot = selectedSound.value;
  const s = project.value.sounds[slot];
  const [editing, setEditing] = useState(false);
  const [resN, setResN] = useState(1);
  const [confirm, setConfirm] = useState<'clear' | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [lenS, setLenS] = useState(0);
  const sid = s?.sampleId ?? null;
  useEffect(() => {
    let live = true;
    setLenS(0);
    if (sid) void getSample(sid).then((x) => live && x && setLenS(x.l.length / x.rate), () => {});
    return () => {
      live = false;
    };
  }, [sid]);
  const close = () => {
    stopPreview();
    if (sampling.peek() && samplingSlot.peek() === slot) void endRecord();
    setEditing(false);
    setConfirm(null);
    sampleSheetOpen.value = false;
  };
  useEffect(() => {
    setEditing(false);
    setConfirm(null);
  }, [slot, open]);

  const has = !!s?.sampleId;
  const drum = s?.kind === 'drum';
  const recHere = sampling.value && samplingSlot.value === slot;
  const busy = resampleState.value !== 'idle';
  const used = usedSeconds.value;
  const full = used >= MAX_TOTAL_SECONDS;
  const pv = previewState.value;
  const isPlaying = pv.playing && pv.sampleId === s?.sampleId;
  const cropped = !!s && (s.start > 0.001 || s.end < 0.999);

  const rename = (v: string) => {
    const name = v.trim().slice(0, 16);
    setEditing(false);
    if (name && name !== s?.name) apply((p) => updateSound(p, slot, { name }), { merge: `name:${slot}` });
  };

  return (
    <Sheet open={open} onClose={close} label="Sample" title={`Sample · S${pad2(slot)}`}>
      {open && s && (
        <>
          <div class="shead">
            {editing ? (
              <input
                class="nameinp"
                data-testid="name-input"
                maxLength={16}
                defaultValue={s.name}
                autoFocus
                onBlur={(e) => rename((e.currentTarget as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditing(false);
                }}
              />
            ) : (
              <button class="sname" data-testid="sample-name" onClick={() => setEditing(true)}>
                {s.name}
                <small>rename</small>
              </button>
            )}
            <div class="seg2" role="group" aria-label="Kind">
              <button class={`mini${!drum ? ' on' : ''}`} data-testid="kind-melodic" aria-pressed={!drum} onClick={() => setKind(slot, 'melodic')}>
                Melodic
              </button>
              <button class={`mini${drum ? ' on' : ''}`} data-testid="kind-drum" aria-pressed={drum} onClick={() => setKind(slot, 'drum')}>
                Drum
              </button>
            </div>
          </div>

          <div class="prow">
            <button
              class="pbtn"
              data-testid="play-btn"
              data-playing={String(isPlaying)}
              data-previews={pv.n}
              disabled={!has}
              onClick={() => (isPlaying ? stopPreview() : sid && void previewSample(sid, drum ? 0 : s.start, drum ? 1 : s.end))}
            >
              {isPlaying ? 'Stop' : 'Play'}
            </button>
            <div class="pinfo" data-testid="sample-info">
              <span data-testid="sample-len">{has && lenS > 0 ? `${lenS.toFixed(1)} s` : has ? '…' : 'empty'}</span>
              {!drum && has && lenS > 0 && (
                <span data-testid="trim-info">{`trim ${(s.start * lenS).toFixed(2)}–${(s.end * lenS).toFixed(2)} s · ${((s.end - s.start) * lenS).toFixed(2)} s`}</span>
              )}
            </div>
          </div>
          <Waveform slot={slot} />
          <p class="hint">{!has ? 'Empty. Record, import or resample below.' : drum ? 'Tap a slice to hear it. Drag the markers to move them.' : 'Drag the handles to trim. Tap the wave to hear it from there.'}</p>

          <div class="tools">
            {drum && (
              <>
                <button class="wide" data-testid="auto-slice" disabled={!has} onClick={() => void sliceCurrent(slot, 'auto')}>
                  Auto-slice
                </button>
                <button class="wide" data-testid="equal-slices" disabled={!has} onClick={() => void sliceCurrent(slot, 'equal')}>
                  Equal slices
                </button>
              </>
            )}
            <button class="wide" data-testid="normalize" disabled={!has} onClick={() => void normalizeSlot(slot)}>
              Normalize
            </button>
            <button class="wide" data-testid="reverse" disabled={!has} onClick={() => void reverseSlot(slot)}>
              Reverse
            </button>
            {!drum && (
              <button class="wide" data-testid="crop" disabled={!has || !cropped} onClick={() => void cropSlot(slot)}>
                Crop to trim
              </button>
            )}
          </div>

          <div class="setsec">Sources</div>
          <div class="tools">
            <button class={`wide recbtn${recHere ? ' on' : ''}`} data-testid="sample-record" disabled={busy || (full && !recHere)} onClick={() => (recHere ? void endRecord() : void beginRecord(slot))}>
              {recHere ? 'Stop' : 'Record'}
            </button>
            <button class="wide" data-testid="import-btn" disabled={busy || recHere || full} onClick={() => file.current?.click()}>
              Import file
            </button>
            <input
              ref={file}
              class="filein"
              type="file"
              accept="audio/*"
              data-testid="import-file"
              tabIndex={-1}
              onChange={(e) => {
                const el = e.currentTarget as HTMLInputElement;
                const f = el.files?.[0];
                el.value = '';
                if (f) void importFile(slot, f);
              }}
            />
          </div>
          {recHere && <LevelMeter />}
          <div class="resrow">
            <div class="seg2" role="group" aria-label="Patterns to resample">
              {[1, 2, 4].map((n) => (
                <button key={n} class={`mini${resN === n ? ' on' : ''}`} data-testid={`resample-${n}`} aria-pressed={resN === n} onClick={() => setResN(n)}>
                  {n}
                </button>
              ))}
            </div>
            <button class="wide" data-testid="resample-go" disabled={busy || recHere || full} onClick={() => void resampleInto(slot, resN)}>
              {busy ? 'Resampling…' : `Resample ${resN} pattern${resN > 1 ? 's' : ''}`}
            </button>
          </div>
          {busy && (
            <div class="lvl" data-testid="resample-status">
              <div class="lvl-bar">
                <i style={{ width: `${Math.round(resampleProgress.value * 100)}%` }} />
              </div>
              <small>{resampleState.value === 'waiting' ? 'waiting for next pattern…' : 'capturing…'}</small>
            </div>
          )}

          <div class="tools">
            <button class="wide" data-testid="restore-factory" onClick={() => void restoreFactory(slot)}>
              Restore factory
            </button>
            <button class={`wide danger${confirm ? ' armed' : ''}`} data-testid="clear-slot" disabled={!has} onClick={() => (confirm ? (clearSlot(slot), setConfirm(null)) : setConfirm('clear'))}>
              {confirm ? 'Tap to confirm' : 'Clear slot'}
            </button>
          </div>

          <div class="gauge" data-testid="gauge">
            <div class="lvl-bar">
              <i class={full ? 'full' : ''} style={{ width: `${Math.min(100, (used / MAX_TOTAL_SECONDS) * 100)}%` }} />
            </div>
            <small>
              memory {used.toFixed(1)} / {MAX_TOTAL_SECONDS} s{full ? ' · full' : ''}
            </small>
          </div>
        </>
      )}
    </Sheet>
  );
}
