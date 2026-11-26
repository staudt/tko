// "Reset to defaults": erase the CURRENT project back to the factory kit (same id and name) and the user
// samples no other project uses. Other projects and the latency calibration are kept.
import { playing, togglePlay } from '../engine/host';
import { project, replaceProject } from '../store/project';
import { defaultProject } from '../store/defaults';
import { applyFactoryMeta } from '../store/factoryMeta';
import { deleteUnusedSamples, saveProjectNow } from '../store/persist';
import { lcdMessage } from '../lcd/message';
import { lastKey, lastKeyVer, settingsOpen } from './state';
import { resetUiForProject } from './projects';

export async function resetAll(): Promise<void> {
  if (playing.peek()) await togglePlay();
  const { id, name } = project.peek();
  const fresh = { ...defaultProject(), id, name };
  replaceProject(fresh);
  try {
    await saveProjectNow(fresh);
    await deleteUnusedSamples(id);
  } catch {
    /* storage unavailable: nothing to delete */
  }
  await applyFactoryMeta();
  resetUiForProject();
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
