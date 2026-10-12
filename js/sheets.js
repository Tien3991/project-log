// Bottom sheets: logs and notes, projects, day details, profiles, sync and settings.

import * as store from './store.js';
import { todayKey, toKey, addDays, cardLabel, fullDate, dayHeading, startOfWeek, diffDays } from './dates.js';
import { openSheet, confirmSheet, toast, esc, plural } from './ui.js';
import { dayBlock, entryItem, swatches } from './components.js';
import * as sync from './sync.js';

// ------------------------------------------------------------------ add / edit an entry (log or note)

const KIND = {
  log: {
    add: 'Log an update', edit: 'Edit log', label: 'What did you get done?', submit: 'Log it',
    placeholder: 'e.g. Drafted the intro, sent it to Anna', missing: 'Write a few words about what you did.',
    hint: 'Counts as progress in Projects, Daily and Calendar.',
  },
  note: {
    add: 'Add a note', edit: 'Edit note', label: 'Note', submit: 'Save note',
    placeholder: 'e.g. Waiting for Anna’s feedback before the next step', missing: 'Write the note.',
    hint: 'A remark for yourself. Shown on the project’s page, not counted as progress.',
  },
};

const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function updateForm({ id, projectId, date, kind } = {}) {
  const existing = id ? store.getUpdate(id) : null;
  if (id && !existing) return;
  const active = store.orderedProjects({ sort: 'recent' });
  let pid = existing?.projectId ?? projectId ?? (active.length === 1 ? active[0].id : null);
  let day = existing?.date ?? date ?? todayKey();
  let time = existing ? store.timeOf(existing) : nowTime();
  let entryKind = existing?.kind ?? (kind === 'note' ? 'note' : 'log');

  const chips = () => {
    const list = store.orderedProjects({ sort: 'recent', statuses: ['active', 'inactive'] });
    const cur = store.getProject(pid);
    if (cur?.status === 'archived') list.unshift(cur);
    return list.map((p) => `
      <button type="button" class="pchip ${p.id === pid ? 'is-on' : ''} ${p.status !== 'active' ? 'is-dim' : ''}" style="--c:${esc(p.color)}" data-pid="${p.id}" aria-pressed="${p.id === pid}">
        <span class="dot"></span>${esc(p.name)}
      </button>`).join('') +
      '<button type="button" class="pchip pchip-new" data-new-project>+ New project</button>';
  };

  const sheet = openSheet({
    title: existing ? KIND[entryKind].edit : KIND[entryKind].add,
    body: () => `
      <form class="form" novalidate>
        <div class="seg seg-kind" role="group" aria-label="Entry type">
          ${['log', 'note'].map((k) => `<button type="button" data-kind="${k}" class="${k === entryKind ? 'is-on' : ''}" aria-pressed="${k === entryKind}">${k === 'log' ? 'Log' : 'Note'}</button>`).join('')}
        </div>
        <p class="muted small kind-hint">${KIND[entryKind].hint}</p>
        <div class="field">
          <span class="label">Project</span>
          <div class="pchips">${chips()}</div>
        </div>
        <div class="field">
          <span class="label">When</span>
          <div class="daychips">
            <button type="button" class="chip" data-day="0">Today</button>
            <button type="button" class="chip" data-day="1">Yesterday</button>
            <input type="date" class="date-input" value="${day}" aria-label="Date" required>
            <input type="time" class="date-input time-input" value="${time ?? ''}" aria-label="Time">
          </div>
        </div>
        <label class="field">
          <span class="label" data-text-label>${KIND[entryKind].label}</span>
          <textarea rows="4" placeholder="${KIND[entryKind].placeholder}" enterkeyhint="enter">${esc(existing?.text ?? '')}</textarea>
        </label>
        <p class="form-error" role="alert"></p>
        <div class="btn-row">
          ${existing ? '<button type="button" class="btn btn-danger-ghost" data-delete>Delete</button>' : ''}
          <span class="spacer"></span>
          <button type="submit" class="btn btn-primary">${existing ? 'Save' : KIND[entryKind].submit}</button>
        </div>
      </form>`,
    mount: (b) => {
      const form = b.querySelector('form');
      const ta = b.querySelector('textarea');
      const dateInput = b.querySelector('.date-input[type="date"]');
      const timeInput = b.querySelector('.time-input');
      const err = b.querySelector('.form-error');
      const chipBox = b.querySelector('.pchips');

      const syncDay = () => {
        b.querySelectorAll('[data-day]').forEach((c) =>
          c.classList.toggle('is-on', addDays(todayKey(), -Number(c.dataset.day)) === day));
      };
      syncDay();

      // Switching between log and note keeps everything typed so far.
      b.querySelectorAll('[data-kind]').forEach((btn) => btn.addEventListener('click', () => {
        entryKind = btn.dataset.kind;
        const k = KIND[entryKind];
        b.querySelectorAll('[data-kind]').forEach((x) => {
          x.classList.toggle('is-on', x === btn);
          x.setAttribute('aria-pressed', x === btn);
        });
        b.querySelector('.kind-hint').textContent = k.hint;
        b.querySelector('[data-text-label]').textContent = k.label;
        ta.placeholder = k.placeholder;
        if (!existing) form.querySelector('[type="submit"]').textContent = k.submit;
        sheet.el.querySelector('.sheet-h h2').textContent = existing ? k.edit : k.add;
      }));

      chipBox.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-pid]');
        if (chip) {
          pid = chip.dataset.pid;
          chipBox.innerHTML = chips();
          err.textContent = '';
          if (!ta.value.trim()) ta.focus();
        } else if (e.target.closest('[data-new-project]')) {
          projectForm({
            onSaved: (p) => {
              pid = p.id;
              chipBox.innerHTML = chips();
            },
          });
        }
      });
      b.querySelectorAll('[data-day]').forEach((c) => c.addEventListener('click', () => {
        day = addDays(todayKey(), -Number(c.dataset.day));
        dateInput.value = day;
        syncDay();
      }));
      dateInput.addEventListener('change', () => {
        if (dateInput.value) day = dateInput.value;
        syncDay();
      });
      timeInput.addEventListener('change', () => {
        time = timeInput.value || null;
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit();
      });

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!pid || !store.getProject(pid)) return void (err.textContent = 'Pick a project.');
        if (!text) return void (err.textContent = KIND[entryKind].missing, ta.focus());
        if (!day) return void (err.textContent = 'Pick a day.');
        sheet.close();
        const entry = { projectId: pid, kind: entryKind, date: day, time, text };
        const noun = entryKind === 'note' ? 'Note' : 'Log';
        if (existing) {
          store.editUpdate(existing.id, entry);
          toast(`${noun} saved`);
        } else {
          const u = store.addUpdate(entry);
          toast(`${entryKind === 'note' ? 'Note added' : 'Logged'} · ${store.getProject(pid).name} · ${cardLabel(day)}`, {
            action: 'Undo',
            onAction: () => store.deleteUpdate(u.id),
          });
        }
      });

      b.querySelector('[data-delete]')?.addEventListener('click', () => {
        sheet.close();
        const removed = store.deleteUpdate(existing.id);
        toast(`${removed.kind === 'note' ? 'Note' : 'Log'} deleted`, { action: 'Undo', onAction: () => store.restoreUpdate(removed) });
      });

      if (pid) requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      });
    },
  });
}

