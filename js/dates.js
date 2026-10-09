// Dates are stored as local calendar-day keys: "YYYY-MM-DD".
// All arithmetic goes through local Date objects at midnight, so DST shifts
// never move an update to a neighbouring day.

const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, '0');

export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayKey = () => toKey(new Date());

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

/** Whole days from b to a (a - b). */
export const diffDays = (a, b) => Math.round((fromKey(a) - fromKey(b)) / DAY_MS);

/** Key of the first day of the week containing `key`. weekStart: 0 = Sunday, 1 = Monday. */
export function startOfWeek(key, weekStart) {
  const d = fromKey(key);
  d.setDate(d.getDate() - ((d.getDay() - weekStart + 7) % 7));
  return toKey(d);
}

export const monthKey = (key) => key.slice(0, 7);
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
export const isValidKey = (key) => /^\d{4}-\d{2}-\d{2}$/.test(key) && toKey(fromKey(key)) === key;

const fmt = (opts) => new Intl.DateTimeFormat('en-GB', opts);
const fWeekday = fmt({ weekday: 'short' });
const fWeekdayLong = fmt({ weekday: 'long' });
const fDayMonth = fmt({ day: 'numeric', month: 'short' });
const fFull = fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fMonthYear = fmt({ month: 'long', year: 'numeric' });
const fMonthShort = fmt({ month: 'short' });

export const weekdayShort = (key) => fWeekday.format(fromKey(key));
export const monthYear = (y, m) => fMonthYear.format(new Date(y, m, 1));
export const monthShort = (m) => fMonthShort.format(new Date(2000, m, 1));
export const fullDate = (key) => fFull.format(fromKey(key));

/** Short label for a timeline card: Today, Yesterday, "Tue 6 Oct", or "6 Oct 2025". */
export function cardLabel(key, today = todayKey()) {
  const n = diffDays(today, key);
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  const d = fromKey(key);
  if (d.getFullYear() !== fromKey(today).getFullYear()) {
    return `${fDayMonth.format(d)} ${d.getFullYear()}`;
  }
  return `${fWeekday.format(d)} ${fDayMonth.format(d)}`;
}

/** Heading for a day section: Today / Yesterday / weekday name, plus the full date. */
export function dayHeading(key, today = todayKey()) {
  const n = diffDays(today, key);
  const title = n === 0 ? 'Today' : n === 1 ? 'Yesterday' : n > 0 && n < 7 ? fWeekdayLong.format(fromKey(key)) : fDayMonth.format(fromKey(key));
  return { title, sub: fFull.format(fromKey(key)) };
}

/** "today", "yesterday", "3d ago", "2w ago", "5mo ago", "1y ago". */
export function ago(key, today = todayKey()) {
  const n = diffDays(today, key);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 14) return `${n}d ago`;
  if (n < 60) return `${Math.floor(n / 7)}w ago`;
  if (n < 365) return `${Math.floor(n / 30)}mo ago`;
  return `${Math.floor(n / 365)}y ago`;
}

/** Compact gap between two update days for the timeline: "3d", "2w", "4mo". */
export function gapLabel(n) {
  if (n < 14) return `${n}d`;
  if (n < 60) return `${Math.round(n / 7)}w`;
  return `${Math.round(n / 30)}mo`;
}
