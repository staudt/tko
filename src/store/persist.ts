import { isScaleId } from './scales';
// Project persistence: raw IndexedDB (no dependency). Autosaves the current project, keeps a rolling
// version history, and validates/repairs whatever it loads. Main thread only (not audio-thread code).
import { PATTERNS, SOUNDS, STEPS } from '../engine/protocol';
import { SCHEMA_VERSION, type Lane, type Pattern, type Project, type Sound, type StepData } from './types';
import { defaultProject, emptyPattern, emptySound, FACTORY_PREFIX } from './defaults';
import { deleteSample, listSamples } from './samples';

export const DB_NAME = 'tko';
export const DB_VERSION = 1;
export const PROJECTS = 'projects';
export const META = 'meta';
export const VERSIONS = 'versions';
/** Reserved for phase 4 (user samples). */
export const SAMPLES = 'samples';
export const CURRENT_KEY = 'current';
export const MAX_VERSIONS = 20;
export const VERSION_SPACING_MS = 2 * 60_000;
export const DEFAULT_DEBOUNCE_MS = 600;

type VersionRecord = { projectId: string; savedAt: number; project: Project };
type ProjectRecord = { project: Project; savedAt: number };

let dbp: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(PROJECTS)) d.createObjectStore(PROJECTS);
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
        if (!d.objectStoreNames.contains(VERSIONS)) {
          d.createObjectStore(VERSIONS, { autoIncrement: true }).createIndex('projectId', 'projectId');
        }
        if (!d.objectStoreNames.contains(SAMPLES)) d.createObjectStore(SAMPLES, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbp.catch(() => {
      dbp = null;
    });
  }
  return dbp;
}

/** Test hook: closes the connection so the next call reopens the database. */
export async function _closeDb(): Promise<void> {
  if (dbp) (await dbp.catch(() => null))?.close();
  dbp = null;
}

/** Runs one request in its own transaction; resolves with the request result once the transaction commits. */
export function run<T>(store: string, mode: IDBTransactionMode, fn: (st: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

// ---------- validation / migration ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function num(v: unknown, lo: number, hi: number, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
}
const int = (v: unknown, lo: number, hi: number, dflt: number): number => Math.round(num(v, lo, hi, dflt));

function repairStep(raw: unknown): StepData | null {
  if (!isObj(raw)) return null;
  const keys = int(raw.keys, 0, 0xffff, 0);
  if (keys === 0) return null;
  const s: { keys: number; len?: number; lockA?: number; lockB?: number } = { keys };
  if (typeof raw.len === 'number') s.len = int(raw.len, 0, 16, 0);
  if (typeof raw.lockA === 'number') s.lockA = num(raw.lockA, -24, 24, 0);
  if (typeof raw.lockB === 'number') s.lockB = num(raw.lockB, -100, 100, 0);
  return s;
}

function repairPattern(raw: unknown): Pattern {
  if (!isObj(raw)) return emptyPattern();
  const rl = Array.isArray(raw.lanes) ? raw.lanes : [];
  const lanes: Lane[] = Array.from({ length: SOUNDS }, (_, i) => {
    const l: unknown = rl[i];
    return Array.from({ length: STEPS }, (_, s) => (Array.isArray(l) ? repairStep(l[s]) : null));
  });
  const rf = Array.isArray(raw.fx) ? raw.fx : [];
  const fx = Array.from({ length: STEPS }, (_, s): number | null => {
    const v: unknown = rf[s];
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 16 ? v : null;
  });
  return { lanes, fx };
}

function repairSound(raw: unknown, i: number): Sound {
  const d = { ...emptySound(i), sampleId: `${FACTORY_PREFIX}${i}` };
  if (!isObj(raw)) return d;
  const start = num(raw.start, 0, 1, 0);
  const end = num(raw.end, 0, 1, 1);
  const s: Sound = {
    name: typeof raw.name === 'string' ? raw.name.slice(0, 64) : d.name,
    kind: raw.kind === 'melodic' || raw.kind === 'drum' ? raw.kind : d.kind,
    sampleId: typeof raw.sampleId === 'string' ? raw.sampleId : raw.sampleId === null ? null : d.sampleId,
    start: Math.min(start, end),
    end: Math.max(start, end),
    slices: Array.isArray(raw.slices) ? raw.slices.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).slice(0, 32) : d.slices,
    pitch: num(raw.pitch, -24, 24, 0),
    tone: num(raw.tone, -1, 1, 0),
    volume: num(raw.volume, 0, 1, d.volume),
    root: int(raw.root, 0, 127, d.root),
  };
  if (Array.isArray(raw.hitNames)) s.hitNames = raw.hitNames.filter((x): x is string => typeof x === 'string').slice(0, 16);
  return s;
}

