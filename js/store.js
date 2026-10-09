// App state.
//
// Synced document: the same shape is stored locally and in the sync repository.
//   { format: 2,
//     profiles:        [{ id, name, color, sort, createdAt, updatedAt }],
//     deletedProfiles: { [profileId]: deletedAt },
//     data: { [profileId]: { projects: [...], updates: [...], deleted: { [id]: deletedAt } } } }
//   project: { id, name, color, archived, order, createdAt, updatedAt }   (order: position in 'Custom order')
//   update:  { id, projectId, date: 'YYYY-MM-DD', text, createdAt, updatedAt }
//
// Device state is never synced: active profile, theme, week start, sync credentials, …
//
// Two copies merge record by record. The newest updatedAt wins, and deletions are kept
// as tombstones, so edits made offline on several devices combine instead of overwriting.

import { todayKey, addDays, isValidKey } from './dates.js';

export const DOC_KEY = 'project-log:v2';
export const DEVICE_KEY = 'project-log:device';
const LEGACY_KEY = 'project-log:v1';

// The first profile on every device gets this fixed id with an ancient timestamp, so
// fresh devices merge into the existing default profile instead of adding a duplicate.
const DEFAULT_PROFILE_ID = 'default';
const EPOCH = '1970-01-01T00:00:00.000Z';
const TOMBSTONE_TTL = 400 * 864e5;
const SORTS = ['recent', 'name', 'created', 'manual'];

export const PALETTE = [
  '#3b82f6', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f97316', '#84cc16', '#6366f1', '#06b6d4', '#a0714f',
];

const DEVICE_DEFAULTS = {
  activeProfile: null,
  weekStart: 1,            // 1 = Monday, 0 = Sunday
  theme: 'system',         // system | light | dark
  showArchived: {},        // per profile
  lastBackupAt: null,
  backupNagUntil: null,
  sync: null,              // { repo, token, path, lastSyncAt, lastError, dirty }
};

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const stamp = (r) => r.updatedAt || r.createdAt || '';
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const str = (v, fallback) => (typeof v === 'string' ? v : fallback);

let doc;
let device;
let rev = 0;          // bumps on every change; invalidates index()
let edits = 0;        // bumps on local edits only; lets sync know if it is up to date
let indexCache = null;
const listeners = new Set();
let saveErrorHandler = (e) => console.error(e);

// ------------------------------------------------------------------ shapes

const emptyData = () => ({ projects: [], updates: [], deleted: {} });

const shapeProfile = (p) => ({
  id: p.id, name: p.name, color: str(p.color, PALETTE[0]), sort: SORTS.includes(p.sort) ? p.sort : 'recent',
  createdAt: str(p.createdAt, EPOCH), updatedAt: str(p.updatedAt, str(p.createdAt, EPOCH)),
});
const shapeProject = (p) => ({
  id: p.id, name: p.name, color: str(p.color, PALETTE[0]), archived: !!p.archived,
  order: Number.isFinite(p.order) ? p.order : null,
  createdAt: str(p.createdAt, EPOCH), updatedAt: str(p.updatedAt, str(p.createdAt, EPOCH)),
});
const shapeUpdate = (u) => ({
  id: u.id, projectId: u.projectId, date: u.date, text: u.text,
  createdAt: str(u.createdAt, EPOCH), updatedAt: str(u.updatedAt, str(u.createdAt, EPOCH)),
});

const cleanProjects = (list) => (Array.isArray(list) ? list : [])
  .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
  .map(shapeProject);
const cleanUpdates = (list, projectIds) => (Array.isArray(list) ? list : [])
  .filter((u) => u && typeof u.id === 'string' && projectIds.has(u.projectId) && isValidKey(u.date) && typeof u.text === 'string')
  .map(shapeUpdate);
const cleanTombs = (o) => Object.fromEntries(Object.entries(isObj(o) ? o : {}).filter(([, v]) => typeof v === 'string'));