// ------------------------------------------------------------------ create / edit a project

export function projectForm({ id, onSaved } = {}) {
  const existing = id ? store.getProject(id) : null;
  if (id && !existing) return;
  let color = existing?.color ?? store.nextColor();
  let status = existing?.status ?? 'active';

  openSheet({
    title: existing ? 'Edit project' : 'New project',
    body: () => `
      <form class="form" novalidate>
        <label class="field">
          <span class="label">Name</span>
          <input type="text" class="text-input" value="${esc(existing?.name ?? '')}" placeholder="e.g. Thesis, Kitchen remodel, Learn Spanish" maxlength="80" autocomplete="off" enterkeyhint="done">
        </label>
        <div class="field">
          <span class="label">Colour</span>
          ${swatches(color)}
        </div>
        <p class="form-error" role="alert"></p>
        ${existing ? `
        <div class="field">
          <span class="label">Status</span>
          ${statusSeg(status, (st) => `data-status="${st}"`)}
          <p class="muted small" data-status-hint>${STATUS_HINT[status]}</p>
        </div>` : ''}
        <div class="btn-row">
          ${existing ? '<button type="button" class="btn btn-danger-ghost" data-delete>Delete</button>' : ''}
          <span class="spacer"></span>
          <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Create project'}</button>
        </div>
      </form>`,
    mount: (b, sheet) => {
      const input = b.querySelector('.text-input');
      const err = b.querySelector('.form-error');
      b.querySelector('.swatches').addEventListener('click', (e) => {
        const sw = e.target.closest('[data-color]');
        if (!sw) return;
        color = sw.dataset.color;
        b.querySelectorAll('[data-color]').forEach((x) => {
          x.classList.toggle('is-on', x === sw);
          x.setAttribute('aria-checked', x === sw);
        });
      });
      b.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return void (err.textContent = 'Give the project a name.', input.focus());
        const clash = store.getState().projects.find((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase());
        if (clash) return void (err.textContent = 'You already have a project with that name.');
        sheet.close();
        if (existing) {
          store.updateProject(id, { name, color, status });
          toast('Project saved');
        } else {
          const p = store.addProject({ name, color });
          toast(`Created “${p.name}”`);
          onSaved?.(p);
        }
      });
      b.querySelectorAll('[data-status]').forEach((btn) => btn.addEventListener('click', () => {
        status = btn.dataset.status;
        b.querySelectorAll('[data-status]').forEach((x) => {
          x.classList.toggle('is-on', x === btn);
          x.setAttribute('aria-pressed', x === btn);
        });
        b.querySelector('[data-status-hint]').textContent = STATUS_HINT[status];
      }));
      b.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const n = store.index().byProject.get(id)?.count ?? 0;
        const ok = await confirmSheet({
          title: 'Delete project?',
          message: `“${existing.name}” and its ${plural(n, 'update')} will be deleted. Archive it instead if you just want it out of the way.`,
          confirm: 'Delete',
          danger: true,
        });
        if (!ok) return;
        sheet.close();
        const removed = store.deleteProject(id);
        toast(`Deleted “${existing.name}”`, { action: 'Undo', onAction: () => store.restoreProject(removed), duration: 8000 });
      });
      if (!existing) requestAnimationFrame(() => input.focus());
    },
  });
}

