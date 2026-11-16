import { APP_LOCALE } from '@repo/shared/constants';
import { formatMoney } from '@repo/shared/money';
import type { Money } from '@repo/shared/money';

/**
 * Presentation formatters for the app locale (`APP_LOCALE` in
 * `@repo/shared/constants`, `en-US` by default).
 *
 * Intl formatter construction is the expensive part, so the stateless ones are
 * built once at module scope and reused.
 */

export { APP_LOCALE };

/** The locale's numeric date, `MM/dd/yyyy` for `en-US`. */
const dateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * The numeric date for CALENDAR dates, pinned to UTC, deliberately.
 *
 * The domain stores every calendar date as a floating UTC midnight (see
 * `apps/api/src/common/clock/app-calendar.ts`): "2026-07-24" is persisted as
 * `2026-07-24T00:00:00Z` and means that calendar day in the app time zone, not
 * an instant.
 * Formatting that in the browser's local zone renders the previous day for
 * anyone west of UTC: a contract would appear to end a day early. Reading it
 * back in UTC returns exactly the day that was stored.
 *
 * Use this for anything the API typed as a calendar date (validTo, startDate,
 * endDate, birthDate, terminatedAt). Use `formatDate` for true instants
 * (createdAt, updatedAt), where local time is what the user means.
 */
const calendarDateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

const numberFormatter = new Intl.NumberFormat(APP_LOCALE);

/**
 * Format a date as the locale's numeric date. Returns an empty string for an unparseable
 * input so a bad value renders as a blank cell instead of "Invalid Date".
 */
export function formatDate(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return dateFormatter.format(date);
}

/**
 * Format a floating-midnight calendar date as the locale's numeric date, in
 * UTC. Returns an
 * empty string for an unparseable input so a bad value renders as a blank cell.
 */
export function formatCalendarDate(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return calendarDateFormatter.format(date);
}

/**
 * A calendar date as the `yyyy-MM-dd` an `<input type="date">` expects, read in
 * UTC so the round-trip through the input never shifts the day.
 */
export function toDateInputValue(value: Date | null | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return '';
  return value.toISOString().slice(0, 10);
}

/**
 * The inverse: an `<input type="date">` value as a floating-midnight `Date`.
 *
 * `new Date('2026-07-24')` is specified to parse date-only ISO strings as UTC,
 * which is exactly the floating midnight the API stores, so this is a guard
 * and a name for the invariant rather than arithmetic. Never build these with
 * `new Date(y, m, d)`, which is local-time and drifts by a day.
 */
export function fromDateInputValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `Tuesday, July 14, 2026`: the weekday-and-long-month form the design puts
 * under the dashboard title.
 *
 * A true INSTANT formatted in local time, unlike `formatCalendarDate`: this
 * answers "what day is it for the person reading the screen right now", so the
 * browser zone is exactly what is wanted here.
 *
 * Some locales render the weekday lowercase mid-sentence; the design capitalizes
 * it because it leads the line, so the first letter is uppercased explicitly
 * rather than relying on a CSS `capitalize`, which would also touch the month
 * name. A no-op for English.
 */
const longDateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function formatLongDate(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const formatted = longDateFormatter.format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/** Format a number with the locale's grouping and decimal separators. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  return numberFormatter.format(value);
}

/**
 * Format a `Money` value in the app locale.
 *
 * Deliberately a thin delegate: `formatMoney` in `@repo/shared/money` is the
 * single currency formatter in the repo (it also guards the non-finite case and
 * keeps the string `amount` intact). Do not add a second one here.
 */
export function formatCurrency(money: Money): string {
  return formatMoney(money, APP_LOCALE);
}
