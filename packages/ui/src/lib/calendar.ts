/**
 * Calendar arithmetic for every month grid in the product, in UTC.
 *
 * WHY THIS FILE EXISTS AT ALL. Two surfaces need the same month, the same week
 * start, the same weekend and the same "today": the date FIELD's picker popover
 * and the compliance agenda's month VIEW. They are different components, but if
 * one of them decided Monday was the first column and the other decided Sunday
 * was, the product would contradict itself on the same screen. So the day
 * arithmetic, the week start and the weekend live here once, and the two
 * components only decide how a cell looks.
 *
 * WHY UTC, NOT LOCAL TIME. The app persists a calendar date as a
 * FLOATING UTC MIDNIGHT: `2026-07-24` is stored as `2026-07-24T00:00:00Z` and
 * means that calendar day in the app time zone, not an instant (see
 * `apps/api/src/common/clock/app-calendar.ts` and
 * `apps/web/src/lib/i18n/format.ts`).
 * `new Date(y, m, d)` builds a LOCAL midnight, so for anyone west of UTC every
 * cell in the grid would sit one day off and a contract would appear to end a
 * day early. Every function here goes through `Date.UTC`, and every date it
 * returns is a floating UTC midnight.
 *
 * WHY NOT `date-fns`, WHICH IS ALREADY A DEPENDENCY. Because its arithmetic is
 * local-time by design: `startOfMonth`, `addMonths` and `getDay` all read the
 * host zone, so using them here would reintroduce exactly the off-by-a-day this
 * file exists to prevent. Doing it correctly with date-fns needs `@date-fns/tz`,
 * which is a NEW dependency, and it would pull date-fns into a bundle that does
 * not currently contain a byte of it. The arithmetic below is about sixty lines
 * of `Date.UTC`, so the dependency buys nothing and costs bytes.
 *
 * WEEK START. Monday. ISO 8601 starts the week on Monday and the design
 * reference is Monday-first. It is a named constant rather than a parameter so
 * the two grids cannot drift apart; make it a per-locale parameter on the day a
 * product needs a Sunday-first grid.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Days in a rendered week row. */
export const DAYS_PER_WEEK = 7;

/**
 * Rows in a month grid. Six, always, so the grid does not change height as the
 * user steps through months: a grid that reflows between five and six rows
 * moves the content under the pointer mid-click.
 */
export const WEEKS_PER_MONTH_GRID = 6;

/**
 * `getUTCDay()` values that are Saturday and Sunday.
 *
 * Exported because the weekend is a PRESENTATION decision both grids share (a
 * tint in the design), not a business rule: nothing in the domain treats
 * a Saturday expiry differently from a Tuesday one.
 */
const SATURDAY = 6;
const SUNDAY = 0;

/** The UTC-midnight `Date` of the calendar day `value` falls on. */
export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/** Today as a floating UTC midnight. Read it ONCE per mount, never in render. */
export function todayUtc(): Date {
  return startOfUtcDay(new Date());
}

/** The first day of the UTC month `value` falls in. */
export function startOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

/** The last day of the UTC month `value` falls in. */
export function endOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0));
}

/** `value` moved by whole days, staying on a UTC midnight. */
export function addUtcDays(value: Date, days: number): Date {
  return new Date(startOfUtcDay(value).getTime() + days * MS_PER_DAY);
}

/**
 * `value` moved by whole months, clamped to the end of the target month so
 * 31 January plus one month is 28 (or 29) February rather than 3 March.
 */
export function addUtcMonths(value: Date, months: number): Date {
  const year = value.getUTCFullYear();
  const monthIndex = value.getUTCMonth() + months;
  const day = value.getUTCDate();
  const daysInTarget = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(day, daysInTarget)));
}

/** True when both dates fall on the same UTC calendar day. */
export function isSameUtcDay(a: Date, b: Date): boolean {
  return startOfUtcDay(a).getTime() === startOfUtcDay(b).getTime();
}

/** True when both dates fall in the same UTC calendar month. */
export function isSameUtcMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

/** True for Saturday and Sunday, read in UTC. */
export function isWeekend(value: Date): boolean {
  const day = value.getUTCDay();
  return day === SATURDAY || day === SUNDAY;
}

/**
 * Column index of a date in a Monday-first week: Monday 0 ... Sunday 6.
 *
 * `getUTCDay()` is Sunday 0 ... Saturday 6, so this is the one place the two
 * conventions are reconciled.
 */
export function mondayFirstIndex(value: Date): number {
  return (value.getUTCDay() + 6) % DAYS_PER_WEEK;
}

/** Whole calendar days from `from` to `to`; negative once `to` has passed. */
export function daysBetweenUtc(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / MS_PER_DAY);
}

