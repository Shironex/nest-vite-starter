import { InvariantError } from '../errors/invariant-error';
/**
 * Calendar arithmetic in the application time zone.
 *
 * A deadline is often a CALENDAR date, not an instant: something expires at
 * the end of its day in the app's zone, and "30 days before expiry" must mean
 * 30 calendar days regardless of any DST transitions in between. Doing that
 * arithmetic on raw milliseconds drifts by an hour twice a year in a zone with
 * DST, which is enough to fire a reminder on the wrong day or to make an item
 * look expired a day early.
 *
 * These helpers therefore work in whole days at local midnight in the app
 * zone. They deliberately do NOT read the wall clock; callers pass `asOf` in,
 * sourced from `common/clock`, so every consumer stays testable against a
 * frozen clock.
 *
 * Implemented with Intl rather than a date library because the only thing needed
 * is "what Y/M/D is this instant in the app zone", which Intl answers exactly
 * and without a dependency. `date-fns` is not an apps/api dependency today.
 */

/** The zone used when `APP_TIME_ZONE` is unset or empty. */
export const DEFAULT_APP_TIME_ZONE = 'UTC';

/**
 * Validate a configured zone name, falling back to UTC when it is absent.
 *
 * Exported so the spec can exercise the fallback and the refusal without
 * reloading the module. An unknown zone is a boot-time misconfiguration: the
 * Joi schema refuses it first, and this throw is the backstop for a process
 * that reads the module before config validation runs.
 */
export function resolveAppTimeZone(raw: string | undefined): string {
  const zone = raw === undefined || raw.trim() === '' ? DEFAULT_APP_TIME_ZONE : raw.trim();
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  } catch (error) {
    throw new InvariantError(`APP_TIME_ZONE "${zone}" is not an IANA time zone.`, {
      cause: error,
    });
  }
}

/**
 * All calendar-date math is pinned to this zone, set by the `APP_TIME_ZONE` env
 * key (default `UTC`). One zone per deployment, not per tenant.
 *
 * Read at module scope: `main.ts` loads the `.env` files before any other
 * module is imported, so the value is already in `process.env` here.
 */
export const APP_TIME_ZONE = resolveAppTimeZone(process.env.APP_TIME_ZONE);

/**
 * Milliseconds in a calendar day. Exported because callers that build a
 * day-offset bound (a scan window, a coarse SQL bound) need the same constant
 * these helpers use, and a private copy per call site is a silent way for one
 * of them to drift.
 */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** One formatter per zone: construction is the expensive part of Intl. */
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone);
  if (formatter === undefined) {
    // en-CA formats as YYYY-MM-DD, which is stable to split and locale-independent.
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** A calendar date in the app zone, decomposed. Month is 1-based, as printed. */
export interface IAppDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Decompose an instant into the calendar date it falls on in the app zone. */
export function appDateParts(instant: Date, timeZone: string = APP_TIME_ZONE): IAppDateParts {
  const [year, month, day] = partsFormatter(timeZone).format(instant).split('-').map(Number);
  /* c8 ignore next */
  if (year === undefined || month === undefined || day === undefined) {
    throw new InvariantError('Failed to resolve the app-zone date parts.');
  }
  return { year, month, day };
}

/**
 * The UTC instant representing the START of the given calendar day in the app
 * zone.
 *
 * Days are compared and stored as this instant so that two dates entered on the
 * same local day are always equal, whatever time of day they were typed. Uses
 * Date.UTC on the local Y/M/D, i.e. a "floating" midnight: the value is a
 * stable per-day key, not a claim about the exact UTC instant local midnight
 * occurred. That is the right trade for calendar-date columns, and it keeps day
 * arithmetic free of DST entirely.
 */
export function startOfAppDay(instant: Date, timeZone: string = APP_TIME_ZONE): Date {
  const { year, month, day } = appDateParts(instant, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Whole calendar days from `from` to `to`, in the app zone. Positive when `to`
 * is in the future. Both sides are normalized to their day start first, so the
 * result counts date boundaries crossed rather than 24-hour periods elapsed,
 * which is what a reminder ladder ("14 days before") actually means.
 */
export function daysBetweenAppDays(from: Date, to: Date, timeZone: string = APP_TIME_ZONE): number {
  const start = startOfAppDay(from, timeZone).getTime();
  const end = startOfAppDay(to, timeZone).getTime();
  return Math.round((end - start) / MS_PER_DAY);
}

/**
 * Add whole months to a calendar date in the app zone, clamping to the end of
 * the target month.
 *
 * Clamping matters: something valid from 31 January for 1 month must expire
 * on 28/29 February, not silently roll into March the way naive date
 * arithmetic does. Overshooting the month would hand out extra days of
 * validity nobody is entitled to.
 */
export function addAppMonths(
  instant: Date,
  months: number,
  timeZone: string = APP_TIME_ZONE,
): Date {
  const { year, month, day } = appDateParts(instant, timeZone);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  // JS modulo keeps the sign of the dividend, so normalize for negative months.
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  // Day 0 of the NEXT month is the last day of the target month.
  const daysInTargetMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, daysInTargetMonth)));
}

/**
 * A retention deadline counted in calendar years: the end of the calendar year
 * `years` after the year in which `basis` falls. Retention rules of this shape
 * count from the END of the year the record closed, never from the date itself.
 *
 * Returns the first instant AFTER the retention window, so a purge job can use a
 * simple `retentionUntil <= now` test without an off-by-one on 31 December.
 */
export function endOfAppYearPlus(
  basis: Date,
  years: number,
  timeZone: string = APP_TIME_ZONE,
): Date {
  const { year } = appDateParts(basis, timeZone);
  return new Date(Date.UTC(year + years + 1, 0, 1));
}

/**
 * True when `date` falls on or before the app-zone calendar day of `asOf`.
 * Expiry is inclusive of the final day: something valid to the 24th is still
 * valid all day on the 24th and overdue from the 25th.
 */
export function isOnOrBeforeAppDay(
  date: Date,
  asOf: Date,
  timeZone: string = APP_TIME_ZONE,
): boolean {
  return startOfAppDay(date, timeZone).getTime() <= startOfAppDay(asOf, timeZone).getTime();
}

/**
 * `YYYYMMDD` in the app zone: the day key a scheduled sweep stamps its
 * once-per-day idempotency marker with.
 *
 * The app zone rather than UTC because the marker has to roll when the local
 * calendar day rolls: in a zone ahead of UTC it is already the next day while
 * UTC is still on the previous one, and a marker keyed on the UTC day would let
 * a late sweep run twice.
 */
export function appDayKey(instant: Date, timeZone: string = APP_TIME_ZONE): string {
  const { year, month, day } = appDateParts(instant, timeZone);
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}
