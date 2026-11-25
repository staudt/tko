import { useState } from 'preact/hooks';
import { apply, project } from '../store/project';
import { clearLane, clearPattern, patternDensity, patternIsEmpty, setPattern } from '../store/edit';
import type { Pattern } from '../store/types';
import { audPattern, editPattern, patternSheetOpen, selectedSound } from './state';
import { Sheet } from './Sheet';
import { setChainAndEdit } from './controls';
import { lcdMessage } from '../lcd/message';

const densityCache = new WeakMap<Pattern, number[]>();
const density = (p: Pattern): number[] => {
  let d = densityCache.get(p);
  if (!d) densityCache.set(p, (d = patternDensity(p)));
  return d;
};
let clipboard: Pattern | null = null;

export function PatternSheet() {
  const open = patternSheetOpen.value;
  const close = () => (patternSheetOpen.value = false);
  const p = project.value;
  const edit = editPattern.value;
  const playingPat = audPattern.value;
  const [chaining, setChaining] = useState(false);
  const [draft, setDraft] = useState<number[]>([]);
  const [hasClip, setHasClip] = useState(clipboard !== null);
  const snd = selectedSound.value;
  const chain = chaining ? draft : p.chain;

  const done = () => {
    if (draft.length) setChainAndEdit(draft);
    setChaining(false);
    setDraft([]);
  };
  return (
    <Sheet open={open} onClose={() => (chaining ? done() : null, close())} label="Patterns">
      <div class="chainbar">
        <button class={`mini${chaining ? ' on' : ''}`} aria-pressed={chaining} data-testid="chain-toggle" onClick={() => (chaining ? done() : (setChaining(true), setDraft([])))}>
          {chaining ? 'Done' : 'Chain'}
        </button>
        <span class="chaintxt">{chaining ? (draft.length ? draft.map((x) => x + 1).join(' → ') : 'tap patterns in order') : `Chain ${p.chain.map((x) => x + 1).join(' → ')}`}</span>
      </div>
      <div class="cards pcards">
        {p.patterns.map((pt, k) => {
          const d = density(pt);
          const pos = chain.indexOf(k);
          return (
            <button
              key={k}
              class={`card pcard${k === edit ? ' sel' : ''}${k === playingPat ? ' playing' : ''}${pos >= 0 ? ' inchain' : ''}`}
              data-testid={`pcard-${k + 1}`}
              onClick={() => {
                if (chaining) setDraft((x) => (x.includes(k) ? x : [...x, k]));
                else {
                  setChainAndEdit([k]);
                }
              }}
            >
              <span class="cn">{String(k + 1).padStart(2, '0')}</span>
              <span class="mini-bars" aria-hidden="true">
                {d.map((n, i) => (
                  <i key={i} style={{ height: `${Math.min(100, n * 45)}%`, opacity: n ? 1 : 0.15 }} />
                ))}
              </span>
              {pos >= 0 && (chain.length > 1 || chaining) && <span class="chn">{pos + 1}</span>}
              {patternIsEmpty(pt) && <span class="empty">empty</span>}
            </button>
          );
        })}
      </div>
      <div class="actions">
        <button
          class="act"
          data-testid="act-copy"
          onClick={() => {
            clipboard = project.peek().patterns[edit] ?? null;
            setHasClip(true);
            lcdMessage('COPIED');
          }}
        >
          Copy
        </button>
        <button
          class="act"
          data-testid="act-paste"
          disabled={!hasClip}
          onClick={() => {
            const c = clipboard;
            if (!c) return;
            apply((q) => setPattern(q, edit, c));
            lcdMessage('PASTED');
          }}
        >
          Paste
        </button>
        <button
          class="act danger"
          data-testid="act-clear-pattern"
          onClick={() => {
            apply((q) => clearPattern(q, edit));
            lcdMessage('CLEARED');
          }}
        >
          Clear pattern
        </button>
        <button
          class="act danger"
          data-testid="act-clear-lane"
          onClick={() => {
            apply((q) => clearLane(q, edit, snd));
            lcdMessage('LANE CLEARED');
          }}
        >
          Clear lane
        </button>
      </div>
    </Sheet>
  );
}