/** Validates and repairs a stored project. Returns null if it is not recoverable. */
export function migrate(raw: unknown): Project | null {
  if (!isObj(raw)) return null;
  if (typeof raw.version !== 'number' || !Number.isFinite(raw.version) || raw.version < 1 || raw.version > SCHEMA_VERSION) return null;
  if (!Array.isArray(raw.sounds) && !Array.isArray(raw.patterns)) return null;
  const rs: unknown[] = Array.isArray(raw.sounds) ? raw.sounds : [];
  const rp: unknown[] = Array.isArray(raw.patterns) ? raw.patterns : [];
  const sounds = Array.from({ length: SOUNDS }, (_, i) => repairSound(rs[i], i));
  const patterns = Array.from({ length: PATTERNS }, (_, i) => repairPattern(rp[i]));
  const chain = Array.isArray(raw.chain)
    ? raw.chain.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < PATTERNS)
    : [];
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : defaultProject().id,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 64) : 'Untitled',
    version: SCHEMA_VERSION,
    bpm: num(raw.bpm, 30, 300, 120),
    swing: num(raw.swing, 50, 75, 50),
    volume: num(raw.volume, 0, 1, 0.8),
    scale: isScaleId(raw.scale) ? raw.scale : 'chromatic',
    key: Math.round(num(raw.key, 0, 11, 0)),
    sounds,
    patterns,
    chain: chain.length ? chain : [0],
  };
}

// ---------- load / versions ----------

export async function loadCurrentProject(): Promise<Project | null> {
  try {
    const id = await run<unknown>(META, 'readonly', (s) => s.get(CURRENT_KEY));
    if (typeof id !== 'string') return null;
    const rec = await run<unknown>(PROJECTS, 'readonly', (s) => s.get(id));
    return migrate(isObj(rec) ? rec.project : null);
  } catch {
    return null;
  }
}

