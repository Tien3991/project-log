// Projects view: one row per project. The first column is the project, then a
// horizontally scrolling strip with one card per day that has updates, newest first.

import * as store from '../store.js';
import { cardLabel, ago, diffDays, gapLabel, todayKey } from '../dates.js';
import { esc, plural } from '../ui.js';

const MAX_CARDS = 60;
export const SORT_LABEL = { manual: 'My order', name: 'Name', recent: 'Recently active', idle: 'Longest idle' };
const STALE_DAYS = 14;
const SECTION_LABEL = { inactive: 'Inactive', archived: 'Archived' };

export const title = 'Projects';

export function render() {
  const s = store.settings();
  const { byProject } = store.index();
  const all = store.getState().projects;
  const today = todayKey();

  if (!all.length) return emptyState(store.profiles().length > 1 ? store.activeProfile().name : null);

  const rows = (list) => list.map((p) => row(p, byProject.get(p.id), today)).join('');
  const active = store.orderedProjects();
  const section = (status) => {
    const list = store.orderedProjects({ statuses: [status] });
    if (!list.length) return '';
    const folded = store.isCollapsed(status);
    return `
      <button class="tl-section ${folded ? 'is-folded' : ''}" data-action="toggle-section" data-section="${status}" aria-expanded="${!folded}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>
        ${SECTION_LABEL[status]} · ${list.length}
      </button>
      ${folded ? '' : `<div class="tl">${rows(list)}</div>`}`;
  };

  return `
    ${backupBanner()}
    <div class="toolbar">
      <button class="chip" data-action="open-sort" aria-label="Sort: ${SORT_LABEL[s.sort]}. Change sort order">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/></svg>
        ${SORT_LABEL[s.sort]}
      </button>
      <span class="spacer"></span>
      <button class="chip" data-action="new-project">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> Project
      </button>
    </div>
    <div class="tl">
      ${active.length ? rows(active) : '<p class="muted small tl-none">No active projects. Inactive and archived ones are below.</p>'}
    </div>
    ${section('inactive')}
    ${section('archived')}`;
}

function row(p, info, today) {
  const stale = p.status === 'active' && info.last && diffDays(today, info.last) >= STALE_DAYS;
  const meta = info.last ? `${plural(info.count, 'update')} · ${ago(info.last, today)}` : 'No updates yet';
  const days = info.days.slice(0, MAX_CARDS);

  let cards = '';
  days.forEach((d, i) => {
    if (i > 0) {
      const gap = diffDays(days[i - 1].date, d.date);
      cards += gap > 1 ? `<span class="tl-gap" title="${gap} days between updates">${gapLabel(gap)}</span>` : '<span class="tl-gap tl-gap-0"></span>';
    }
    cards += card(p, d, today);
  });
  if (info.days.length > MAX_CARDS) {
    cards += `<button class="tl-more" data-action="open-project" data-id="${p.id}">All ${info.days.length} days →</button>`;
  }

  return `
    <div class="tl-row is-${p.status}" style="--c:${esc(p.color)}">
      <button class="tl-name" data-action="open-project" data-id="${p.id}">
        <span class="tl-title">${esc(p.name)}</span>
        <span class="tl-meta ${stale ? 'is-stale' : ''}">${meta}</span>
      </button>
      <div class="tl-strip">
        <button class="tl-add" data-action="add-update" data-project="${p.id}" aria-label="Log update for ${esc(p.name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>
        </button>
        ${cards || '<span class="tl-empty">Tap + to log the first update</span>'}
      </div>
    </div>`;
}

function card(p, day, today) {
  const n = day.items.length;
  const body = n === 1
    ? esc(day.items[0].text)
    : day.items.map((u) => `• ${esc(u.text)}`).join('\n');
  return `
    <button class="tl-card ${day.date === today ? 'is-today' : ''}" data-action="open-project-day" data-project="${p.id}" data-date="${day.date}">
      <span class="tl-date">${cardLabel(day.date, today)}${n > 1 ? `<b>${n}</b>` : ''}</span>
      <span class="tl-text">${body}</span>
    </button>`;
}

function emptyState(profileName) {
  return `
    <div class="empty">
      <svg viewBox="0 0 120 80" aria-hidden="true" class="empty-art">
        <rect x="4" y="8" width="30" height="12" rx="3"/><rect x="40" y="8" width="20" height="12" rx="3" class="a"/><rect x="66" y="8" width="20" height="12" rx="3" class="a"/>
        <rect x="4" y="34" width="30" height="12" rx="3"/><rect x="40" y="34" width="20" height="12" rx="3" class="b"/>
        <rect x="4" y="60" width="30" height="12" rx="3"/><rect x="40" y="60" width="20" height="12" rx="3" class="c"/><rect x="66" y="60" width="20" height="12" rx="3" class="c"/><rect x="92" y="60" width="20" height="12" rx="3" class="c"/>
      </svg>
      <h2>${profileName ? `No projects in “${esc(profileName)}” yet` : 'Track all your projects in one place'}</h2>
      <p>Each project gets a row. Every day you log progress, a card appears on its timeline.</p>
      <button class="btn btn-primary" data-action="new-project">Add ${profileName ? 'a' : 'your first'} project</button>
      <button class="btn btn-ghost" data-action="load-sample">Try it with sample data</button>
    </div>`;
}

function backupBanner() {
  const s = store.settings();
  const count = store.getState().updates.length;
  const now = Date.now();
  if (count < 20 || store.syncConfig()) return '';
  if (s.backupNagUntil && now < Date.parse(s.backupNagUntil)) return '';
  if (s.lastBackupAt && now - Date.parse(s.lastBackupAt) < 14 * 864e5) return '';
  return `
    <div class="banner">
      <span>Your log lives only on this phone. ${s.lastBackupAt ? 'Last backup was a while ago.' : 'Make a backup?'}</span>
      <button class="btn btn-small" data-action="open-settings">Back up</button>
      <button class="icon-btn" data-action="snooze-backup" aria-label="Remind me later">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </div>`;
}
