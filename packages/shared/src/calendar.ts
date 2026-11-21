/**
 * Bulgarian working days, for the contract's "5 работни дни" (art. 8(3), art. 11(3)).
 * Weekends and the official holidays (Labour Code art. 154) are skipped; a fixed holiday on a
 * Saturday or Sunday moves the day off to the next working day. One-off government decrees that
 * move working days are not known in advance and are not included.
 * Dates are ISO strings (YYYY-MM-DD), computed in UTC so the time zone never shifts them.
 */

const FIXED = ['01-01', '03-03', '05-01', '05-06', '05-24', '09-06', '09-22', '12-24', '12-25', '12-26'];

const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function addMonths(iso: string, months: number): string {
  const d = toDate(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return isoDate(d);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

const isWeekend = (iso: string) => {
  const w = toDate(iso).getUTCDay();
  return w === 0 || w === 6;
};

/** Orthodox Easter Sunday (Gregorian date): Meeus's Julian algorithm plus 13 days (valid 1900-2099). */
export function orthodoxEaster(year: number): string {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return addDays(julian, 13);
}

const cache = new Map<number, Set<string>>();

/** All non-working holidays of a year (not counting ordinary weekends). */
export function bgHolidays(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const set = new Set<string>();
  const easter = orthodoxEaster(year);
  for (const off of [-2, -1, 0, 1]) set.add(addDays(easter, off));
  const fixed = FIXED.map((md) => `${year}-${md}`);
  for (const day of fixed) set.add(day);
  for (const day of fixed) {
    if (!isWeekend(day)) continue;
    let next = addDays(day, 1);
    while (isWeekend(next) || set.has(next)) next = addDays(next, 1);
    set.add(next);
  }
  cache.set(year, set);
  return set;
}

export function isWorkingDay(iso: string): boolean {
  return !isWeekend(iso) && !bgHolidays(Number(iso.slice(0, 4))).has(iso.slice(0, 10));
}

/** The date `n` working days after `iso` (the day itself does not count). */
export function addWorkingDays(iso: string, n: number): string {
  let d = iso.slice(0, 10);
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (isWorkingDay(d)) left--;
  }
  return d;
}

/** Today in Sofia as YYYY-MM-DD. */
export function sofiaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