async function saveProject(p: Project, now: number): Promise<void> {
  const d = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction([PROJECTS, META], 'readwrite');
    tx.objectStore(PROJECTS).put({ project: p, savedAt: now } satisfies ProjectRecord, p.id);
    tx.objectStore(META).put(p.id, CURRENT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Stores a version snapshot and trims the project's history to the newest MAX_VERSIONS. */
export async function snapshotVersion(p: Project, now: number = Date.now()): Promise<void> {
  const d = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(VERSIONS, 'readwrite');
    const st = tx.objectStore(VERSIONS);
    st.add({ projectId: p.id, savedAt: now, project: p } satisfies VersionRecord);
    const keysReq = st.index('projectId').getAllKeys(p.id);
    keysReq.onsuccess = () => {
      const keys = keysReq.result as number[];
      keys.sort((a, b) => a - b);
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_VERSIONS))) st.delete(k);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listVersions(projectId: string): Promise<{ id: number; savedAt: number }[]> {
  try {
    const d = await openDb();
    return await new Promise((resolve, reject) => {
      const out: { id: number; savedAt: number }[] = [];
      const tx = d.transaction(VERSIONS, 'readonly');
      const cur = tx.objectStore(VERSIONS).index('projectId').openCursor(IDBKeyRange.only(projectId));
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        out.push({ id: c.primaryKey as number, savedAt: (c.value as VersionRecord).savedAt });
        c.continue();
      };
      tx.oncomplete = () => resolve(out.sort((a, b) => b.savedAt - a.savedAt || b.id - a.id));
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return [];
  }
}

export async function loadVersion(id: number): Promise<Project | null> {
  try {
    const rec = await run<unknown>(VERSIONS, 'readonly', (s) => s.get(id));
    return migrate(isObj(rec) ? rec.project : null);
  } catch {
    return null;
  }
}

// ---------- multiple projects ----------

export type ProjectInfo = { id: string; name: string; savedAt: number; bpm: number; patternsUsed: boolean[] };

export const patternUsed = (p: Pattern): boolean => p.lanes.some((l) => l.some((s) => s !== null)) || p.fx.some((f) => f !== null);

async function allRecords(): Promise<{ id: string; savedAt: number; project: Project }[]> {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const out: { id: string; savedAt: number; project: Project }[] = [];
    const tx = d.transaction(PROJECTS, 'readonly');
    const cur = tx.objectStore(PROJECTS).openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return;
      const rec: unknown = c.value;
      const p = isObj(rec) ? migrate(rec.project) : null;
      if (p) out.push({ id: String(c.key), savedAt: isObj(rec) && typeof rec.savedAt === 'number' ? rec.savedAt : 0, project: { ...p, id: String(c.key) } });
      c.continue();
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

/** Saved projects, most recently saved first. */
export async function listProjects(): Promise<ProjectInfo[]> {
  try {
    return (await allRecords())
      .sort((a, b) => b.savedAt - a.savedAt)
      .map((r) => ({ id: r.id, name: r.project.name, savedAt: r.savedAt, bpm: r.project.bpm, patternsUsed: r.project.patterns.map(patternUsed) }));
  } catch {
    return [];
  }
}

export async function loadProject(id: string): Promise<Project | null> {
  try {
    const rec = await run<unknown>(PROJECTS, 'readonly', (s) => s.get(id));
    const p = migrate(isObj(rec) ? rec.project : null);
    return p ? { ...p, id } : null;
  } catch {
    return null;
  }
}

export async function setCurrentProject(id: string): Promise<void> {
  await run(META, 'readwrite', (s) => s.put(id, CURRENT_KEY));
}

/** Immediate write of `p` (and marks it current), independent of the debounced autosave. */
export async function saveProjectNow(p: Project): Promise<void> {
  await saveProject(p, Date.now());
}

/** User sample ids ('u…') used by the projects, optionally leaving one project out. */
export async function userSamplesUsed(exceptId?: string): Promise<Set<string>> {
  const used = new Set<string>();
  for (const r of await allRecords()) {
    if (r.id === exceptId) continue;
    for (const s of r.project.sounds) if (s.sampleId?.startsWith('u')) used.add(s.sampleId);
  }
  return used;
}

/** Deletes every user sample no project (other than `exceptId`) uses. */
export async function deleteUnusedSamples(exceptId?: string): Promise<void> {
  const used = await userSamplesUsed(exceptId);
  for (const m of await listSamples()) if (!used.has(m.id)) await deleteSample(m.id);
}

/** Deletes a project and its versions, then the user samples only it used. */
export async function deleteProject(id: string): Promise<void> {
  const rec = await run<unknown>(PROJECTS, 'readonly', (s) => s.get(id));
  const mine = new Set<string>();
  const gone = migrate(isObj(rec) ? rec.project : null);
  for (const s of gone?.sounds ?? []) if (s.sampleId?.startsWith('u')) mine.add(s.sampleId);
  const d = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction([PROJECTS, VERSIONS, META], 'readwrite');
    tx.objectStore(PROJECTS).delete(id);
    const vs = tx.objectStore(VERSIONS);
    const keys = vs.index('projectId').getAllKeys(id);
    keys.onsuccess = () => keys.result.forEach((k) => vs.delete(k));
    const meta = tx.objectStore(META);
    const cur = meta.get(CURRENT_KEY);
    cur.onsuccess = () => {
      if (cur.result === id) meta.delete(CURRENT_KEY);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  const used = await userSamplesUsed();
  for (const sid of mine) if (!used.has(sid)) await deleteSample(sid);
}

/** Saves a copy of a project under a new id and name; returns the new id (null if the source is missing). */
export async function duplicateProject(id: string, newName: string): Promise<string | null> {
  const p = await loadProject(id);
  if (!p) return null;
  const copy: Project = { ...p, id: defaultProject().id, name: newName.slice(0, 64) };
  const d = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(PROJECTS, 'readwrite');
    tx.objectStore(PROJECTS).put({ project: copy, savedAt: Date.now() } satisfies ProjectRecord, copy.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return copy.id;
}

// ---------- autosave ----------

export function startPersistence(
  get: () => Project,
  subscribe: (cb: () => void) => () => void,
  opts: { debounceMs?: number; versionMs?: number } = {},
): () => void {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const versionMs = opts.versionMs ?? VERSION_SPACING_MS;
  let warned = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saved: Project | null = null;
  let lastVersionAt = 0;
  let chainP: Promise<void> = Promise.resolve();
  const warn = (e: unknown): void => {
    if (warned) return;
    warned = true;
    console.warn('[tko] persistence failed', e);
  };

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    let p: Project;
    try {
      p = get();
    } catch (e) {
      warn(e);
      return;
    }
    if (p === saved) return;
    saved = p;
    const now = Date.now();
    const wantVersion = now - lastVersionAt >= versionMs;
    if (wantVersion) lastVersionAt = now;
    chainP = chainP
      .then(() => saveProject(p, now))
      .then(() => (wantVersion ? snapshotVersion(p, now) : undefined))
      .catch(warn);
  };

  const onChange = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };
  const onVis = (): void => {
    if (document.visibilityState === 'hidden') flush();
  };

  saved = (() => {
    try {
      return get();
    } catch {
      return null;
    }
  })();
  const unsub = subscribe(onChange);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);
  try {
    if (typeof navigator !== 'undefined') void navigator.storage?.persist?.()?.catch?.(() => undefined);
  } catch {
    /* best effort */
  }

  return () => {
    unsub();
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', flush);
  };
}
