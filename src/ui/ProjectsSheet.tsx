import { useEffect, useRef, useState } from 'preact/hooks';
import { project, apply } from '../store/project';
import { listProjects, patternUsed, type ProjectInfo } from '../store/persist';
import { Sheet } from './Sheet';
import { projectsOpen } from './state';
import { deleteProjectById, duplicateProjectById, newProject, openProject } from './projects';

export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function Dots(p: { used: readonly boolean[] }) {
  return (
    <span class="pdots" aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => (
        <i key={i} class={p.used[i] ? 'on' : ''} />
      ))}
    </span>
  );
}

function DeleteButton(p: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <button
      class={`mini pdel${armed ? ' armed' : ''}`}
      data-testid="proj-delete"
      onClick={() => {
        if (!armed) {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 3500);
          return;
        }
        if (timer.current) clearTimeout(timer.current);
        p.onConfirm();
      }}
    >
      {armed ? 'Tap again' : 'Delete'}
    </button>
  );
}

export function ProjectsSheet() {
  const open = projectsOpen.value;
  const cur = project.value;
  const [rows, setRows] = useState<ProjectInfo[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => void listProjects().then(setRows);
  useEffect(() => {
    if (open) refresh();
    else {
      setMenu(null);
      setEditing(false);
    }
  }, [open]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const act = (f: () => Promise<unknown>) => void f().then(refresh);
  const commitName = (v: string) => {
    setEditing(false);
    const name = v.trim().slice(0, 64);
    if (name && name !== project.peek().name) apply((p) => ({ ...p, name }), { undoable: false });
    setTimeout(refresh, 800);
  };
  const live: ProjectInfo = { id: cur.id, name: cur.name, savedAt: Date.now(), bpm: cur.bpm, patternsUsed: cur.patterns.map(patternUsed) };
  const list = rows.some((r) => r.id === cur.id) ? rows.map((r) => (r.id === cur.id ? { ...live, savedAt: r.savedAt } : r)) : [live, ...rows];

  return (
    <Sheet
      open={open}
      onClose={() => (projectsOpen.value = false)}
      label="Projects"
      title={
        <span class="phead">
          {editing ? (
            <input
              ref={input}
              class="pname"
              data-testid="proj-name-input"
              defaultValue={cur.name}
              maxLength={64}
              aria-label="Project name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName(e.currentTarget.value);
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={(e) => commitName(e.currentTarget.value)}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : (
            <button class="pname" data-testid="proj-name" onPointerDown={(e) => e.stopPropagation()} onClick={() => setEditing(true)}>
              {cur.name}
            </button>
          )}
          <button class="mini" data-testid="proj-new" onPointerDown={(e) => e.stopPropagation()} onClick={() => act(async () => { await newProject(); projectsOpen.value = false; })}>
            New
          </button>
        </span>
      }
    >
      <div class="plist" data-testid="proj-list">
        {list.map((r) => {
          const isCur = r.id === cur.id;
          return (
            <div key={r.id} class={`prow${isCur ? ' cur' : ''}`} data-testid="proj-row" data-id={r.id}>
              <button class="pmain" data-testid="proj-open" aria-current={isCur ? 'true' : undefined} onClick={() => act(async () => { await openProject(r.id); projectsOpen.value = false; })}>
                <span class="pn">{r.name}</span>
                <span class="pm">
                  {isCur ? 'open now' : ago(r.savedAt)} · {Math.round(r.bpm)} BPM
                </span>
                <Dots used={r.patternsUsed} />
              </button>
              <button class="mini sq" aria-label={`Actions for ${r.name}`} data-testid="proj-menu" onClick={() => setMenu(menu === r.id ? null : r.id)}>
                ⋯
              </button>
              {menu === r.id && (
                <div class="pacts">
                  <button
                    class="mini"
                    data-testid="proj-rename"
                    onClick={() =>
                      act(async () => {
                        setMenu(null);
                        await openProject(r.id);
                        setEditing(true);
                      })
                    }
                  >
                    Rename
                  </button>
                  <button class="mini" data-testid="proj-dup" onClick={() => act(async () => { setMenu(null); await duplicateProjectById(r.id); projectsOpen.value = false; })}>
                    Duplicate
                  </button>
                  <DeleteButton onConfirm={() => act(async () => { setMenu(null); await deleteProjectById(r.id); })} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
