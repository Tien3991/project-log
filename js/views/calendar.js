// Calendar view: how much was logged per day/week/month, overall or for one project.
// "How much" = number of updates.

import * as store from '../store.js';
import { todayKey, fromKey, addDays, diffDays, startOfWeek, daysInMonth, monthYear, monthShort, weekdayShort } from '../dates.js';
import { heat } from '../components.js';
import { esc, plural } from '../ui.js';

let mode = 'month';            // month | year
let filter = 'all';            // 'all' or a project id
let cur = thisMonth();

export const title = 'Calendar';

function thisMonth() {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() };
}

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** date → number of updates that day (for the active filter). */
function counter() {
  const { byDate } = store.index();
  return (date) => {
    const list = byDate.get(date);
    if (!list) return 0;
    return filter === 'all' ? list.length : list.filter((u) => u.projectId === filter).length;
  };
}

/** Per-project counts in [from, to], bucketed: Map<projectId, number[]>. */
function perProject(from, to, nBuckets, bucketOf) {
  const out = new Map();
  for (const u of store.getState().updates) {
    if (u.date < from || u.date > to) continue;
    if (!out.has(u.projectId)) out.set(u.projectId, new Array(nBuckets).fill(0));
    out.get(u.projectId)[bucketOf(u.date)]++;
  }
  return out;
}

export function render() {
  const projects = store.orderedProjects({ statuses: 'all' });
  if (!projects.length) {
    return `<div class="empty"><h2>Nothing to show yet</h2><p>Once you log updates, this shows how much you got done each week and month.</p></div>`;
  }
  if (filter !== 'all' && !store.getProject(filter)) filter = 'all';
  const fp = filter === 'all' ? null : store.getProject(filter);

  return `
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Range">
        <button class="${mode === 'month' ? 'is-on' : ''}" data-action="cal-mode" data-mode="month" aria-pressed="${mode === 'month'}">Month</button>
        <button class="${mode === 'year' ? 'is-on' : ''}" data-action="cal-mode" data-mode="year" aria-pressed="${mode === 'year'}">Year</button>
      </div>
      <span class="spacer"></span>
      <label class="select" style="--c:${fp ? esc(fp.color) : 'var(--accent)'}">
        <span class="dot"></span>
        <select data-input="cal-filter" aria-label="Project">
          <option value="all">All projects</option>
          ${projectOptions(projects)}
        </select>
      </label>
    </div>
    <div class="cal" style="--hc:${fp ? esc(fp.color) : 'var(--accent)'}">
      ${mode === 'month' ? monthView() : yearView()}
    </div>`;
}

/** Project choices, grouped by status when there is more than one kind. */
function projectOptions(projects) {
  const option = (p) => `<option value="${p.id}" ${p.id === filter ? 'selected' : ''}>${esc(p.name)}</option>`;
  const groups = store.STATUSES.map((st) => [st, projects.filter((p) => p.status === st)]).filter(([, list]) => list.length);
  if (groups.length < 2) return projects.map(option).join('');
  return groups.map(([st, list]) => `<optgroup label="${st[0].toUpperCase()}${st.slice(1)}">${list.map(option).join('')}</optgroup>`).join('');
}

export function mount(root, rerender) {
  root.querySelector('[data-input="cal-filter"]')?.addEventListener('change', (e) => {
    filter = e.target.value;
    rerender();
  });
  // The year table is wider than a phone; start scrolled to the recent months and totals.
  const wrap = root.querySelector('.mx-wrap');
  if (wrap && mode === 'year') wrap.scrollLeft = wrap.scrollWidth;
}

export const actions = {
  'cal-prev': () => {
    if (mode === 'year') cur.y--;
    else if (--cur.m < 0) Object.assign(cur, { m: 11, y: cur.y - 1 });
  },
  'cal-next': () => {
    if (mode === 'year') cur.y++;
    else if (++cur.m > 11) Object.assign(cur, { m: 0, y: cur.y + 1 });
  },
  'cal-today': () => { cur = thisMonth(); },
  'cal-mode': (el) => { mode = el.dataset.mode; },
  'cal-filter': (el) => { filter = filter === el.dataset.id ? 'all' : el.dataset.id; },
  'cal-goto-month': (el) => {
    cur.m = Number(el.dataset.month);
    if (el.dataset.year) cur.y = Number(el.dataset.year);
    mode = 'month';
  },
};

