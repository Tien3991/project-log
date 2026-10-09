// Bottom sheets: logging/editing updates, projects, day details and settings.

import * as store from './store.js';
import { todayKey, toKey, addDays, cardLabel, fullDate, dayHeading, startOfWeek, diffDays } from './dates.js';
import { openSheet, confirmSheet, toast, esc, plural } from './ui.js';
import { dayBlock, swatches } from './components.js';
import * as sync from './sync.js';

// ------------------------------------------------------------------ log / edit an update

export function updateForm({ id, projectId, date } = {}) {
  const existing = id ? store.getUpdate(id) : null;
  if (id && !existing) return;
  const active = store.orderedProjects({ sort: 'recent' });
  let pid = existing?.projectId ?? projectId ?? (active.length === 1 ? active[0].id : null);
  let day = existing?.date ?? date ?? todayKey();

  const chips = () => {
    const list = store.orderedProjects({ sort: 'recent' });
    const cur = store.getProject(pid);
    if (cur?.archived) list.unshift(cur);
    return list.map((p) => `
      <button type="button" class="pchip ${p.id === pid ? 'is-on' : ''}" style="--c:${esc(p.color)}" data-pid="${p.id}" aria-pressed="${p.id === pid}">
        <span class="dot"></span>${esc(p.name)}
      </button>`).join('') +
      '<button type="button" class="pchip pchip-new" data-new-project>+ New project</button>';
  };

  openSheet({
    title: existing ? 'Edit update' : 'Log an update',
    body: () => `
      <form class="form" novalidate>
        <div class="field">
          <span class="label">Project</span>
          <div class="pchips">${chips()}</div>
        </div>
        <div class="field">
          <span class="label">Day</span>
          <div class="daychips">
            <button type="button" class="chip" data-day="0">Today</button>
            <button type="button" class="chip" data-day="1">Yesterday</button>
            <input type="date" class="date-input" value="${day}" aria-label="Date" required>
          </div>
        </div>
        <label class="field">
          <span class="label">What did you get done?</span>
          <textarea rows="4" placeholder="e.g. Drafted the intro, sent it to Anna" enterkeyhint="enter">${esc(existing?.text ?? '')}</textarea>
        </label>
        <p class="form-error" role="alert"></p>
        <div class="btn-row">
          ${existing ? '<button type="button" class="btn btn-danger-ghost" data-delete>Delete</button>' : ''}
          <span class="spacer"></span>
          <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Log it'}</button>
        </div>
      </form>`,
    mount: (b, sheet) => {
      const form = b.querySelector('form');
      const ta = b.querySelector('textarea');
      const dateInput = b.querySelector('.date-input');
      const err = b.querySelector('.form-error');
      const chipBox = b.querySelector('.pchips');

      const syncDay = () => {
        b.querySelectorAll('[data-day]').forEach((c) =>
          c.classList.toggle('is-on', addDays(todayKey(), -Number(c.dataset.day)) === day));
      };
      syncDay();

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
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit();
      });

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!pid || !store.getProject(pid)) return void (err.textContent = 'Pick a project.');
        if (!text) return void (err.textContent = 'Write a few words about what you did.', ta.focus());
        if (!day) return void (err.textContent = 'Pick a day.');
        sheet.close();
        if (existing) {
          store.editUpdate(existing.id, { projectId: pid, date: day, text });
          toast('Update saved');
        } else {
          const u = store.addUpdate({ projectId: pid, date: day, text });
          toast(`Logged · ${store.getProject(pid).name} · ${cardLabel(day)}`, {
            action: 'Undo',
            onAction: () => store.deleteUpdate(u.id),
          });
        }
      });

      b.querySelector('[data-delete]')?.addEventListener('click', () => {
        sheet.close();
        const removed = store.deleteUpdate(existing.id);
        toast('Update deleted', { action: 'Undo', onAction: () => store.restoreUpdate(removed) });
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
          <button type="button" class="btn btn-block" data-archive>${existing.archived ? 'Unarchive project' : 'Archive project'}</button>
          <p class="muted small">${existing.archived ? 'It will show on the Projects tab again.' : 'Hides it from the Projects tab; its history is kept.'}</p>
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
          store.updateProject(id, { name, color });
          toast('Project saved');
        } else {
          const p = store.addProject({ name, color });
          toast(`Created “${p.name}”`);
          onSaved?.(p);
        }
      });
      b.querySelector('[data-archive]')?.addEventListener('click', () => {
        sheet.close();
        const archived = !existing.archived;
        store.updateProject(id, { archived });
        toast(archived ? `Archived “${existing.name}”` : `“${existing.name}” is back`, {
          action: 'Undo',
          onAction: () => store.updateProject(id, { archived: !archived }),
        });
      });
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
          <div class="spark" aria-label="Updates per week, last 12 weeks">
            ${spark.map((s) => `<i style="--h:${(s.c / sparkMax) * 100}%" title="Week of ${s.w}: ${s.c}"></i>`).join('')}
          </div>
          <div class="spark-axis"><span>12 weeks ago</span><span>this week</span></div>
          ${arrangeControls(p)}
          <div class="btn-row">
            <button class="btn" data-action="edit-project" data-id="${id}">Edit project</button>
            <span class="spacer"></span>
            <button class="btn btn-primary" data-action="add-update" data-project="${id}">Log update</button>
          </div>
          <h3 class="section-h">History</h3>
          ${info.days.length ? `<ol class="hist">${info.days.map((d, i) => {
            const gap = i < info.days.length - 1 ? diffDays(d.date, info.days[i + 1].date) : 0;
            return `
              <li>
                <div class="hist-date"><b>${cardLabel(d.date, today)}</b>${gap > 1 ? `<span>${gap} days after previous</span>` : ''}</div>
                <ul class="day-items">${d.items.map((u) => `<li><button data-action="edit-update" data-id="${u.id}">${esc(u.text)}</button></li>`).join('')}</ul>
              </li>`;
          }).join('')}</ol>` : '<p class="muted">No updates yet. Tap “Log update” to add the first one.</p>'}
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

