// "Reset to defaults": erase the project and all user samples, back to the factory kit. Latency calibration is kept.
import { playing, togglePlay } from '../engine/host';
import { replaceProject } from '../store/project';
import { defaultProject } from '../store/defaults';
import { applyFactoryMeta } from '../store/factoryMeta';
import { deleteSample, listSamples } from '../store/samples';
import { lcdMessage } from '../lcd/message';
import { chainDraft, editPattern, lastKey, lastKeyVer, padMode, padPopover, queuedPattern, recArmed, selectedSound, settingsOpen, stepSheet, writeMode } from './state';

export async function resetAll(): Promise<void> {
  if (playing.peek()) await togglePlay();
  try {
    for (const m of await listSamples()) await deleteSample(m.id);
  } catch {
    /* storage unavailable: nothing to delete */
  }
  replaceProject(defaultProject());
  await applyFactoryMeta();
  selectedSound.value = 0;
  editPattern.value = 0;
  padMode.value = 'play';
  writeMode.value = false;
  recArmed.value = false;
  padPopover.value = null;
  stepSheet.value = null;
  chainDraft.value = [];
  queuedPattern.value = null;
  lastKey.fill(0);
  lastKeyVer.value++;
  try {
    localStorage.removeItem('tko.lastKey');
  } catch {
    /* ignore */
  }
  settingsOpen.value = false;
  lcdMessage('FRESH START');
}
