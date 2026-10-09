// Daily view: newest day first, each day listing what was done per project.

import * as store from '../store.js';
import { todayKey } from '../dates.js';
import { dayBlock } from '../components.js';
import { esc, plural } from '../ui.js';

const PAGE = 30;
let query = '';
let limit = PAGE;

export const title = 'Daily';

export function render() {
  if (!store.getState().projects.length) {
    return `<div class="empty"><h2>No projects yet</h2><p>Add a project on the Projects tab, then log what you did each day.</p></div>`;
  }
  return `
    <div class="toolbar">
      <label class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>
        <input type="search" placeholder="Search updates" value="${esc(query)}" data-input="daily-search" enterkeyhint="search">
      </label>
    </div>
    <div id="daily-list">${list()}</div>`;
}

export function mount(root) {
  const input = root.querySelector('[data-input="daily-search"]');
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      query = input.value.trim();
      limit = PAGE;
      root.querySelector('#daily-list').innerHTML = list();
    }, 150);
  });
}

export const actions = {
  'daily-more': () => { limit += PAGE; },
};

function list() {
  const { byDate, dates } = store.index();
  const today = todayKey();
  const q = query.toLowerCase();

  if (q) {
    const matches = [];
    for (const date of dates) {
      const hits = byDate.get(date).filter((u) =>
        u.text.toLowerCase().includes(q) || store.getProject(u.projectId)?.name.toLowerCase().includes(q));
      if (hits.length) matches.push([date, hits]);
    }
    if (!matches.length) return `<p class="muted pad">No updates match “${esc(query)}”.</p>`;
    const total = matches.reduce((n, [, h]) => n + h.length, 0);
    return `<p class="muted pad-x">${plural(total, 'match', 'matches')} on ${plural(matches.length, 'day')}</p>` +
      page(matches, today);
  }

  const days = dates.map((d) => [d, byDate.get(d)]);
  if (!byDate.has(today)) days.unshift([today, []]);
  return page(days, today);
}

function page(days, today) {
  const shown = days.slice(0, limit);
  return shown.map(([date, ups]) => dayBlock(date, ups, { query, today })).join('') +
    (days.length > limit
      ? `<button class="btn btn-ghost btn-block" data-action="daily-more">Show older days (${days.length - limit} more)</button>`
      : '');
}
