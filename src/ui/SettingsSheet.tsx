import { useEffect, useRef, useState } from 'preact/hooks';
import { ctxTimeOfEvent, playCalibrationClicks } from '../engine/host';
import { calibrationOffset } from '../store/record';
import { Sheet } from './Sheet';
import { OFFSET_MAX, OFFSET_MIN, setSettings, settings } from './settings';
import { projectsOpen, settingsOpen } from './state';
import { project } from '../store/project';
import { resetAll } from './resetAll';
import { ExportRow } from './ExportRow';

type Phase = { t: 'idle' } | { t: 'run'; taps: number } | { t: 'done'; ms: number | null };

function ResetButton() {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <button
      class={`setrow reset${armed ? ' armed' : ''}`}
      data-testid="reset"
      onClick={() => {
        if (!armed) {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 4000);
          return;
        }
        if (timer.current) clearTimeout(timer.current);
        setArmed(false);
        void resetAll();
      }}
    >
      {armed ? 'Tap again to reset this project' : 'Reset to defaults'}
    </button>
  );
}

function Calibrate(p: { onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>({ t: 'idle' });
  const run = useRef<{ taps: number[]; clicks: number[] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const start = async () => {
    const r = { taps: [] as number[], clicks: [] as number[] };
    run.current = r;
    setPhase({ t: 'run', taps: 0 });
    r.clicks = await playCalibrationClicks(10, 0.5);
    const last = r.clicks[r.clicks.length - 1]!;
    const wait = (last + 0.4 - ctxTimeOfEvent(performance.now())) * 1000;
    timer.current = setTimeout(() => {
      if (run.current !== r) return;
      const lo = r.clicks[0]! - 0.3;
      const hi = last + 0.3;
      const taps = r.taps.filter((t) => t >= lo && t <= hi);
      run.current = null;
      setPhase({ t: 'done', ms: calibrationOffset(r.clicks, taps) });
    }, Math.max(100, wait));
  };

  return (
    <div class="cal" data-testid="cal-view">
      <p class="calhelp">Tap the big pad along with the 10 clicks. Use headphones or the speaker you normally play through.</p>
      <div
        class="tappad calpad"
        role="button"
        aria-label="Calibration tap pad"
        data-testid="cal-pad"
        onPointerDown={(e) => {
          const r = run.current;
          if (!r) return;
          r.taps.push(ctxTimeOfEvent(e.timeStamp));
          setPhase({ t: 'run', taps: r.taps.length });
          const el = e.currentTarget as HTMLElement;
          el.classList.remove('hit');
          void el.offsetWidth;
          el.classList.add('hit');
        }}
      >
        {phase.t === 'run' ? `TAP · ${phase.taps}` : 'TAP'}
      </div>
      {phase.t === 'idle' && (
        <button class="wide" data-testid="cal-start" onClick={() => void start()}>
          Start clicks
        </button>
      )}
      {phase.t === 'run' && <div class="calmsg">Listening… keep tapping with the clicks.</div>}
      {phase.t === 'done' && phase.ms !== null && (
        <div class="calbtns">
          <button
            class="wide use"
            data-testid="cal-use"
            onClick={() => {
              setSettings({ offsetMs: phase.ms! });
              p.onBack();
            }}
          >
            Use {phase.ms} ms
          </button>
          <button class="wide" onClick={() => void start()}>
            Try again
          </button>
        </div>
      )}
      {phase.t === 'done' && phase.ms === null && (
        <>
          <div class="calmsg">Not enough taps matched the clicks. Tap once on every click, as steadily as you can.</div>
          <button class="wide" onClick={() => void start()}>
            Try again
          </button>
        </>
      )}
      <button class="wide quiet" onClick={p.onBack}>
        Back
      </button>
    </div>
  );
}

export function SettingsSheet() {
  const open = settingsOpen.value;
  const s = settings.value;
  const [cal, setCal] = useState(false);
  const close = () => {
    settingsOpen.value = false;
    setCal(false);
  };
  const off = (d: number) => setSettings({ offsetMs: s.offsetMs + d });
  return (
    <Sheet open={open} onClose={close} label="Settings" title={cal ? 'Calibrate latency' : 'Settings'}>
      {cal ? (
        open && <Calibrate onBack={() => setCal(false)} />
      ) : (
        <>
          <div class="setsec">Project</div>
          <button class="setrow" data-testid="projects-row" onClick={() => ((projectsOpen.value = true), (settingsOpen.value = false))}>
            <span>Projects</span>
            <span class="setval">{project.value.name} ›</span>
          </button>
          <div class="setsec">Timing</div>
          <div class="lenrow">
            <span class="lk-name">Latency</span>
            <button class="mini sq" aria-label="Less latency offset" data-testid="lat-minus" onClick={() => off(-1)}>
              −
            </button>
            <input
              type="range"
              min={OFFSET_MIN}
              max={OFFSET_MAX}
              step={1}
              value={s.offsetMs}
              aria-label="Latency offset"
              data-testid="latency-slider"
              onInput={(e) => setSettings({ offsetMs: Number((e.currentTarget as HTMLInputElement).value) })}
            />
            <button class="mini sq" aria-label="More latency offset" data-testid="lat-plus" onClick={() => off(1)}>
              +
            </button>
          </div>
          <div class="latval" data-testid="latency-value">
            {s.offsetMs} ms
          </div>
          <button class="wide" data-testid="calibrate" onClick={() => setCal(true)}>
            Calibrate
          </button>
          <ExportRow />
          <div class="setsec">About</div>
          <div class="links">
            <a href="http://x.com/ricardostaudt" target="_blank" rel="noopener" data-testid="about-author">
              Made by Ricardo Staudt
            </a>
            <a href="https://claude.com/claude-code" target="_blank" rel="noopener" data-testid="about-claude">
              Built with Claude Code
            </a>
            <a href="./licenses/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener">
              About / licenses
            </a>
            <a href="./licenses/ASSET_LICENSES.md" target="_blank" rel="noopener">
              Sound and asset licenses
            </a>
          </div>
          <ResetButton />
        </>
      )}
    </Sheet>
  );
}