/** Validates any document-shaped object (local, remote or a backup file). */
function normalizeDoc(raw) {
  const d = { format: 2, profiles: [], deletedProfiles: cleanTombs(raw?.deletedProfiles), data: {} };
  for (const p of Array.isArray(raw?.profiles) ? raw.profiles : []) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || d.data[p.id]) continue;
    d.profiles.push(shapeProfile(p));
    const data = raw.data?.[p.id];
    const projects = cleanProjects(data?.projects);
    d.data[p.id] = { projects, updates: cleanUpdates(data?.updates, new Set(projects.map((x) => x.id))), deleted: cleanTombs(data?.deleted) };
  }
  return d;
}

/** Stable ordering and field order, so equal content always serializes identically. */
function canonical(d) {
  const byCreated = (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const profiles = d.profiles.map(shapeProfile).sort(byCreated);
  return {
    format: 2,
    profiles,
    deletedProfiles: sortKeys(d.deletedProfiles),
    data: Object.fromEntries(profiles.map((p) => {
      const x = d.data[p.id] ?? emptyData();
      return [p.id, {
        projects: x.projects.map(shapeProject).sort(byCreated),
        updates: x.updates.map(shapeUpdate).sort((a, b) => a.date.localeCompare(b.date) || byCreated(a, b)),
        deleted: sortKeys(x.deleted),
      }];
    })),
  };
}
const canonicalJSON = (d) => JSON.stringify(canonical(d));

// ------------------------------------------------------------------ merge

function pickNewest(xs, ys, tombs) {
  const m = new Map();
  for (const r of [...xs, ...ys]) {
    const c = m.get(r.id);
    if (!c || stamp(r) > stamp(c) || (stamp(r) === stamp(c) && JSON.stringify(r) > JSON.stringify(c))) m.set(r.id, r);
  }
  return [...m.values()].filter((r) => !(tombs[r.id] && tombs[r.id] >= stamp(r)));
}

/** Combines two documents. Pure, symmetric, and idempotent. */
export function mergeDocs(a, b) {
  a = canonical(a);
  if (!b) return a;
  b = canonical(b);
  const cutoff = new Date(Date.now() - TOMBSTONE_TTL).toISOString();
  const tombs = (x, y) => {
    const t = { ...x };
    for (const [k, v] of Object.entries(y)) if (!t[k] || v > t[k]) t[k] = v;
    return Object.fromEntries(Object.entries(t).filter(([, v]) => v >= cutoff));
  };
  const deletedProfiles = tombs(a.deletedProfiles, b.deletedProfiles);
  const profiles = pickNewest(a.profiles, b.profiles, deletedProfiles);
  const data = {};
  for (const p of profiles) {
    const x = a.data[p.id] ?? emptyData();
    const y = b.data[p.id] ?? emptyData();
    const deleted = tombs(x.deleted, y.deleted);
    const projects = pickNewest(x.projects, y.projects, deleted);
    const ids = new Set(projects.map((q) => q.id));
    // Updates whose project was deleted on another device go with it.
    data[p.id] = { projects, updates: pickNewest(x.updates, y.updates, deleted).filter((u) => ids.has(u.projectId)), deleted };
  }
  return canonical({ profiles, deletedProfiles, data });
}

// ------------------------------------------------------------------ load & persist

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function load() {
  device = { ...DEVICE_DEFAULTS, ...read(DEVICE_KEY) };
  const raw = read(DOC_KEY);
  doc = normalizeDoc(raw);
  if (!raw) {
    const legacy = read(LEGACY_KEY);
    if (legacy && Array.isArray(legacy.projects)) migrateV1(legacy);
  }
  ensureProfile();
}

/** Version 1 kept a single project list; it becomes the default profile. */
function migrateV1(legacy) {
  const p = shapeProfile({ id: DEFAULT_PROFILE_ID, name: 'My projects', sort: legacy.settings?.sort, createdAt: EPOCH, updatedAt: '1970-01-01T00:00:00.001Z' });
  const projects = cleanProjects(legacy.projects);
  doc.profiles.push(p);
  doc.data[p.id] = { projects, updates: cleanUpdates(legacy.updates, new Set(projects.map((x) => x.id))), deleted: {} };
  const s = legacy.settings ?? {};
  for (const k of ['weekStart', 'theme', 'lastBackupAt', 'backupNagUntil']) if (s[k] != null) device[k] = s[k];
  device.activeProfile = p.id;
  device.showArchived = { [p.id]: !!s.showArchived };
  persistDoc();
  persistDevice();
  try {
    localStorage.setItem(`${LEGACY_KEY}:backup`, JSON.stringify(legacy));
    localStorage.removeItem(LEGACY_KEY);
  } catch {}
}

function ensureProfile() {
  if (!doc.profiles.length) {
    const fresh = !doc.deletedProfiles[DEFAULT_PROFILE_ID];
    doc.profiles.push(shapeProfile({ id: fresh ? DEFAULT_PROFILE_ID : uid(), name: 'My projects', createdAt: fresh ? EPOCH : now() }));
  }
  for (const p of doc.profiles) doc.data[p.id] ??= emptyData();
  if (!doc.profiles.some((p) => p.id === device.activeProfile)) device.activeProfile = profiles()[0].id;
}

function persistDoc() {
  try {
    localStorage.setItem(DOC_KEY, JSON.stringify(doc));
  } catch (e) {
    saveErrorHandler(e);
  }
}

function persistDevice() {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  } catch (e) {
    saveErrorHandler(e);
  }
}

