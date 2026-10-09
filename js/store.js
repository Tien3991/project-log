// App state, persisted as one JSON document in localStorage.
//
//   projects: [{ id, name, color, archived, createdAt, order }]   (order: position in 'Custom order')
//   updates:  [{ id, projectId, date: 'YYYY-MM-DD', text, createdAt, updatedAt }]
//   settings: { weekStart, theme, sort, showArchived, lastBackupAt, backupNagUntil }

import { todayKey, addDays, isValidKey } from './dates.js';

export const STORAGE_KEY = 'project-log:v1';

export const PALETTE = [
  '#3b82f6', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f97316', '#84cc16', '#6366f1', '#06b6d4', '#a0714f',
];

const DEFAULT_SETTINGS = {
  weekStart: 1,          // 1 = Monday, 0 = Sunday
  theme: 'system',       // system | light | dark
  sort: 'recent',        // recent | name | created | manual
  showArchived: false,
  lastBackupAt: null,
  backupNagUntil: null,
};

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

let state = load();
let rev = 0;
let indexCache = null;
const listeners = new Set();
let saveErrorHandler = (e) => console.error(e);

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (raw && Array.isArray(raw.projects) && Array.isArray(raw.updates)) {
      return { version: 1, projects: raw.projects, updates: raw.updates, settings: { ...DEFAULT_SETTINGS, ...raw.settings } };
    }
  } catch (e) {
    console.error('Could not read saved data', e);
  }
  return { version: 1, projects: [], updates: [], settings: { ...DEFAULT_SETTINGS } };
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    saveErrorHandler(e);
  }
}

function commit() {
  rev++;
  persist();
  listeners.forEach((fn) => fn());
}

// Another tab (or the installed app alongside a browser tab) changed the data.
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  state = load();
  rev++;
  listeners.forEach((fn) => fn());
});

export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const onSaveError = (fn) => (saveErrorHandler = fn);
export const getState = () => state;
export const settings = () => state.settings;
export const getProject = (id) => state.projects.find((p) => p.id === id);
export const getUpdate = (id) => state.updates.find((u) => u.id === id);

/**
 * Derived lookups, rebuilt only when data changes.
 *   byDate:    Map<date, Update[]>             (updates oldest-first within a day)
 *   dates:     date[]                          (newest first)
 *   byProject: Map<projectId, { days: [{ date, items }], count, last, first }>
 */
export function index() {
  if (indexCache?.rev === rev) return indexCache;
  const sorted = [...state.updates].sort((a, b) =>
    a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : b.date.localeCompare(a.date));

  const byDate = new Map();
  const byProject = new Map(state.projects.map((p) => [p.id, { days: [], count: 0, last: null, first: null }]));
  for (const u of sorted) {
    if (!byDate.has(u.date)) byDate.set(u.date, []);
    byDate.get(u.date).push(u);

    const p = byProject.get(u.projectId);
    if (!p) continue;
    const lastDay = p.days[p.days.length - 1];
    if (lastDay?.date === u.date) lastDay.items.push(u);
    else p.days.push({ date: u.date, items: [u] });
    p.count++;
    p.last ??= u.date;
    p.first = u.date;
  }
  indexCache = { rev, byDate, dates: [...byDate.keys()], byProject };
  return indexCache;
}

