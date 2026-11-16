// Calendar math on plain YYYY-MM-DD strings. Everything is UTC so a date never
// shifts with the server's time zone.

export type ISODate = string;

const DAY_MS = 86_400_000;

export function dayNumber(date: ISODate): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

export function fromDayNumber(n: number): ISODate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(dayNumber(date) + days);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return dayNumber(to) - dayNumber(from);
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addMonths(date: ISODate, months: number, dayOfMonth?: number): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const monthIndex = total % 12;
  const day = Math.min(dayOfMonth ?? d, daysInMonth(year, monthIndex));
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

export function dayOfMonth(date: ISODate): number {
  return Number(date.slice(8, 10));
}

export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

// Weeks of the month: days 1 to 7, 8 to 14, 15 to 21, and 22 to the end.
export function weekOfMonth(date: ISODate): 0 | 1 | 2 | 3 {
  return Math.min(3, Math.floor((dayOfMonth(date) - 1) / 7)) as 0 | 1 | 2 | 3;
}

export function weekOfMonthLength(date: ISODate): number {
  const week = weekOfMonth(date);
  if (week < 3) return 7;
  const [y, m] = date.split("-").map(Number);
  return daysInMonth(y, m - 1) - 21;
}

export function toISODate(at: Date): ISODate {
  return at.toISOString().slice(0, 10);
}

// Monday of the week containing `date`.
export function weekStart(date: ISODate): ISODate {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}