// ------------------------------------------------------------------ project history

export function projectSheet(id) {
  openSheet({
    live: true,
    title: () => store.getProject(id)?.name ?? '',
    body: () => {
      const p = store.getProject(id);
      if (!p) return null;
      const info = store.index().byProject.get(id);
      const days = store.projectDays(id);    // notes first, then logs, newest first
      const today = todayKey();
      const ws = store.settings().weekStart;
      const weekStart = startOfWeek(today, ws);
      const monthStart = `${today.slice(0, 8)}01`;
      let week = 0, month = 0;
      for (const d of info.days) {
        if (d.date > today) continue;
        if (d.date >= weekStart) week += d.items.length;
        if (d.date >= monthStart) month += d.items.length;
      }

      // Last 12 weeks of activity, oldest on the left.
      const spark = Array.from({ length: 12 }, (_, i) => ({ w: addDays(weekStart, -7 * (11 - i)), c: 0 }));
      for (const d of info.days) {
        const idx = 11 - Math.floor(diffDays(weekStart, startOfWeek(d.date, ws)) / 7);
        if (idx >= 0 && idx < 12) spark[idx].c += d.items.length;
      }
      const sparkMax = Math.max(1, ...spark.map((s) => s.c));

      return `
        <div style="--c:${esc(p.color)}">
          <div class="stats">
            <div><b>${week}</b><span>this week</span></div>
            <div><b>${month}</b><span>this month</span></div>
            <div><b>${info.count}</b><span>total</span></div>
            <div><b>${info.days.length}</b><span>active days</span></div>
          </div>
          <div class="spark" aria-label="Logs per week, last 12 weeks">
            ${spark.map((s) => `<i style="--h:${(s.c / sparkMax) * 100}%" title="Week of ${s.w}: ${s.c}"></i>`).join('')}
          </div>
          <div class="spark-axis"><span>12 weeks ago</span><span>this week</span></div>
          ${arrangeControls(p)}
          <div class="btn-row">
            <button class="btn" data-action="edit-project" data-id="${id}">Edit</button>
            <span class="spacer"></span>
            <button class="btn" data-action="add-update" data-project="${id}" data-kind="note">+ Note</button>
            <button class="btn btn-primary" data-action="add-update" data-project="${id}">+ Log</button>
          </div>
          <h3 class="section-h">History</h3>
          ${days.length ? `<ol class="hist">${days.map((d, i) => {
            const gap = i < days.length - 1 ? diffDays(d.date, days[i + 1].date) : 0;
            return `
              <li class="${d.logs.length ? '' : 'notes-only'}">
                <div class="hist-date"><b>${cardLabel(d.date, today)}</b>${gap > 1 ? `<span>${gap} days after previous</span>` : ''}</div>
                <ul class="day-items">${[...d.notes, ...d.logs].map((u) => entryItem(u)).join('')}</ul>
              </li>`;
          }).join('')}</ol>` : '<p class="muted">Nothing yet. Log progress with “+ Log”, or jot a remark with “+ Note”.</p>'}
        </div>`;
    },
  });
}

const MOVES = [
  ['top', 'Move to top', 'M6 4h12M12 20V9M7 13l5-5 5 5'],
  ['up', 'Move up', 'M12 19V5M6 11l6-6 6 6'],
  ['down', 'Move down', 'M12 5v14M6 13l6 6 6-6'],
  ['bottom', 'Move to bottom', 'M6 20h12M12 4v11M7 11l5 5 5-5'],
];