/**
 * The 42 days a month grid draws: the Monday on or before the 1st, then six
 * weeks of seven days. Leading and trailing days belong to the neighboring
 * months and are the ones a grid greys out.
 */
export function monthGridDays(month: Date): readonly Date[] {
  const first = startOfUtcMonth(month);
  const start = addUtcDays(first, -mondayFirstIndex(first));
  const days: Date[] = [];
  for (let index = 0; index < WEEKS_PER_MONTH_GRID * DAYS_PER_WEEK; index += 1) {
    days.push(addUtcDays(start, index));
  }
  return days;
}

/** The same 42 days, already chunked into the six rows a grid renders. */
export function monthGridWeeks(month: Date): readonly (readonly Date[])[] {
  const days = monthGridDays(month);
  const weeks: Date[][] = [];
  for (let index = 0; index < days.length; index += DAYS_PER_WEEK) {
    weeks.push(days.slice(index, index + DAYS_PER_WEEK) as Date[]);
  }
  return weeks;
}

/**
 * Monday-first weekday names for a locale, read in UTC.
 *
 * From `Intl`, never a hand-written array: every locale's weekday names are
 * already in the platform, and a hand-written list is a translation nobody
 * reviews. The
 * reference dates are a known Monday-to-Sunday run in 2024.
 */
export function weekdayNames(
  locale: string,
): readonly { readonly short: string; readonly long: string }[] {
  const shortFormat = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const longFormat = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
  // 2024-01-01 was a Monday.
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) => {
    const day = new Date(Date.UTC(2024, 0, 1 + index));
    return { short: shortFormat.format(day), long: longFormat.format(day) };
  });
}

/**
 * `yyyy-MM-dd` for a floating-midnight date: the wire shape the whole app
 * already speaks, and the shape the replaced native control held.
 */
export function toIsoDate(value: Date): string {
  const year = String(value.getUTCFullYear()).padStart(4, '0');
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The inverse: a `yyyy-MM-dd` string as a floating-midnight `Date`, or `null`.
 *
 * Rejects a well-formed string that names a day that does not exist
 * (`2026-02-31`), which `new Date()` would silently roll into March.
 */
export function fromIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return makeUtcDate(year, month, day);
}

/**
 * A calendar date from its parts, or `null` when the parts do not name a real
 * day. The round-trip check is what catches 31 February: `Date.UTC` rolls it
 * forward rather than failing.
 */
export function makeUtcDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** One of the three groups a typed date is made of. */
export type DatePart = 'day' | 'month' | 'year';

/** How a locale writes a numeric date, which is how the date field is typed. */
export interface IDateEntryPattern {
  /** The three groups in written order: `['month', 'day', 'year']` for `en-US`. */
  readonly order: readonly [DatePart, DatePart, DatePart];
  /** The separator between groups: `/` for `en-US`, `.` for `de-DE`. */
  readonly separator: string;
  /** The pattern spelled out for a placeholder: `mm/dd/yyyy` for `en-US`. */
  readonly placeholder: string;
}

const PART_PLACEHOLDER: Record<DatePart, string> = { day: 'dd', month: 'mm', year: 'yyyy' };

/** Used when a locale's parts cannot be read (an exotic calendar, say). */
const FALLBACK_PATTERN: IDateEntryPattern = {
  order: ['year', 'month', 'day'],
  separator: '-',
  placeholder: 'yyyy-mm-dd',
};

const patternCache = new Map<string, IDateEntryPattern>();

/**
 * The order and separator a locale writes a numeric date in, read from `Intl`
 * rather than a hand-kept table: `en-US` is `mm/dd/yyyy`, `en-GB` `dd/mm/yyyy`,
 * `de-DE` `dd.mm.yyyy`, `sv-SE` `yyyy-mm-dd`.
 *
 * A locale whose numeric date does not come back as exactly day, month and
 * year with one separator between them falls back to ISO `yyyy-mm-dd`, which
 * nobody misreads.
 */
export function dateEntryPattern(locale: string): IDateEntryPattern {
  const cached = patternCache.get(locale);
  if (cached !== undefined) return cached;

  const parts = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(new Date(Date.UTC(2024, 0, 1)));

  const order = parts
    .map((part) => part.type)
    .filter((type): type is DatePart => type === 'day' || type === 'month' || type === 'year');
  const literal = parts.find((part) => part.type === 'literal')?.value.trim() ?? '';
  const isComplete = order.length === 3 && new Set(order).size === 3 && literal.length === 1;

  const pattern: IDateEntryPattern = isComplete
    ? {
        order: order as [DatePart, DatePart, DatePart],
        separator: literal,
        placeholder: order.map((part) => PART_PLACEHOLDER[part]).join(literal),
      }
    : FALLBACK_PATTERN;
  patternCache.set(locale, pattern);
  return pattern;
}
