import type { Locator } from '@playwright/test';
import { APP_LOCALE } from '@repo/shared/constants';

/**
 * Filling a date field, in the form the field actually reads.
 *
 * The app does not use `<input type="date">`. Chromium renders that in the
 * BROWSER's UI language regardless of `lang`, so its date order could differ
 * from the product's and nobody could tell 3 April from 4 March. The
 * replacement is a text field that reads and is typed in the app locale's
 * numeric form (`APP_LOCALE`, `MM/dd/yyyy` for `en-US`).
 *
 * The specs still speak `yyyy-MM-dd` between themselves, because that is the
 * wire shape the API stores and the shape the field still emits. This helper is
 * the one place the two meet, so a spec asserts on a date rather than on a
 * format.
 */

const FIELD_FORMAT = new Intl.DateTimeFormat(APP_LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `yyyy-MM-dd` as the text the field reads in the app locale. */
export function toFieldDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`toFieldDate expects yyyy-MM-dd, got "${iso}".`);
  }
  return FIELD_FORMAT.format(new Date(`${iso}T00:00:00Z`));
}

/**
 * Type a `yyyy-MM-dd` date into a date field.
 *
 * `fill` rather than `pressSequentially`: the field's mask re-formats whatever
 * arrives, so the finished string is what a caret-at-the-end keystroke run
 * would have produced anyway, and it is an order of magnitude faster.
 */
export async function fillDate(locator: Locator, iso: string): Promise<void> {
  await locator.fill(toFieldDate(iso));
}

/**
 * `yyyy-MM-dd`, offset from today in whole days.
 *
 * Built from UTC fields because the app stores every calendar date as a
 * floating UTC midnight, which is also the shape the date field emits, and
 * the api's calendar-day math runs in `APP_TIME_ZONE` (UTC by default).
 *
 * Lives here rather than in a spec because a fixture value the app compares
 * against "today" must be derived, not spelled out: a literal reads as a
 * constant and behaves as one right up until the calendar moves past it, and
 * then the run fails in a bucket nobody changed. `no-hardcoded-dates-in-fixtures`
 * points the next fixture at this helper.
 */
export function isoDateIn(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The birth date every person fixture uses.
 *
 * Deliberately NOT derived: nothing in the product compares a birth date
 * against today, and `1990-05-15` in the report a failure prints is worth more
 * than an expression that resolves to the same thing. Named so there is one
 * place to change it.
 */
export const FIXTURE_BIRTH_DATE = '1990-05-15';