const emit = (reason) => listeners.forEach((fn) => fn(reason));

/** A change to synced data made on this device. */
function commitEdit() {
  rev++;
  edits++;
  if (device.sync) device.sync.dirty = true;
  persistDoc();
  persistDevice();
  emit('edit');
}

/** A change to this device's own settings. */
function commitDevice(reason = 'device') {
  rev++;
  persistDevice();
  emit(reason);
}

// ------------------------------------------------------------------ access

/** reason: 'edit' | 'device' | 'profile' | 'remote' | 'sync' | 'external' */
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const onSaveError = (fn) => (saveErrorHandler = fn);

const cur = () => doc.data[device.activeProfile];
/** The active profile's { projects, updates, deleted }. */
export const getState = () => cur();
export const getProject = (id) => cur().projects.find((p) => p.id === id);
export const getUpdate = (id) => cur().updates.find((u) => u.id === id);

export function settings() {
  const p = activeProfile();
  return {
    weekStart: device.weekStart,
    theme: device.theme,
    lastBackupAt: device.lastBackupAt,
    backupNagUntil: device.backupNagUntil,
    sort: p.sort,
    showArchived: !!device.showArchived[p.id],
  };
}

export function setSetting(key, value) {
  if (key === 'sort') {
    Object.assign(activeProfile(), { sort: value, updatedAt: now() });
    return commitEdit();
  }
  if (key === 'showArchived') device.showArchived = { ...device.showArchived, [device.activeProfile]: value };
  else device[key] = value;
  commitDevice();
}

/**
 * Derived lookups for the active profile, rebuilt only when data changes.
 *   byDate:    Map<date, Update[]>             (updates oldest-first within a day)
 *   dates:     date[]                          (newest first)
 *   byProject: Map<projectId, { days: [{ date, items }], count, last, first }>
 */