const STATUS_LABEL = { active: 'Active', inactive: 'Inactive', archived: 'Archived' };
const STATUS_HINT = {
  active: 'Shown at the top of the Projects tab.',
  inactive: 'On hold: listed in its own section below the active projects, and never flagged as stale.',
  archived: 'Done or dropped: kept in the folded Archived section at the bottom. Its history stays.',
};

function statusSeg(current, attrs) {
  return `<div class="seg seg-status" role="group" aria-label="Status">${store.STATUSES.map((st) =>
    `<button type="button" class="${st === current ? 'is-on' : ''}" ${attrs(st)} aria-pressed="${st === current}">${STATUS_LABEL[st]}</button>`).join('')}</div>`;
}

/** Status and reorder controls for the project page. */
function arrangeControls(p) {
  const { index, total, status } = store.projectPosition(p.id);
  const moves = MOVES.map(([where, label, path]) => {
    const disabled = where === 'top' || where === 'up' ? index === 0 : index === total - 1;
    return `<button class="move-btn" data-action="move-project" data-id="${p.id}" data-where="${where}" aria-label="${label}" title="${label}" ${disabled ? 'disabled' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg></button>`;
  }).join('');
  return `
    <div class="proj-ctrl">
      <div class="set-row"><span>Status</span>${statusSeg(p.status, (st) => `data-action="set-project-status" data-id="${p.id}" data-status="${st}"`)}</div>
      <div class="set-row"><span>Position</span><div class="move-group" role="group" aria-label="Position">${moves}</div></div>
      <p class="muted small">#${index + 1} of ${plural(total, `${status} project`)}${store.settings().sort === 'manual' ? '' : ' · moving it switches the Projects tab to My order'}</p>
    </div>`;
}

// ------------------------------------------------------------------ sort menu

const SORT_OPTIONS = [
  ['manual', 'My order', 'Your own arrangement. Use the arrows on a project’s page to move it.'],
  ['name', 'Name', 'Alphabetical, A to Z.'],
  ['recent', 'Recently active', 'Most recently updated first.'],
  ['idle', 'Longest idle', 'Longest time since the last update first.'],
];

export function sortSheet() {
  const current = store.settings().sort;
  const sheet = openSheet({
    title: 'Sort projects',
    className: 'sheet-compact',
    body: () => `
      <div class="choices" role="radiogroup" aria-label="Sort projects">
        ${SORT_OPTIONS.map(([value, label, hint]) => `
          <button class="choice ${value === current ? 'is-on' : ''}" data-sort="${value}" role="radio" aria-checked="${value === current}">
            <span class="grow"><b>${label}</b><span class="muted small">${hint}</span></span>
            ${value === current ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : ''}
          </button>`).join('')}
      </div>
      <p class="muted small">Inactive and archived projects are sorted the same way within their own sections. A project with no updates yet counts from the day it was created.</p>`,
    mount: (b) => b.querySelectorAll('[data-sort]').forEach((btn) => btn.addEventListener('click', () => {
      sheet.close();
      store.setSetting('sort', btn.dataset.sort);
    })),
  });
}

// ------------------------------------------------------------------ one project on one day

export function projectDaySheet(projectId, date) {
  openSheet({
    live: true,
    title: () => store.getProject(projectId)?.name ?? '',
    body: () => {
      const p = store.getProject(projectId);
      const day = store.projectDays(projectId).find((d) => d.date === date);
      if (!p || !day) return null;
      return `
        <p class="sheet-sub">${fullDate(date)} · ${plural(day.logs.length, 'log')}${day.notes.length ? ` · ${plural(day.notes.length, 'note')}` : ''}</p>
        <ul class="day-items day-items-lg" style="--c:${esc(p.color)}">
          ${[...day.notes, ...day.logs].map((u) => entryItem(u)).join('')}
        </ul>
        <p class="muted small">Tap an entry to edit it.</p>
        <div class="btn-row">
          <button class="btn" data-action="open-project" data-id="${p.id}">History</button>
          <span class="spacer"></span>
          <button class="btn" data-action="add-update" data-project="${p.id}" data-date="${date}" data-kind="note">+ Note</button>
          <button class="btn btn-primary" data-action="add-update" data-project="${p.id}" data-date="${date}">+ Log</button>
        </div>`;
    },
  });
}

// ------------------------------------------------------------------ everything on one day

export function daySheet(date) {
  openSheet({
    live: true,
    title: () => dayHeading(date).title,
    body: () => {
      const items = store.index().byDate.get(date) ?? [];
      const { title, sub } = dayHeading(date);
      return `
        <p class="sheet-sub">${title === sub ? '' : `${esc(sub)} · `}${items.length ? plural(items.length, 'log') : 'Nothing logged'}</p>
        ${items.length ? dayBlock(date, items, { heading: false }) : ''}
        <div class="btn-row">
          <span class="spacer"></span>
          <button class="btn btn-primary" data-action="add-update" data-date="${date}">Log update for this day</button>
        </div>`;
    },
  });
}

