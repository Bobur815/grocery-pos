// Tashkent (UTC+5) calendar-day helpers.
//
// `<input type="date">` yields a bare "YYYY-MM-DD", and `new Date("2026-08-24")` parses that as
// UTC midnight. Sending it as a period END therefore cuts the day off before it starts: anything
// that happened during the local working day — a stocktake completed at 14:00, every sale after
// 05:00 — falls after the boundary and silently vanishes from the report.
//
// Extracted from Reports/Analytics.tsx, which needed exactly this and had it inline.

const UZT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Current year/month/day in Tashkent time. */
export function uztToday(): { y: number; m: number; d: number } {
  const t = new Date(Date.now() + UZT_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}

/** 00:00:00.000 of a Tashkent calendar day expressed as a UTC Date. */
export function uztDayStart(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - UZT_OFFSET_MS);
}

/** 23:59:59.999 of a Tashkent calendar day expressed as a UTC Date. */
export function uztDayEnd(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - UZT_OFFSET_MS);
}

/** Parse a YYYY-MM-DD string (from `<input type="date">`) as a Tashkent date. */
export function parseUztDate(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d };
}

/** "YYYY-MM-DD" → the instant that local day begins, as UTC. */
export function uztStartOf(dateStr: string): Date {
  const { y, m, d } = parseUztDate(dateStr);
  return uztDayStart(y, m, d);
}

/**
 * "YYYY-MM-DD" → the instant that local day ENDS, as UTC.
 *
 * Use for any inclusive period end, so "to = today" means "through the end of today" rather
 * than "up to midnight this morning".
 */
export function uztEndOf(dateStr: string): Date {
  const { y, m, d } = parseUztDate(dateStr);
  return uztDayEnd(y, m, d);
}

/** Today in Tashkent as "YYYY-MM-DD", suitable for `<input type="date">`. */
export function uztTodayString(): string {
  const { y, m, d } = uztToday();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** N days before today in Tashkent as "YYYY-MM-DD". */
export function uztDaysAgoString(days: number): string {
  const { y, m, d } = uztToday();
  const t = new Date(Date.UTC(y, m, d - days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
    t.getUTCDate(),
  ).padStart(2, "0")}`;
}
