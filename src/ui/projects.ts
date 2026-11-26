// Switching between saved projects. Main thread only; the engine follows the project signal via the host.
import { playing, togglePlay } from '../engine/host';
import { project, replaceProject } from '../store/project';
import { defaultProject } from '../store/defaults';
import { applyFactoryMeta } from '../store/factoryMeta';
import { deleteProject as deleteStored, duplicateProject as duplicateStored, listProjects, loadProject, saveProjectNow, setCurrentProject } from '../store/persist';
import type { Project } from '../store/types';
import { lcdMessage } from '../lcd/message';
import { chainDraft, editPattern, padMode, padPopover, queuedPattern, recArmed, selectedSound, stepSheet, writeMode } from './state';

/** Resets what is selected/held in the UI after the project changed. */
export function resetUiForProject(): void {
  selectedSound.value = 0;
  editPattern.value = project.peek().chain[0] ?? 0;
  padMode.value = 'play';
  writeMode.value = false;
  recArmed.value = false;
  padPopover.value = null;
  stepSheet.value = null;
  chainDraft.value = [];
  queuedPattern.value = null;
}

async function show(p: Project): Promise<void> {
  replaceProject(p);
  await applyFactoryMeta().catch(() => {});
  resetUiForProject();
  await setCurrentProject(p.id).catch(() => {});
  lcdMessage(`PROJECT: ${p.name}`);
}

async function stopAndFlush(): Promise<void> {
  if (playing.peek()) await togglePlay();
  await saveProjectNow(project.peek()).catch(() => {});
}

export async function openProject(id: string): Promise<boolean> {
  if (id === project.peek().id) return true;
  await stopAndFlush();
  const p = await loadProject(id);
  if (!p) return false;
  await show(p);
  return true;
}

async function uniqueName(): Promise<string> {
  const names = new Set((await listProjects()).map((x) => x.name));
  let n = names.size + 1;
  while (names.has(`Untitled ${n}`)) n++;
  return `Untitled ${n}`;
}

export async function newProject(): Promise<void> {
  await stopAndFlush();
  const p = { ...defaultProject(), name: await uniqueName() };
  await saveProjectNow(p);
  await show(p);
}

export async function duplicateCurrent(): Promise<void> {
  await duplicateProjectById(project.peek().id);
}

export async function duplicateProjectById(id: string): Promise<void> {
  if (id === project.peek().id) await saveProjectNow(project.peek()).catch(() => {});
  const src = (await listProjects()).find((x) => x.id === id);
  const nid = await duplicateStored(id, `${src?.name ?? 'Project'} copy`);
  if (nid) await openProject(nid);
}

export async function deleteProjectById(id: string): Promise<void> {
  if (id === project.peek().id) {
    const other = (await listProjects()).find((x) => x.id !== id);
    if (other) await openProject(other.id);
    else await newProject();
  }
  await deleteStored(id);
}