// ------------------------------------------------------------------ settings

// Chrome offers an install prompt once the app qualifies; keep it for the Settings button.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});
window.addEventListener('appinstalled', () => (installPrompt = null));

function backupFile() {
  const name = `project-log-${todayKey()}`;
  const json = store.exportJSON();
  // Android's share sheet rejects .json files, so share as .txt (restore accepts both).
  const asJson = new File([json], `${name}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [asJson] })) return asJson;
  const asText = new File([json], `${name}.txt`, { type: 'text/plain' });
  if (navigator.canShare?.({ files: [asText] })) return asText;
  return null;
}

function downloadBackup() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `project-log-${todayKey()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  store.setSetting('lastBackupAt', new Date().toISOString());
  toast('Backup saved to Downloads');
}

async function shareBackup() {
  const file = backupFile();
  if (!file) return downloadBackup();
  try {
    await navigator.share({ files: [file], title: 'Project Log backup' });
    store.setSetting('lastBackupAt', new Date().toISOString());
  } catch (e) {
    if (e.name !== 'AbortError') toast('Could not share the backup');
  }
}

function importSheet(backup) {
  const profile = store.activeProfile();
  const all = backup.kind === 'all';
  const s = openSheet({
    title: 'Restore backup',
    className: 'sheet-compact',
    body: () => `
      <p class="confirm-msg">${all
        ? `This backup has ${plural(backup.profiles, 'profile')}, ${plural(backup.projects, 'project')} and ${plural(backup.updates, 'update')}.`
        : `This backup has ${plural(backup.projects.length, 'project')} and ${plural(backup.updates.length, 'update')}. They’ll go into the “${esc(profile.name)}” profile.`}</p>
      <div class="btn-col">
        <button class="btn btn-primary" data-mode="merge">Merge with what's here</button>
        <button class="btn btn-danger-ghost" data-mode="replace">${all ? 'Replace all profiles with the backup' : `Replace everything in “${esc(profile.name)}”`}</button>
      </div>
      <p class="muted small">Merge keeps everything here and adds anything from the backup that's missing.${store.syncConfig() ? ' The result syncs to your other devices.' : ''}</p>`,
    mount: (b) => b.querySelectorAll('[data-mode]').forEach((btn) => btn.addEventListener('click', () => {
      store.importBackup(backup, btn.dataset.mode);
      s.close();
      toast(btn.dataset.mode === 'merge' ? 'Backup merged' : 'Backup restored');
    })),
  });
}

/** "just now", "5 min ago", "3 h ago", or a date. */
function since(iso) {
  if (!iso) return 'never';
  const sec = (Date.now() - Date.parse(iso)) / 1000;
  if (sec < 45) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return cardLabel(toKey(new Date(iso)));
}

/** "3 projects · 120 logs · 4 notes" */
const countLine = (n) => `${plural(n.projects, 'project')} · ${plural(n.logs, 'log')}${n.notes ? ` · ${plural(n.notes, 'note')}` : ''}`;

const SYNC_LABEL = {
  off: 'Off',
  synced: 'Up to date',
  pending: 'Changes waiting to sync',
  syncing: 'Syncing…',
  offline: 'Offline: will sync when you’re back online',
  error: 'Sync problem',
};

export function settingsSheet() {
  openSheet({
    live: true,
    title: 'Settings',
    body: () => {
      const s = store.settings();
      const st = store.getState();
      const profile = store.activeProfile();
      const profileCount = store.profiles().length;
      const cfg = store.syncConfig();
      const { byProject } = store.index();
      const projects = store.orderedProjects({ sort: 'name', statuses: 'all' });
      const seg = (key, options) => `<div class="seg">${options.map(([v, label]) =>
        `<button class="${s[key] === v ? 'is-on' : ''}" data-setting="${key}" data-value="${v}" aria-pressed="${s[key] === v}">${label}</button>`).join('')}</div>`;
      const kb = Math.max(1, Math.round((localStorage.getItem(store.DOC_KEY)?.length ?? 0) / 1024));
      const lastBackup = s.lastBackupAt ? cardLabel(toKey(new Date(s.lastBackupAt))) : 'never';

      return `
        <section class="set">
          <h3 class="section-h">Profile</h3>
          <button class="row-btn" data-action="open-profiles" style="--c:${esc(profile.color)}">
            <span class="dot"></span>
            <span class="grow"><b>${esc(profile.name)}</b><span class="muted small">${profileCount > 1 ? `${profileCount} profiles · tap to switch or manage` : 'Add profiles to keep separate jobs apart'}</span></span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
          </button>
        </section>

        <section class="set">
          <h3 class="section-h">Projects in “${esc(profile.name)}”</h3>
          ${projects.length ? `<ul class="plist">${projects.map((p) => `
            <li><button data-action="edit-project" data-id="${p.id}" style="--c:${esc(p.color)}">
              <span class="dot"></span><span class="grow">${esc(p.name)}</span>
              <span class="muted small">${p.status === 'active' ? '' : `${p.status} · `}${byProject.get(p.id)?.count ?? 0}</span>
            </button></li>`).join('')}</ul>` : ''}
          <button class="btn btn-block" data-action="new-project">+ New project</button>
        </section>

        <section class="set">
          <h3 class="section-h">Sync</h3>
          <button class="row-btn" data-action="open-sync">
            <span class="grow"><b>${cfg ? SYNC_LABEL[sync.getState()] : 'Off'}</b><span class="muted small">${cfg
              ? `${esc(cfg.repo)} · last synced ${since(cfg.lastSyncAt)}`
              : 'Keep your phone, iPad and other devices in step'}</span></span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
          </button>
        </section>

        <section class="set">
          <h3 class="section-h">Preferences</h3>
          <div class="set-row"><span>Week starts on</span>${seg('weekStart', [[1, 'Monday'], [0, 'Sunday']])}</div>
          <div class="set-row"><span>Theme</span>${seg('theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])}</div>
        </section>

        <section class="set">
          <h3 class="section-h">Backup</h3>
          <p class="muted small">${cfg
            ? 'Sync keeps every version on GitHub. A backup file is an extra copy you hold yourself.'
            : 'Everything is stored on this device only. Back up now and then, so a cleared browser or a new phone doesn’t lose your history.'}
            Backups include all profiles. Last backup: <b>${lastBackup}</b>.</p>
          <div class="btn-col">
            ${backupFile() ? '<button class="btn" data-set="share">Share backup to Drive, email…</button>' : ''}
            <button class="btn" data-set="download">Download backup file</button>
            <label class="btn">Restore from backup…<input type="file" accept=".json,.txt,application/json,text/plain" data-set="import" hidden></label>
          </div>
        </section>

        ${installPrompt ? `
        <section class="set">
          <h3 class="section-h">Install</h3>
          <button class="btn btn-primary btn-block" data-set="install">Add Project Log to home screen</button>
        </section>` : ''}

        <section class="set">
          <h3 class="section-h">Data</h3>
          <p class="muted small">“${esc(profile.name)}”: ${countLine(store.profileStats(profile.id))}. All profiles: ${kb} KB.</p>
          ${st.projects.length
            ? `<button class="btn btn-danger-ghost" data-set="erase">Erase “${esc(profile.name)}” data</button>`
            : '<button class="btn" data-action="load-sample">Load sample data</button>'}
        </section>

        <p class="muted small center" data-version>Project Log</p>`;
    },
    mount: (b, sheet) => {
      b.querySelectorAll('[data-setting]').forEach((btn) => btn.addEventListener('click', () => {
        const v = btn.dataset.value;
        store.setSetting(btn.dataset.setting, /^\d+$/.test(v) ? Number(v) : v);
      }));
      b.querySelector('[data-set="share"]')?.addEventListener('click', shareBackup);
      b.querySelector('[data-set="download"]').addEventListener('click', downloadBackup);
      b.querySelector('[data-set="install"]')?.addEventListener('click', async () => {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        sheet.close();
      });
      b.querySelector('[data-set="import"]').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
          importSheet(store.parseBackup(await file.text()));
        } catch (err) {
          toast(err.message);
        }
      });
      b.querySelector('[data-set="erase"]')?.addEventListener('click', async () => {
        const name = store.activeProfile().name;
        const ok = await confirmSheet({
          title: `Erase “${name}”?`,
          message: `All projects and updates in this profile will be deleted${store.syncConfig() ? ', on every synced device' : ''}. Other profiles are not affected.`,
          confirm: 'Erase',
          danger: true,
        });
        if (!ok) return;
        const snapshot = store.eraseProfileData();
        toast(`Erased “${name}”`, { action: 'Undo', onAction: () => store.restoreProfileData(snapshot), duration: 10000 });
      });
      // The service worker's cache name carries the app version.
      globalThis.caches?.keys().then((keys) => {
        const v = keys.find((k) => k.startsWith('project-log-'))?.slice('project-log-'.length);
        if (v) b.querySelector('[data-version]').textContent = `Project Log ${v}`;
      });
    },
  });
}