export function index() {
  if (indexCache?.rev === rev) return indexCache;
  const { projects, updates } = cur();
  const sorted = [...updates].sort((a, b) =>
    a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : b.date.localeCompare(a.date));

  const byDate = new Map();
  const byProject = new Map(projects.map((p) => [p.id, { days: [], count: 0, last: null, first: null }]));
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
export function orderedProjects({ sort = activeProfile().sort, includeArchived = false } = {}) {
  const { byProject } = index();
  const list = cur().projects.filter((p) => includeArchived || !p.archived);
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

// ------------------------------------------------------------------ profiles

export const profiles = () =>
  [...doc.profiles].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
export const getProfile = (id) => doc.profiles.find((p) => p.id === id);
export const activeProfile = () => getProfile(device.activeProfile);

export function profileStats(id) {
  const d = doc.data[id] ?? emptyData();
  return { projects: d.projects.length, updates: d.updates.length };
}

export function switchProfile(id) {
  if (!getProfile(id) || id === device.activeProfile) return;
  device.activeProfile = id;
  commitDevice('profile');
}

function leastUsed(colors) {
  const used = new Map(PALETTE.map((c) => [c, 0]));
  for (const c of colors) if (used.has(c)) used.set(c, used.get(c) + 1);
  return [...used.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

export const nextProfileColor = () => leastUsed(doc.profiles.map((p) => p.color));

export function addProfile({ name, color }) {
  const t = now();
  const p = shapeProfile({ id: uid(), name: name.trim(), color: color || nextProfileColor(), createdAt: t, updatedAt: t });
  doc.profiles.push(p);
  doc.data[p.id] = emptyData();
  commitEdit();
  return p;
}

export function updateProfile(id, patch) {
  const p = getProfile(id);
  if (!p) return;
  Object.assign(p, patch, { updatedAt: now() }, patch.name != null ? { name: patch.name.trim() } : {});
  commitEdit();
}

/** Deletes a profile and everything in it; returns what was removed so it can be restored. */
export function deleteProfile(id) {
  if (doc.profiles.length < 2) return null;
  const removed = { profile: getProfile(id), data: doc.data[id] };
  doc.profiles = doc.profiles.filter((p) => p.id !== id);
  delete doc.data[id];
  doc.deletedProfiles[id] = now();
  if (device.activeProfile === id) device.activeProfile = profiles()[0].id;
  commitEdit();
  return removed;
}

export function restoreProfile({ profile, data }) {
  if (!profile || getProfile(profile.id)) return;
  doc.profiles.push({ ...profile, updatedAt: now() });
  doc.data[profile.id] = data;
  delete doc.deletedProfiles[profile.id];
  commitEdit();
}

// ------------------------------------------------------------------ projects

export const nextColor = () => leastUsed(cur().projects.map((p) => p.color));

export function addProject({ name, color }) {
  const t = now();
  // New projects go to the top of the custom order.
  const order = Math.min(0, ...cur().projects.map((x) => x.order ?? 0)) - 1;
  const p = shapeProject({ id: uid(), name: name.trim(), color: color || nextColor(), archived: false, order, createdAt: t, updatedAt: t });
  cur().projects.push(p);
  commitEdit();
  return p;
}

export function updateProject(id, patch) {
  const p = getProject(id);
  if (!p) return;
  Object.assign(p, patch, { updatedAt: now() }, patch.name != null ? { name: patch.name.trim() } : {});
  commitEdit();
}

/** Where the project sits on the Projects tab right now: { index, total } (index -1 if hidden). */
export function projectPosition(id) {
  const list = orderedProjects({ includeArchived: settings().showArchived });
  return { index: list.findIndex((p) => p.id === id), total: list.length };
}

/**
 * Moves a project 'top' | 'up' | 'down' | 'bottom' among the projects shown on the
 * Projects tab. If another sort is active, the custom order is first seeded from what
 * is on screen, so the move happens relative to what the user sees.
 * Returns { switched }: true when the sort was changed to custom order.
 */
export function moveProject(id, where) {
  const profile = activeProfile();
  const t = now();
  const switched = profile.sort !== 'manual';
  const all = orderedProjects({ includeArchived: true });
  if (switched) Object.assign(profile, { sort: 'manual', updatedAt: t });
  const visible = all.filter((p) => settings().showArchived || !p.archived || p.id === id);
  const i = visible.findIndex((p) => p.id === id);
  const target = { top: visible[0], up: visible[i - 1], down: visible[i + 1], bottom: visible[visible.length - 1] }[where];
  if (i >= 0 && target && target.id !== id) {
    const me = all.splice(all.findIndex((p) => p.id === id), 1)[0];
    const at = all.indexOf(target);
    all.splice(where === 'top' || where === 'up' ? at : at + 1, 0, me);
  }
  all.forEach((p, k) => {
    if (p.order !== k) Object.assign(p, { order: k, updatedAt: t });
  });
  commitEdit();
  return { switched };
}

/** Removes the project and all its updates; returns what was removed so it can be restored. */
export function deleteProject(id) {
  const d = cur();
  const t = now();
  const project = getProject(id);
  const updates = d.updates.filter((u) => u.projectId === id);
  d.deleted[id] = t;
  for (const u of updates) d.deleted[u.id] = t;
  d.projects = d.projects.filter((p) => p.id !== id);
  d.updates = d.updates.filter((u) => u.projectId !== id);
  commitEdit();
  return { project, updates };
}

export function restoreProject({ project, updates }) {
  if (!project || getProject(project.id)) return;
  const d = cur();
  const t = now();
  d.projects.push({ ...project, updatedAt: t });
  d.updates.push(...updates.map((u) => ({ ...u, updatedAt: t })));
  for (const x of [project, ...updates]) delete d.deleted[x.id];
  commitEdit();
}

// ------------------------------------------------------------------ updates

export function addUpdate({ projectId, date, text }) {
  const t = now();
  const u = { id: uid(), projectId, date, text: text.trim(), createdAt: t, updatedAt: t };
  cur().updates.push(u);
  commitEdit();
  return u;
}

export function editUpdate(id, patch) {
  const u = getUpdate(id);
  if (!u) return;
  Object.assign(u, patch, { updatedAt: now() }, patch.text != null ? { text: patch.text.trim() } : {});
  commitEdit();
}

export function deleteUpdate(id) {
  const d = cur();
  const u = getUpdate(id);
  d.updates = d.updates.filter((x) => x.id !== id);
  d.deleted[id] = now();
  commitEdit();
  return u;
}

export function restoreUpdate(u) {
  if (!u || getUpdate(u.id)) return;
  cur().updates.push({ ...u, updatedAt: now() });
  delete cur().deleted[u.id];
  commitEdit();
}

// ------------------------------------------------------------------ backup

export function exportJSON() {
  return JSON.stringify({ app: 'project-log', exportedAt: now(), ...canonical(doc) }, null, 2);
}

/**
 * Validates a backup file's text; throws an Error with a readable message.
 * Returns { kind: 'all', doc } for full backups, or { kind: 'single', projects, updates }
 * for version-1 backups (one project list).
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (Array.isArray(data?.profiles) && isObj(data.data)) {
    const d = normalizeDoc(data);
    const sum = (k) => d.profiles.reduce((n, p) => n + d.data[p.id][k].length, 0);
    return { kind: 'all', doc: d, profiles: d.profiles.length, projects: sum('projects'), updates: sum('updates') };
  }
  if (Array.isArray(data?.projects) && Array.isArray(data?.updates)) {
    const projects = cleanProjects(data.projects);
    const updates = cleanUpdates(data.updates, new Set(projects.map((p) => p.id)));
    return { kind: 'single', projects, updates };
  }
  throw new Error('That file is not a Project Log backup.');
}

const restamp = (list, t) => list.map((r) => ({ ...r, updatedAt: t }));

/** merge: add what's missing here. replace: make the profile's data exactly the backup's. */
function importInto(d, { projects, updates }, mode, t) {
  if (mode === 'replace') {
    const keep = new Set([...projects, ...updates].map((r) => r.id));
    for (const r of [...d.projects, ...d.updates]) if (!keep.has(r.id)) d.deleted[r.id] = t;
    d.projects = restamp(projects, t);
    d.updates = restamp(updates, t);
  } else {
    const have = new Set([...d.projects, ...d.updates].map((r) => r.id));
    d.projects.push(...restamp(projects.filter((p) => !have.has(p.id)), t));
    d.updates.push(...restamp(updates.filter((u) => !have.has(u.id)), t));
  }
  for (const r of [...projects, ...updates]) delete d.deleted[r.id];
}

export function importBackup(backup, mode) {
  const t = now();
  if (backup.kind === 'single') {
    importInto(cur(), backup, mode, t);
  } else {
    const incoming = backup.doc;
    if (mode === 'replace') {
      const keep = new Set(incoming.profiles.map((p) => p.id));
      for (const p of doc.profiles) {
        if (keep.has(p.id)) continue;
        doc.deletedProfiles[p.id] = t;
        delete doc.data[p.id];
      }
      doc.profiles = doc.profiles.filter((p) => keep.has(p.id));
    }
    for (const p of incoming.profiles) {
      const existing = getProfile(p.id);
      if (!existing) doc.profiles.push({ ...p, updatedAt: t });
      else if (mode === 'replace') Object.assign(existing, p, { updatedAt: t });
      doc.data[p.id] ??= emptyData();
      importInto(doc.data[p.id], incoming.data[p.id], mode, t);
      delete doc.deletedProfiles[p.id];
    }
    ensureProfile();
  }
  commitEdit();
}

/** Deletes every project and update in the active profile; returns them for undo. */
export function eraseProfileData() {
  const d = cur();
  const t = now();
  const snapshot = { projects: d.projects, updates: d.updates };
  for (const r of [...d.projects, ...d.updates]) d.deleted[r.id] = t;
  d.projects = [];
  d.updates = [];
  commitEdit();
  return snapshot;
}

export function restoreProfileData(snapshot) {
  importInto(cur(), snapshot, 'merge', now());
  commitEdit();
}

// ------------------------------------------------------------------ sync support (see sync.js)

export const syncConfig = () => device.sync;
export const editCount = () => edits;

export function setSyncConfig(cfg) {
  device.sync = cfg ? { path: 'project-log.json', lastSyncAt: null, lastError: null, dirty: true, ...cfg } : null;
  commitDevice('sync');
}

export function updateSyncState(patch) {
  if (!device.sync) return;
  Object.assign(device.sync, patch);
  commitDevice('sync');
}

/** Merges a remote copy into local data and returns the merged document to upload. */
export function absorb(remote) {
  const merged = mergeDocs(doc, remote ? normalizeDoc(remote) : null);
  if (canonicalJSON(merged) !== canonicalJSON(doc)) {
    doc = merged;
    ensureProfile();
    rev++;
    persistDoc();
    persistDevice();
    emit('remote');
  }
  return canonical(doc);
}

export const sameContent = (a, remote) => canonicalJSON(a) === canonicalJSON(normalizeDoc(remote));

/** Records a successful sync; pending stays set if edits happened while it ran. */
export function markSynced(editsAtMerge) {
  if (!device.sync) return;
  device.sync.lastSyncAt = now();
  device.sync.lastError = null;
  if (edits === editsAtMerge) device.sync.dirty = false;
  commitDevice('sync');
}

// ------------------------------------------------------------------ sample data, for trying the app out

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
  const t = now();
  const d = cur();
  // A few projects are busy, some sporadic, one has gone quiet — like real life.
  const rhythm = [0.45, 0.18, 0.6, 0.3, 0.4];
  const quietFor = [0, 3, 0, 20, 1];
  SAMPLE.forEach(([name, texts], i) => {
    const p = shapeProject({ id: uid(), name, color: PALETTE[i], order: i, createdAt: new Date(Date.now() - 120 * 864e5).toISOString(), updatedAt: t });
    d.projects.push(p);
    let k = 0;
    for (let back = quietFor[i]; back < 110; back++) {
      if (Math.random() > rhythm[i]) continue;
      const n = Math.random() < 0.2 ? 2 : 1;
      for (let j = 0; j < n; j++) {
        const date = addDays(today, -back);
        d.updates.push({ id: uid(), projectId: p.id, date, text: texts[k++ % texts.length], createdAt: `${date}T${String(9 + j * 3).padStart(2, '0')}:00:00.000Z`, updatedAt: t });
      }
    }
  });
  commitEdit();
}

// ------------------------------------------------------------------ start-up

load();

// Another tab (or the installed app next to a browser tab) changed the data.
window.addEventListener('storage', (e) => {
  if (e.key !== DOC_KEY && e.key !== DEVICE_KEY) return;
  load();
  rev++;
  emit('external');
});
