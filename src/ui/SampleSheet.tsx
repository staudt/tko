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

function TBtn(p: { id: string; label: string; icon: string; onClick: () => void; disabled?: boolean; cls?: string; aria?: string; fill?: boolean }) {
  return (
    <button class={`tbtn ${p.cls ?? ''}`} data-testid={p.id} aria-label={p.aria ?? p.label} disabled={p.disabled} onClick={p.onClick}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill={p.fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d={p.icon} />
      </svg>
      <span aria-hidden="true">{p.label}</span>
    </button>
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
    <Sheet open={open} onClose={close} label="Sample" title={null}>
      {open && s && (
        <>
          <div class="shead">
            <span class="sbadge" data-testid="slot-badge">{`S${pad2(slot)}`}</span>
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
              <button class="sname" data-testid="sample-name" aria-label={`Rename ${s.name}`} onClick={() => setEditing(true)}>
                <span class="nm">{s.name}</span>
                <small aria-hidden="true">✎</small>
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
              aria-label={isPlaying ? 'Stop' : 'Play'}
              disabled={!has}
              onClick={() => (isPlaying ? stopPreview() : sid && void previewSample(sid, drum ? 0 : s.start, drum ? 1 : s.end))}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                {isPlaying ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /> : <path d="M8 5.5v13l11-6.5z" fill="currentColor" />}
              </svg>
            </button>
            <div class="pinfo" data-testid="sample-info">
              <span data-testid="sample-len">{has && lenS > 0 ? `${lenS.toFixed(1)} s` : has ? '…' : 'empty'}</span>
              {!drum && has && lenS > 0 && (
                <span class="trim" data-testid="trim-info">{`trim ${(s.start * lenS).toFixed(2)}–${(s.end * lenS).toFixed(2)} s · ${((s.end - s.start) * lenS).toFixed(2)} s`}</span>
              )}
            </div>
            {drum && (
              <div class="stepper" data-testid="slice-stepper">
                <button class="wide" data-testid="slices-minus" aria-label="Fewer slices" disabled={!has || nSlices <= 1} onClick={() => void sliceCurrent(slot, { equal: nSlices - 1 })}>
                  −
                </button>
                <span class="cnt" data-testid="slice-count">{`${nSlices} slice${nSlices === 1 ? '' : 's'}`}</span>
                <button class="wide" data-testid="slices-plus" aria-label="More slices" disabled={!has || nSlices >= 16} onClick={() => void sliceCurrent(slot, { equal: nSlices + 1 })}>
                  +
                </button>
              </div>
            )}
          </div>
          <Waveform slot={slot} />
          <p class="hint">{!has ? 'Empty. Record or import below.' : drum ? 'tap hear · drag move · hold remove · 2×tap add' : 'drag handles to trim · tap to hear'}</p>

          <div class="tools">
            {drum && (
              <TBtn id="auto-slice" label="Auto-slice" icon="M4 5v14M10 5v14M16 5v14M21 5v14" disabled={!has} onClick={() => void sliceCurrent(slot, 'auto')} />
            )}
            <TBtn id="reverse" label="Reverse" icon="M9 7L4 12l5 5M4 12h16" disabled={!has} onClick={() => void reverseSlot(slot)} />
            {!drum && <TBtn id="crop" label="Crop" icon="M7 3v14h14M3 7h14v14" disabled={!has || !cropped} onClick={() => void cropSlot(slot)} />}
          </div>

          <div class="tools">
            <TBtn cls={`recbtn${recHere ? ' on' : ''}`} id="sample-record" label={recHere ? 'Stop' : 'Record'} icon={recHere ? 'M7 7h10v10H7z' : 'M12 6a6 6 0 100 12 6 6 0 000-12z'} fill disabled={full && !recHere} onClick={() => (recHere ? void endRecord() : void beginRecord(slot))} />
            <TBtn id="import-btn" label="Import" icon="M12 4v12M7 11l5 5 5-5M5 20h14" disabled={recHere || full} onClick={() => file.current?.click()} />
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
            <TBtn id="restore-factory" label="Factory" aria="Restore factory" icon="M4 12a8 8 0 108-8M4 4v5h5" onClick={() => void restoreFactory(slot)} />
            <TBtn cls={`danger${confirm ? ' armed' : ''}`} id="clear-slot" label={confirm ? 'Confirm' : 'Clear'} aria={confirm ? 'Tap to confirm' : 'Clear slot'} icon="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" disabled={!has} onClick={() => (confirm ? (clearSlot(slot), setConfirm(null)) : setConfirm('clear'))} />
          </div>
          {recHere && <LevelMeter />}

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