// ------------------------------------------------------------------ profiles

export function profilesSheet() {
  let reordering = false;
  const arrow = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const sheet = openSheet({
    live: true,
    title: 'Profiles',
    body: () => {
      const list = store.profiles();
      const active = store.activeProfile().id;
      return `
        <div class="sheet-sub-row">
          <p class="sheet-sub">${reordering ? 'Use the arrows to change the order.' : 'Each profile has its own projects and history, for example one per job.'}</p>
          ${list.length > 1 ? `<button class="chip ${reordering ? 'is-on' : ''}" data-reorder>${reordering ? 'Done' : 'Reorder'}</button>` : ''}
        </div>
        <ul class="profiles">
          ${list.map((p, i) => `
            <li class="${p.id === active ? 'is-on' : ''}" style="--c:${esc(p.color)}">
              <button class="prof-main" ${reordering ? 'tabindex="-1"' : `data-switch="${p.id}"`} ${p.id === active ? 'aria-current="true"' : ''}>
                <span class="prof-dot"></span>
                <span class="grow"><b>${esc(p.name)}</b><span class="muted small">${countLine(store.profileStats(p.id))}</span></span>
                ${p.id === active && !reordering ? '<svg viewBox="0 0 24 24" aria-hidden="true" class="check"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : ''}
              </button>
              ${reordering ? `
                <button class="icon-btn" data-move="up" data-id="${p.id}" aria-label="Move ${esc(p.name)} up" ${i === 0 ? 'disabled' : ''}>${arrow('M12 19V5M6 11l6-6 6 6')}</button>
                <button class="icon-btn" data-move="down" data-id="${p.id}" aria-label="Move ${esc(p.name)} down" ${i === list.length - 1 ? 'disabled' : ''}>${arrow('M12 5v14M6 13l6 6 6-6')}</button>`
              : `
                <button class="icon-btn" data-edit-profile="${p.id}" aria-label="Edit ${esc(p.name)}">
                  ${arrow('M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4')}
                </button>`}
            </li>`).join('')}
        </ul>
        ${reordering ? '' : '<button class="btn btn-block" data-new-profile>+ New profile</button>'}`;
    },
    mount: (b) => {
      b.querySelector('[data-reorder]')?.addEventListener('click', () => {
        reordering = !reordering;
        sheet.refresh();
      });
      b.querySelectorAll('[data-move]').forEach((btn) =>
        btn.addEventListener('click', () => store.moveProfile(btn.dataset.id, btn.dataset.move)));
      b.querySelectorAll('[data-switch]').forEach((btn) => btn.addEventListener('click', () => {
        sheet.close();
        if (btn.dataset.switch === store.activeProfile().id) return;
        store.switchProfile(btn.dataset.switch);
        toast(`Switched to “${store.activeProfile().name}”`);
      }));
      b.querySelectorAll('[data-edit-profile]').forEach((btn) =>
        btn.addEventListener('click', () => profileForm({ id: btn.dataset.editProfile })));
      b.querySelector('[data-new-profile]')?.addEventListener('click', () => profileForm({
        onSaved: (p) => {
          sheet.close();
          store.switchProfile(p.id);
        },
      }));
    },
  });
}

export function profileForm({ id, onSaved } = {}) {
  const existing = id ? store.getProfile(id) : null;
  if (id && !existing) return;
  let color = existing?.color ?? store.nextProfileColor();

  openSheet({
    title: existing ? 'Edit profile' : 'New profile',
    body: () => `
      <form class="form" novalidate>
        <label class="field">
          <span class="label">Name</span>
          <input type="text" class="text-input" value="${esc(existing?.name ?? '')}" placeholder="e.g. Day job, Freelance, Personal" maxlength="60" autocomplete="off" enterkeyhint="done">
        </label>
        <div class="field">
          <span class="label">Colour</span>
          ${swatches(color)}
        </div>
        <p class="form-error" role="alert"></p>
        <div class="btn-row">
          ${existing && store.profiles().length > 1 ? '<button type="button" class="btn btn-danger-ghost" data-delete>Delete</button>' : ''}
          <span class="spacer"></span>
          <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Create profile'}</button>
        </div>
      </form>`,
    mount: (b, sheet) => {
      const input = b.querySelector('.text-input');
      const err = b.querySelector('.form-error');
      b.querySelector('.swatches').addEventListener('click', (e) => {
        const sw = e.target.closest('[data-color]');
        if (!sw) return;
        color = sw.dataset.color;
        b.querySelectorAll('[data-color]').forEach((x) => {
          x.classList.toggle('is-on', x === sw);
          x.setAttribute('aria-checked', x === sw);
        });
      });
      b.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return void (err.textContent = 'Give the profile a name.', input.focus());
        if (store.profiles().some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) {
          return void (err.textContent = 'You already have a profile with that name.');
        }
        sheet.close();
        if (existing) {
          store.updateProfile(id, { name, color });
          toast('Profile saved');
        } else {
          const p = store.addProfile({ name, color });
          toast(`Created “${p.name}”`);
          onSaved?.(p);
        }
      });
      b.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const n = store.profileStats(id);
        const ok = await confirmSheet({
          title: 'Delete profile?',
          message: `“${existing.name}” and everything in it (${countLine(n)}) will be deleted${store.syncConfig() ? ' on every synced device' : ''}.`,
          confirm: 'Delete',
          danger: true,
        });
        if (!ok) return;
        sheet.close();
        const removed = store.deleteProfile(id);
        if (removed) toast(`Deleted “${existing.name}”`, { action: 'Undo', onAction: () => store.restoreProfile(removed), duration: 8000 });
      });
      if (!existing) requestAnimationFrame(() => input.focus());
    },
  });
}