function nav(label) {
  return `
    <div class="cal-nav">
      <button class="icon-btn" data-action="cal-prev" aria-label="Previous">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <button class="cal-title" data-action="cal-today" title="Jump to today">${label}</button>
      <button class="icon-btn" data-action="cal-next" aria-label="Next">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
      </button>
    </div>`;
}

function stats(total, activeDays, projectCount) {
  return `
    <div class="stats">
      <div><b>${total}</b><span>${total === 1 ? 'update' : 'updates'}</span></div>
      <div><b>${activeDays}</b><span>active ${activeDays === 1 ? 'day' : 'days'}</span></div>
      ${filter === 'all' ? `<div><b>${projectCount}</b><span>${projectCount === 1 ? 'project' : 'projects'}</span></div>` : ''}
    </div>`;
}

// ------------------------------------------------------------------ month

function monthView() {
  const { y, m } = cur;
  const ws = store.settings().weekStart;
  const today = todayKey();
  const first = dayKey(y, m, 1);
  const last = dayKey(y, m, daysInMonth(y, m));
  const count = counter();

  const weeks = [];
  for (let w = startOfWeek(first, ws); w <= last; w = addDays(w, 7)) weeks.push(w);
  const rows = weeks.map((w) => Array.from({ length: 7 }, (_, i) => {
    const d = addDays(w, i);
    return { d, c: count(d), inMonth: d >= first && d <= last };
  }));

  let max = 0, total = 0, active = 0;
  for (const x of rows.flat()) {
    max = Math.max(max, x.c);
    if (x.inMonth) { total += x.c; if (x.c) active++; }
  }

  const from = weeks[0];
  const to = addDays(weeks[weeks.length - 1], 6);
  const byP = perProject(from, to, weeks.length, (d) => Math.floor(diffDays(d, from) / 7));
  const monthTotals = perProject(first, last, 1, () => 0);
  const projectCount = monthTotals.size;

  const wdays = rows[0].map((x) => `<div class="cal-wd">${weekdayShort(x.d).slice(0, 2)}</div>`).join('');
  const grid = rows.map((row) => {
    const wt = row.reduce((s, x) => s + x.c, 0);
    return row.map((x) => `
      <button class="cal-day h${heat(x.c, max)} ${x.inMonth ? '' : 'is-out'} ${x.d === today ? 'is-today' : ''} ${x.d > today ? 'is-future' : ''}"
        data-action="open-day" data-date="${x.d}" aria-label="${x.d}: ${plural(x.c, 'update')}">
        <span class="n">${fromKey(x.d).getDate()}</span>${x.c ? `<span class="c">${x.c}</span>` : ''}
      </button>`).join('') + `<div class="cal-wt ${wt ? '' : 'is-zero'}">${wt || '·'}</div>`;
  }).join('');

  return `
    ${nav(monthYear(y, m))}
    ${stats(total, active, projectCount)}
    <div class="cal-grid">
      ${wdays}<div class="cal-wd cal-wt-h">Week</div>
      ${grid}
    </div>
    ${matrix({
      heading: 'By project, per week',
      cols: weeks.map((w) => {
        const a = fromKey(w), b = fromKey(addDays(w, 6));
        return { label: `${a.getDate()}–${b.getDate()}`, title: `${w} to ${addDays(w, 6)}` };
      }),
      data: byP,
      totals: monthTotals,
      totalLabel: monthShort(m),
      quietLabel: 'this month',
      future: first > today,
    })}`;
}

// ------------------------------------------------------------------ year

