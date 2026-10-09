// Markup shared between views and sheets.

import * as store from './store.js';
import { dayHeading, todayKey } from './dates.js';
import { esc, plural } from './ui.js';

/** Escapes text and wraps case-insensitive matches of `query` in <mark>. */
export function highlight(text, query) {
  const safe = esc(text);
  if (!query) return safe;
  const q = esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(q, 'gi'), (m) => `<mark>${m}</mark>`);
}

/** Groups a day's updates by project; busiest project first. */
export function groupByProject(updates) {
  const groups = new Map();
  for (const u of updates) {
    const p = store.getProject(u.projectId);
    if (!p) continue;
    if (!groups.has(p.id)) groups.set(p.id, { project: p, items: [] });
    groups.get(p.id).items.push(u);
  }
  return [...groups.values()].sort((a, b) =>
    b.items.length - a.items.length || a.project.name.localeCompare(b.project.name));
}

/** One day: heading, then each project with its updates. */
export function dayBlock(date, updates, { query = '', heading = true, today = todayKey() } = {}) {
  const groups = groupByProject(updates);
  const { title, sub } = dayHeading(date, today);
  const summary = updates.length
    ? `${plural(updates.length, 'update')} · ${plural(groups.length, 'project')}`
    : 'Nothing logged yet';
  return `
    <section class="day" data-date="${date}">
      ${heading ? `
      <header class="day-h">
        <div>
          <h3>${esc(title)}</h3>
          <span class="day-sub">${title === sub ? '' : `${esc(sub)} · `}${summary}</span>
        </div>
        <button class="icon-btn icon-btn-soft" data-action="add-update" data-date="${date}" aria-label="Log update for ${esc(sub)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>
        </button>
      </header>` : ''}
      ${groups.map((g) => `
        <div class="day-proj" style="--c:${esc(g.project.color)}">
          <button class="day-pname" data-action="open-project" data-id="${g.project.id}">${highlight(g.project.name, query)}</button>
          <ul class="day-items">
            ${g.items.map((u) => `<li><button data-action="edit-update" data-id="${u.id}">${highlight(u.text, query)}</button></li>`).join('')}
          </ul>
        </div>`).join('')}
    </section>`;
}

/** Colour swatches for picking a project colour. */
export function swatches(selected) {
  return `<div class="swatches" role="radiogroup" aria-label="Colour">
    ${store.PALETTE.map((c) => `<button type="button" class="swatch ${c === selected ? 'is-on' : ''}" style="--c:${c}" data-color="${c}" role="radio" aria-checked="${c === selected}" aria-label="Colour ${c}"></button>`).join('')}
  </div>`;
}

/** Heat level 0–4, scaled to the busiest cell in view (but never coarser than 1 step per update up to 4). */
export const heat = (count, max) => (count ? Math.min(4, Math.ceil((4 * count) / Math.max(4, max))) : 0);