// ------------------------------------------------------------------ sync

/** On github.io the owner is in the hostname, so the repository can be suggested. */
function suggestedRepo() {
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
  return m ? `${m[1]}/project-log-data` : '';
}

export function syncSheet() {
  let editing = !store.syncConfig();

  const form = (cfg) => `
    <p class="muted">Keep this log the same on your phone, iPad and other devices. It is saved as a file in a
      <b>private GitHub repository</b> that you own. GitHub keeps every version, so it also works as a backup history.</p>
    <ol class="steps">
      <li>Create a private repository, for example <b>project-log-data</b>, at
        <a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a>. Make sure <i>Private</i> is selected.</li>
      <li>Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained access token</a>.
        Under <i>Repository access</i>, pick <i>Only select repositories</i> and choose your data repository. Under
        <i>Permissions → Repository permissions</i>, set <i>Contents</i> to <i>Read and write</i>.</li>
      <li>Enter both below. Repeat on each device, using the same repository.</li>
    </ol>
    <form class="form" novalidate>
      <label class="field">
        <span class="label">Repository</span>
        <input class="text-input" name="repo" value="${esc(cfg?.repo ?? suggestedRepo())}" placeholder="owner/project-log-data"
          autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off">
      </label>
      <label class="field">
        <span class="label">Access token</span>
        <input class="text-input" name="token" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false">
      </label>
      <p class="form-error" role="alert"></p>
      <div class="btn-row">
        ${cfg ? '<button type="button" class="btn" data-cancel>Cancel</button>' : ''}
        <span class="spacer"></span>
        <button type="submit" class="btn btn-primary">Connect</button>
      </div>
      <p class="muted small">The token is stored only on this device. Whatever is already here is merged with the copy on GitHub, so nothing is overwritten.</p>
    </form>`;

  const status = (cfg) => {
    const state = sync.getState();
    return `
      <div class="sync-status is-${state}">
        <b>${SYNC_LABEL[state]}</b>
        <span class="muted small">Last synced ${since(cfg.lastSyncAt)}</span>
      </div>
      ${state === 'error' && cfg.lastError ? `<p class="form-error">${esc(cfg.lastError)}</p>` : ''}
      <div class="set-row"><span>Repository</span><a href="https://github.com/${esc(cfg.repo)}" target="_blank" rel="noopener">${esc(cfg.repo)}</a></div>
      <div class="btn-col">
        <button class="btn btn-primary" data-sync-now ${state === 'syncing' ? 'disabled' : ''}>Sync now</button>
        <a class="btn" href="https://github.com/${esc(cfg.repo)}/commits" target="_blank" rel="noopener">Version history on GitHub</a>
        <button class="btn" data-edit>Change repository or token</button>
        <button class="btn btn-danger-ghost" data-disconnect>Turn off sync on this device</button>
      </div>
      <p class="muted small">Turning sync off keeps everything on this device and leaves the copy on GitHub as it is.</p>`;
  };

  const sheet = openSheet({
    title: 'Sync',
    live: () => !editing,     // don't wipe what's being typed
    body: () => {
      const cfg = store.syncConfig();
      return editing || !cfg ? form(cfg) : status(cfg);
    },
    mount: (b) => {
      b.querySelector('[data-sync-now]')?.addEventListener('click', () => sync.syncNow());
      b.querySelector('[data-edit]')?.addEventListener('click', () => {
        editing = true;
        sheet.refresh();
      });
      b.querySelector('[data-cancel]')?.addEventListener('click', () => {
        editing = false;
        sheet.refresh();
      });
      b.querySelector('[data-disconnect]')?.addEventListener('click', () => {
        sync.disconnect();
        editing = true;
        sheet.refresh();
        toast('Sync is off on this device');
      });
      const formEl = b.querySelector('form');
      formEl?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = formEl.querySelector('[type="submit"]');
        const err = formEl.querySelector('.form-error');
        err.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Connecting…';
        try {
          await sync.connect({ repo: formEl.repo.value, token: formEl.token.value });
          editing = false;
          sheet.refresh();
          toast('Sync is on');
        } catch (ex) {
          err.textContent = ex.message;
          btn.disabled = false;
          btn.textContent = 'Connect';
        }
      });
    },
  });
}