function yearView() {
  const { y } = cur;
  const ws = store.settings().weekStart;
  const today = todayKey();
  const count = counter();
  const first = `${y}-01-01`;
  const last = `${y}-12-31`;

  // Daily counts for the year.
  const months = [];
  let max = 0, total = 0, active = 0;
  for (let m = 0; m < 12; m++) {
    const days = [];
    let mt = 0;
    for (let d = 1; d <= daysInMonth(y, m); d++) {
      const k = dayKey(y, m, d);
      const c = count(k);
      days.push({ k, c });
      mt += c;
      max = Math.max(max, c);
      if (c) active++;
    }
    total += mt;
    const lead = (fromKey(dayKey(y, m, 1)).getDay() - ws + 7) % 7;
    months.push({ m, days, total: mt, lead });
  }

  // Weekly totals (weeks that start in this year, plus the one containing Jan 1).
  const weeks = [];
  for (let w = startOfWeek(first, ws); w <= last; w = addDays(w, 7)) {
    let c = 0;
    for (let i = 0; i < 7; i++) c += count(addDays(w, i));
    weeks.push({ w, c });
  }
  const maxWeek = Math.max(1, ...weeks.map((x) => x.c));
  const thisWeek = startOfWeek(today, ws);

  const byP = perProject(first, last, 12, (d) => Number(d.slice(5, 7)) - 1);
  const yearTotals = perProject(first, last, 1, () => 0);

  const minis = months.map(({ m, days, total: mt, lead }) => `
    <button class="mini ${dayKey(y, m, 1) > today ? 'is-future' : ''}" data-action="cal-goto-month" data-month="${m}" data-year="${y}">
      <span class="mini-h">${monthShort(m)}<b>${mt || ''}</b></span>
      <span class="mini-grid">${'<i class="blank"></i>'.repeat(lead)}${days.map(({ k, c }) => `<i class="h${heat(c, max)}${k === today ? ' t' : ''}"></i>`).join('')}</span>
    </button>`).join('');

  const bars = weeks.map(({ w, c }) => {
    const mm = fromKey(w).getMonth();
    const yy = fromKey(w).getFullYear();
    return `<button class="bar ${w === thisWeek ? 'is-now' : ''}" style="--h:${(c / maxWeek) * 100}%" data-action="cal-goto-month" data-month="${yy < y ? 0 : mm}" data-year="${y}" aria-label="Week of ${w}: ${plural(c, 'update')}" title="${w}: ${c}"></button>`;
  }).join('');

  return `
    ${nav(String(y))}
    ${stats(total, active, yearTotals.size)}
    <div class="minis">${minis}</div>
    <h3 class="section-h">Updates per week</h3>
    <div class="bars" style="--n:${weeks.length}">${bars}</div>
    <div class="bars-axis"><span>Jan</span><span>Apr</span><span>Jul</span><span>Oct</span><span>Dec</span></div>
    ${matrix({
      heading: 'By project, per month',
      cols: Array.from({ length: 12 }, (_, m) => ({ label: monthShort(m).slice(0, 3), title: monthYear(y, m) })),
      data: byP,
      totals: yearTotals,
      totalLabel: String(y),
      quietLabel: `in ${y}`,
      future: first > today,
    })}`;
}

// ------------------------------------------------------------------ project × period table

function matrix({ heading, cols, data, totals, totalLabel, quietLabel, future }) {
  const rows = [...data.entries()]
    .map(([id, counts]) => ({ p: store.getProject(id), counts, total: totals.get(id)?.[0] ?? 0 }))
    .filter((r) => r.p)
    .sort((a, b) => b.total - a.total || b.counts.reduce((s, n) => s + n, 0) - a.counts.reduce((s, n) => s + n, 0));

  const quiet = store.orderedProjects().filter((p) => !totals.has(p.id));
  if (!rows.length) {
    return `<h3 class="section-h">${heading}</h3><p class="muted pad-x">${future ? 'This is in the future.' : `No updates ${quietLabel}.`}</p>`;
  }

  const max = Math.max(...rows.flatMap((r) => r.counts));
  const colTotals = cols.map((_, i) => rows.reduce((s, r) => s + r.counts[i], 0));
  const grand = rows.reduce((s, r) => s + r.total, 0);

  return `
    <h3 class="section-h">${heading}</h3>
    <div class="mx-wrap">
      <table class="mx">
        <thead><tr>
          <th class="mx-name" scope="col">Project</th>
          ${cols.map((c) => `<th scope="col" title="${esc(c.title)}">${esc(c.label)}</th>`).join('')}
          <th class="mx-tot" scope="col">${esc(totalLabel)}</th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr style="--c:${esc(r.p.color)}" class="${filter === r.p.id ? 'is-sel' : ''}">
              <th class="mx-name" scope="row"><button data-action="cal-filter" data-id="${r.p.id}" title="${esc(r.p.name)}"><span>${esc(r.p.name)}</span></button></th>
              ${r.counts.map((n) => `<td class="h${heat(n, max)}">${n || ''}</td>`).join('')}
              <td class="mx-tot">${r.total}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <th class="mx-name" scope="row">All</th>
          ${colTotals.map((n) => `<td>${n || ''}</td>`).join('')}
          <td class="mx-tot">${grand}</td>
        </tr></tfoot>
      </table>
    </div>
    ${quiet.length && !future ? `<p class="muted small pad-x">No updates ${quietLabel}: ${quiet.map((p) => esc(p.name)).join(', ')}</p>` : ''}
    <p class="muted small pad-x">Tap a project to show only its activity above.</p>`;
}