/** Reorder + archive controls for the project sheet. */
function arrangeControls(p) {
  const { index, total } = store.projectPosition(p.id);
  const shown = index >= 0;
  const moves = MOVES.map(([where, label, path]) => {
    const disabled = where === 'top' || where === 'up' ? index === 0 : index === total - 1;
    return `<button class="move-btn" data-action="move-project" data-id="${p.id}" data-where="${where}" aria-label="${label}" title="${label}" ${disabled ? 'disabled' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg></button>`;
  }).join('');
  const note = !shown
    ? 'Archived — hidden from the Projects tab.'
    : `${p.archived ? 'Archived · ' : ''}#${index + 1} of ${total} on the Projects tab${store.settings().sort === 'manual' ? '' : ' · moving it switches to custom order'}`;
  return `
    <div class="arrange">
      ${shown ? `<div class="move-group" role="group" aria-label="Position on the Projects tab">${moves}</div>` : ''}
      <button class="btn btn-small ${p.archived ? 'btn-primary' : ''}" data-action="archive-project" data-id="${p.id}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 4.5h17v4h-17zM5 8.5V19.5h14V8.5M10 12.5h4"/></svg>
        ${p.archived ? 'Unarchive' : 'Archive'}
      </button>
    </div>
    <p class="muted small arrange-note">${note}</p>`;
}

// ------------------------------------------------------------------ one project on one day

export function projectDaySheet(projectId, date) {
  openSheet({
    live: true,
    title: () => store.getProject(projectId)?.name ?? '',
    body: () => {
      const p = store.getProject(projectId);
      const items = (store.index().byDate.get(date) ?? []).filter((u) => u.projectId === projectId);
      if (!p || !items.length) return null;
      return `
        <p class="sheet-sub">${fullDate(date)}</p>
        <ul class="day-items day-items-lg" style="--c:${esc(p.color)}">
          ${items.map((u) => `<li><button data-action="edit-update" data-id="${u.id}">${esc(u.text)}</button></li>`).join('')}
        </ul>
        <p class="muted small">Tap an update to edit it.</p>
        <div class="btn-row">
          <button class="btn" data-action="open-project" data-id="${p.id}">Full history</button>
          <span class="spacer"></span>
          <button class="btn btn-primary" data-action="add-update" data-project="${p.id}" data-date="${date}">Add another</button>
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
        <p class="sheet-sub">${title === sub ? '' : `${esc(sub)} · `}${items.length ? plural(items.length, 'update') : 'Nothing logged'}</p>
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
      const projects = store.orderedProjects({ sort: 'name', includeArchived: true });
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
              <span class="muted small">${p.archived ? 'archived · ' : ''}${byProject.get(p.id)?.count ?? 0}</span>
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
          <p class="muted small">“${esc(profile.name)}”: ${plural(st.projects.length, 'project')} · ${plural(st.updates.length, 'update')}. All profiles: ${kb} KB.</p>
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
  openSheet({
    live: true,
    title: 'Profiles',
    body: () => {
      const active = store.activeProfile().id;
      return `
        <p class="sheet-sub">Each profile has its own projects and history, for example one per job.</p>
        <ul class="profiles">
          ${store.profiles().map((p) => {
            const n = store.profileStats(p.id);
            return `
              <li class="${p.id === active ? 'is-on' : ''}" style="--c:${esc(p.color)}">
                <button class="prof-main" data-switch="${p.id}" ${p.id === active ? 'aria-current="true"' : ''}>
                  <span class="prof-dot"></span>
                  <span class="grow"><b>${esc(p.name)}</b><span class="muted small">${plural(n.projects, 'project')} · ${plural(n.updates, 'update')}</span></span>
                  ${p.id === active ? '<svg viewBox="0 0 24 24" aria-hidden="true" class="check"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : ''}
                </button>
                <button class="icon-btn" data-edit-profile="${p.id}" aria-label="Edit ${esc(p.name)}">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4"/></svg>
                </button>
              </li>`;
          }).join('')}
        </ul>
        <button class="btn btn-block" data-new-profile>+ New profile</button>`;
    },
    mount: (b, sheet) => {
      b.querySelectorAll('[data-switch]').forEach((btn) => btn.addEventListener('click', () => {
        sheet.close();
        if (btn.dataset.switch === store.activeProfile().id) return;
        store.switchProfile(btn.dataset.switch);
        toast(`Switched to “${store.activeProfile().name}”`);
      }));
      b.querySelectorAll('[data-edit-profile]').forEach((btn) =>
        btn.addEventListener('click', () => profileForm({ id: btn.dataset.editProfile })));
      b.querySelector('[data-new-profile]').addEventListener('click', () => profileForm({
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
          message: `“${existing.name}” and its ${plural(n.projects, 'project')} and ${plural(n.updates, 'update')} will be deleted${store.syncConfig() ? ' on every synced device' : ''}.`,
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
