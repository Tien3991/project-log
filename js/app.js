import * as store from './store.js';
import { todayKey } from './dates.js';
import { toast, refreshSheets } from './ui.js';
import * as sheets from './sheets.js';
import * as timeline from './views/timeline.js';
import * as daily from './views/daily.js';
import * as calendar from './views/calendar.js';

const views = { projects: timeline, daily, calendar };
const root = document.getElementById('view');
let current = 'projects';
let renderedDay = todayKey();

// ------------------------------------------------------------------ rendering

function render({ resetScroll = false } = {}) {
  const view = views[current];
  root.innerHTML = view.render();
  view.mount?.(root, () => render());
  renderedDay = todayKey();
  document.getElementById('view-title').textContent = view.title;
  document.querySelectorAll('.tabbar a').forEach((a) => {
    const on = a.dataset.tab === current;
    a.classList.toggle('is-on', on);
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
  if (resetScroll) window.scrollTo(0, 0);
}

function route() {
  const name = location.hash.replace(/^#\/?/, '');
  current = views[name] ? name : 'projects';
  render({ resetScroll: true });
}

// Switching tabs replaces the history entry, so the back button leaves the app
// (or closes a sheet) instead of cycling through tabs.
document.querySelector('.tabbar').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-tab]');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.tab === current) return window.scrollTo({ top: 0, behavior: 'smooth' });
  history.replaceState(history.state, '', a.getAttribute('href'));
  route();
});
window.addEventListener('hashchange', route);

// ------------------------------------------------------------------ actions

const SORTS = ['recent', 'name', 'created', 'manual'];

const actions = {
  'add-update': (el) => sheets.updateForm({ projectId: el.dataset.project, date: el.dataset.date }),
  'edit-update': (el) => sheets.updateForm({ id: el.dataset.id }),
  'new-project': () => sheets.projectForm(),
  'edit-project': (el) => sheets.projectForm({ id: el.dataset.id }),
  'open-project': (el) => sheets.projectSheet(el.dataset.id),
  'open-project-day': (el) => sheets.projectDaySheet(el.dataset.project, el.dataset.date),
  'open-day': (el) => sheets.daySheet(el.dataset.date),
  'open-settings': () => sheets.settingsSheet(),
  'cycle-sort': () => {
    const s = store.settings().sort;
    store.setSetting('sort', SORTS[(SORTS.indexOf(s) + 1) % SORTS.length]);
  },
  'move-project': (el) => {
    const { switched } = store.moveProject(el.dataset.id, el.dataset.where);
    if (switched) toast('Projects tab now uses your custom order');
  },
  'archive-project': (el) => {
    const p = store.getProject(el.dataset.id);
    if (!p) return;
    const archived = !p.archived;
    store.updateProject(p.id, { archived });
    toast(archived ? `Archived “${p.name}”` : `“${p.name}” is back on the Projects tab`, {
      action: 'Undo',
      onAction: () => store.updateProject(p.id, { archived: !archived }),
    });
  },
  'toggle-archived': () => store.setSetting('showArchived', !store.settings().showArchived),
  'snooze-backup': () => store.setSetting('backupNagUntil', new Date(Date.now() + 7 * 864e5).toISOString()),
  'load-sample': () => {
    store.loadSample();
    store.setSetting('backupNagUntil', new Date(Date.now() + 14 * 864e5).toISOString());
    toast('Sample data loaded — erase it any time in Settings');
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const name = el.dataset.action;
  if (actions[name]) return actions[name](el, e);
  const viewAction = views[current].actions?.[name];
  if (viewAction) {
    viewAction(el, e);
    render();
  }
});

// ------------------------------------------------------------------ theme

function applyTheme() {
  const t = store.settings().theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]').setAttribute('content', bg);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ------------------------------------------------------------------ wiring

store.onSaveError(() => toast('Could not save — phone storage may be full.', { duration: 8000 }));
store.subscribe(() => {
  applyTheme();
  render();
  refreshSheets();
});

// Re-render when the app comes back after midnight so "Today" stays right.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && todayKey() !== renderedDay) {
    render();
    refreshSheets();
  }
});

applyTheme();
route();

// Home-screen shortcut "Log an update" opens the app at ?add.
if (new URLSearchParams(location.search).has('add')) {
  history.replaceState(null, '', location.pathname + location.hash);
  sheets.updateForm();
}

// Ask the browser not to evict our data under storage pressure.
navigator.storage?.persist?.().catch(() => {});

// Offline support. Skipped on plain-http dev servers so edits show up immediately
// (add ?sw to the URL to test it locally).
const swEnabled = location.protocol === 'https:' || new URLSearchParams(location.search).has('sw');
if ('serviceWorker' in navigator && swEnabled) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker failed', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('A new version is ready', { action: 'Reload', onAction: () => location.reload(), duration: 15000 });
  });
}