/** Projects in display order for the given sort, archived ones optional. */
export function orderedProjects({ sort = state.settings.sort, includeArchived = false } = {}) {
  const { byProject } = index();
  const list = state.projects.filter((p) => includeArchived || !p.archived);
  const cmpName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  if (sort === 'name') return list.sort(cmpName);
  if (sort === 'manual') return list.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.createdAt.localeCompare(b.createdAt));
  if (sort === 'created') return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list.sort((a, b) => {
    const la = byProject.get(a.id)?.last ?? '';
    const lb = byProject.get(b.id)?.last ?? '';
    if (la !== lb) return lb.localeCompare(la);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

// ---- projects ----

export function nextColor() {
  const used = new Map(PALETTE.map((c) => [c, 0]));
  for (const p of state.projects) if (used.has(p.color)) used.set(p.color, used.get(p.color) + 1);
  return [...used.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

export function addProject({ name, color }) {
  // New projects go to the top of the custom order.
  const order = Math.min(0, ...state.projects.map((x) => x.order ?? 0)) - 1;
  const p = { id: uid(), name: name.trim(), color: color || nextColor(), archived: false, createdAt: now(), order };
  state.projects.push(p);
  commit();
  return p;
}

export function updateProject(id, patch) {
  const p = getProject(id);
  if (!p) return;
  Object.assign(p, patch, patch.name != null ? { name: patch.name.trim() } : {});
  commit();
}

/** Where the project sits on the Projects tab right now: { index, total } (index -1 if hidden). */
export function projectPosition(id) {
  const list = orderedProjects({ includeArchived: state.settings.showArchived });
  return { index: list.findIndex((p) => p.id === id), total: list.length };
}

/**
 * Moves a project 'top' | 'up' | 'down' | 'bottom' among the projects shown on the
 * Projects tab. If another sort is active, the custom order is first seeded from what
 * is on screen, so the move happens relative to what the user sees.
 * Returns { switched } — true when the sort was changed to custom order.
 */
export function moveProject(id, where) {
  const s = state.settings;
  const switched = s.sort !== 'manual';
  if (switched) {
    orderedProjects({ includeArchived: true }).forEach((p, i) => (p.order = i));
    s.sort = 'manual';
  }
  const all = orderedProjects({ sort: 'manual', includeArchived: true });
  const visible = all.filter((p) => s.showArchived || !p.archived || p.id === id);
  const i = visible.findIndex((p) => p.id === id);
  const target = { top: visible[0], up: visible[i - 1], down: visible[i + 1], bottom: visible[visible.length - 1] }[where];
  if (i >= 0 && target && target.id !== id) {
    const me = all.splice(all.findIndex((p) => p.id === id), 1)[0];
    const t = all.indexOf(target);
    all.splice(where === 'top' || where === 'up' ? t : t + 1, 0, me);
  }
  all.forEach((p, k) => (p.order = k));
  commit();
  return { switched };
}

/** Removes the project and all its updates; returns what was removed so it can be restored. */
export function deleteProject(id) {
  const project = getProject(id);
  const updates = state.updates.filter((u) => u.projectId === id);
  state.projects = state.projects.filter((p) => p.id !== id);
  state.updates = state.updates.filter((u) => u.projectId !== id);
  commit();
  return { project, updates };
}

export function restoreProject({ project, updates }) {
  if (!project || getProject(project.id)) return;
  state.projects.push(project);
  state.updates.push(...updates);
  commit();
}

// ---- updates ----

export function addUpdate({ projectId, date, text }) {
  const u = { id: uid(), projectId, date, text: text.trim(), createdAt: now(), updatedAt: now() };
  state.updates.push(u);
  commit();
  return u;
}

export function editUpdate(id, patch) {
  const u = getUpdate(id);
  if (!u) return;
  Object.assign(u, patch, { updatedAt: now() }, patch.text != null ? { text: patch.text.trim() } : {});
  commit();
}

export function deleteUpdate(id) {
  const u = getUpdate(id);
  state.updates = state.updates.filter((x) => x.id !== id);
  commit();
  return u;
}

export function restoreUpdate(u) {
  if (!u || getUpdate(u.id)) return;
  state.updates.push(u);
  commit();
}

// ---- settings ----

export function setSetting(key, value) {
  state.settings[key] = value;
  commit();
}

// ---- backup ----

export function exportJSON() {
  return JSON.stringify({
    app: 'project-log',
    version: 1,
    exportedAt: now(),
    projects: state.projects,
    updates: state.updates,
    settings: { weekStart: state.settings.weekStart },
  }, null, 2);
}

/** Validates a backup file's text; throws an Error with a readable message. */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!data || !Array.isArray(data.projects) || !Array.isArray(data.updates)) {
    throw new Error('That file is not a Project Log backup.');
  }
  const projects = data.projects
    .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
    .map((p) => ({
      id: p.id,
      name: p.name,
      color: typeof p.color === 'string' ? p.color : PALETTE[0],
      archived: !!p.archived,
      createdAt: typeof p.createdAt === 'string' ? p.createdAt : now(),
      ...(Number.isFinite(p.order) ? { order: p.order } : {}),
    }));
  const ids = new Set(projects.map((p) => p.id));
  const updates = data.updates
    .filter((u) => u && typeof u.id === 'string' && ids.has(u.projectId) && isValidKey(u.date) && typeof u.text === 'string')
    .map((u) => ({
      id: u.id,
      projectId: u.projectId,
      date: u.date,
      text: u.text,
      createdAt: typeof u.createdAt === 'string' ? u.createdAt : now(),
      updatedAt: typeof u.updatedAt === 'string' ? u.updatedAt : now(),
    }));
  return { projects, updates, weekStart: data.settings?.weekStart };
}

/** mode 'replace' swaps all data; 'merge' adds projects/updates whose ids are new. */
export function importBackup({ projects, updates }, mode) {
  if (mode === 'replace') {
    state.projects = projects;
    state.updates = updates;
  } else {
    const haveP = new Set(state.projects.map((p) => p.id));
    const haveU = new Set(state.updates.map((u) => u.id));
    state.projects.push(...projects.filter((p) => !haveP.has(p.id)));
    state.updates.push(...updates.filter((u) => !haveU.has(u.id)));
  }
  commit();
}

export function eraseAll() {
  state.projects = [];
  state.updates = [];
  commit();
}

// ---- sample data, for trying the app out ----

const SAMPLE = [
  ['Thesis – literature review', [
    'Read 3 papers on attention mechanisms', 'Summarised Vaswani et al. into notes', 'Drafted section 2.1 outline',
    'Built citation map in Zotero', 'Wrote 600 words of related work', 'Met supervisor: narrow scope to vision models',
    'Rewrote intro paragraph', 'Added 12 references', 'Compared 4 survey papers'],
  ],
  ['Home renovation', [
    'Got 2 quotes for kitchen tiles', 'Picked paint colours for bedroom', 'Fixed leaking bathroom tap',
    'Ordered new light fittings', 'Measured living room for shelves', 'Booked electrician for Saturday'],
  ],
  ['Learn Japanese', [
    'Finished Genki lesson 4', '30 min Anki review', 'Learned 15 new kanji', 'Watched NHK Easy news',
    'Practised particles は vs が', 'Conversation exchange, 45 min', 'Wrote a short diary entry'],
  ],
  ['Side app: budget tracker', [
    'Set up repo and CI', 'Designed data model for transactions', 'Implemented CSV import',
    'Fixed rounding bug in totals', 'Added monthly chart', 'Wrote onboarding screen copy', 'Shipped v0.2 to friends'],
  ],
  ['Marathon training', [
    'Easy run 8 km', 'Intervals 6×800 m', 'Long run 21 km', 'Recovery run 5 km', 'Tempo 10 km at 5:10/km',
    'Strength session: legs + core'],
  ],
];

export function loadSample() {
  const today = todayKey();
  // A few projects are busy, some sporadic, one has gone quiet — like real life.
  const rhythm = [0.45, 0.18, 0.6, 0.3, 0.4];
  const quietFor = [0, 3, 0, 20, 1];
  SAMPLE.forEach(([name, texts], i) => {
    const p = { id: uid(), name, color: PALETTE[i], archived: false, createdAt: new Date(Date.now() - 120 * 864e5).toISOString(), order: i };
    state.projects.push(p);
    let t = 0;
    for (let back = quietFor[i]; back < 110; back++) {
      if (Math.random() > rhythm[i]) continue;
      const n = Math.random() < 0.2 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const date = addDays(today, -back);
        state.updates.push({ id: uid(), projectId: p.id, date, text: texts[t++ % texts.length], createdAt: `${date}T${String(9 + k * 3).padStart(2, '0')}:00:00.000Z`, updatedAt: now() });
      }
    }
  });
  commit();
}
