import { useEffect, useRef, useState } from 'preact/hooks';
import { apply, project, updateSound } from '../store/project';
import { MAX_TOTAL_SECONDS, getSample } from '../store/samples';
import { previewSample, previewState, stopPreview } from './preview';
import { sampleSheetOpen, sampling, samplingSlot, selectedSound } from './state';
import { Sheet } from './Sheet';
import { Waveform } from './Waveform';
import { beginRecord, cropSlot, clearSlot, endRecord, importFile, MAX_RECORD_SECONDS, meter, restoreFactory, reverseSlot, setKind, sliceCurrent, usedSeconds } from './sampling';

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
  const used = usedSeconds.value;
  const full = used >= MAX_TOTAL_SECONDS;
  const pv = previewState.value;
  const isPlaying = pv.playing && pv.sampleId === s?.sampleId;
  const nSlices = s && s.slices.length >= 2 ? s.slices.length - 1 : 16;
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
          <p class="hint">{!has ? 'Empty. Record or import below.' : drum ? 'Tap a slice to hear it · drag markers · hold a marker to remove · double-tap to add' : 'Drag the handles to trim. Tap the wave to hear it from there.'}</p>

          {drum && (
            <div class="stepper" data-testid="slice-stepper">
              <span class="lab">Slices</span>
              <button class="wide" data-testid="slices-minus" aria-label="Fewer slices" disabled={!has || nSlices <= 1} onClick={() => void sliceCurrent(slot, { equal: nSlices - 1 })}>
                −
              </button>
              <span class="cnt" data-testid="slice-count">{`${nSlices} slice${nSlices === 1 ? '' : 's'}`}</span>
              <button class="wide" data-testid="slices-plus" aria-label="More slices" disabled={!has || nSlices >= 16} onClick={() => void sliceCurrent(slot, { equal: nSlices + 1 })}>
                +
              </button>
            </div>
          )}
          <div class="tools">
            {drum && (
              <>
                <button class="wide" data-testid="auto-slice" disabled={!has} onClick={() => void sliceCurrent(slot, 'auto')}>
                  Auto-slice
                </button>
              </>
            )}
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
            <button class={`wide recbtn${recHere ? ' on' : ''}`} data-testid="sample-record" disabled={full && !recHere} onClick={() => (recHere ? void endRecord() : void beginRecord(slot))}>
              {recHere ? 'Stop' : 'Record'}
            </button>
            <button class="wide" data-testid="import-btn" disabled={recHere || full} onClick={() => file.current?.click()}>
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
