import { apply, project } from '../store/project';
import { clearPattern, setPattern } from '../store/edit';
import { lcdMessage } from '../lcd/message';
import { padPopover, patternClip } from './state';
import { popoverClearSound, popoverEditSample } from './controls';
import { targetPattern } from './erase';

const pad2 = (n: number) => String(n + 1).padStart(2, '0');

/**
 * Small inline action popover anchored on a long-pressed pad of the SOUND / PATTERN tab. It sits in the
 * pad's grid cell (absolute), opens below the pad in the top two rows and above it in the bottom two.
 */
export function PadPopover() {
  const pop = padPopover.value;
  if (!pop) return null;
  const { kind, k } = pop;
  const col = k % 4;
  const row = Math.floor(k / 4);
  const close = () => (padPopover.value = null);
  const run = (fn: () => void) => () => {
    fn();
    close();
  };
  const clip = patternClip.value;
  const side = col === 0 ? { left: '0' } : col === 3 ? { right: '0' } : { left: '50%', transform: 'translateX(-50%)' };
    return (
    <>
      <div class="pop-backdrop" data-testid="pop-backdrop" onPointerDown={close} />
      <div class={`popwrap${row < 2 ? ' below' : ' above'}`} style={{ gridColumn: col + 1, gridRow: row + 1 }}>
        <div class="popover" role="menu" data-testid="popover" style={side}>
          {kind === 'sound' ? (
            <>
              <button role="menuitem" class="danger" data-testid="pop-clear" onClick={run(() => popoverClearSound(k))}>
                Clear in P{pad2(targetPattern())}
              </button>
              <button role="menuitem" data-testid="pop-sample" onClick={run(() => popoverEditSample(k))}>
                Edit sample
              </button>
            </>
          ) : (
            <>
              <button
                role="menuitem"
                data-testid="pop-copy"
                onClick={run(() => {
                  patternClip.value = project.peek().patterns[k] ?? null;
                  lcdMessage(`COPIED P${pad2(k)}`);
                })}
              >
                Copy
              </button>
              <button
                role="menuitem"
                data-testid="pop-paste"
                disabled={!clip}
                onClick={run(() => {
                  const c = patternClip.peek();
                  if (!c) return;
                  apply((q) => setPattern(q, k, c));
                  lcdMessage(`PASTED P${pad2(k)}`);
                })}
              >
                Paste
              </button>
              <button role="menuitem" class="danger" data-testid="pop-clear" onClick={run(() => (apply((q) => clearPattern(q, k)), lcdMessage(`CLEAR P${pad2(k)}`)))}>
                Clear
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
