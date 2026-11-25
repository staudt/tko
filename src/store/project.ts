// Project store: one signal holding the immutable project, plus snapshot undo/redo.
import { signal } from '@preact/signals';
import { defaultProject } from './defaults';
import type { Project, Sound } from './types';

export const project = signal<Project>(defaultProject());

const UNDO_MAX = 100;
const undoStack: Project[] = [];
const redoStack: Project[] = [];
let mergeKey: string | null = null;
export const canUndo = signal(false);
export const canRedo = signal(false);

/**
 * Applies an edit. Edits with the same `merge` key in a row (one knob drag) form a single undo step;
 * pass merge: null to always start a new step.
 */
export function apply(edit: (p: Project) => Project, opts: { merge?: string | null; undoable?: boolean } = {}): void {
  const prev = project.peek();
  const next = edit(prev);
  if (next === prev) return;
  const merge = opts.merge ?? null;
  if (opts.undoable !== false && (merge === null || merge !== mergeKey)) {
    undoStack.push(prev);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;
  }
  mergeKey = merge;
  project.value = next;
  canUndo.value = undoStack.length > 0;
  canRedo.value = false;
}

export function undo(): void {
  const p = undoStack.pop();
  if (!p) return;
  redoStack.push(project.peek());
  mergeKey = null;
  project.value = p;
  canUndo.value = undoStack.length > 0;
  canRedo.value = true;
}

export function redo(): void {
  const p = redoStack.pop();
  if (!p) return;
  undoStack.push(project.peek());
  mergeKey = null;
  project.value = p;
  canUndo.value = true;
  canRedo.value = redoStack.length > 0;
}

/** Replace the whole project (load); clears history. */
export function replaceProject(p: Project): void {
  undoStack.length = 0;
  redoStack.length = 0;
  mergeKey = null;
  project.value = p;
  canUndo.value = false;
  canRedo.value = false;
}

export function updateSound(p: Project, index: number, patch: Partial<Sound>): Project {
  const s = p.sounds[index];
  if (!s) return p;
  const sounds = p.sounds.slice();
  sounds[index] = { ...s, ...patch };
  return { ...p, sounds };
}
