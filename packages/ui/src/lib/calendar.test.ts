import { describe, expect, it } from 'vitest';

import {
  dateEntryPattern,
  DAYS_PER_WEEK,
  WEEKS_PER_MONTH_GRID,
  addUtcDays,
  addUtcMonths,
  daysBetweenUtc,
  endOfUtcMonth,
  fromIsoDate,
  isSameUtcDay,
  isSameUtcMonth,
  isWeekend,
  makeUtcDate,
  mondayFirstIndex,
  monthGridDays,
  monthGridWeeks,
  startOfUtcDay,
  startOfUtcMonth,
  toIsoDate,
  weekdayNames,
} from './calendar';

/*
 * Every assertion here is written against a fixed UTC date rather than the
 * clock. The one test that matters most is the last block: the whole point of
 * this module is that a browser west of UTC draws the same grid, and vitest
 * runs with whatever TZ the machine has.
 */

describe('day arithmetic', () => {
  it('reduces an instant to the UTC day it falls on', () => {
    expect(toIsoDate(startOfUtcDay(new Date('2026-07-24T22:45:00.000Z')))).toBe('2026-07-24');
  });

  it('moves whole days without drifting across a DST boundary', () => {
    // The EU changes clocks on 2026-03-29. A local-time implementation there
    // loses an hour here and lands on the 28th.
    expect(toIsoDate(addUtcDays(new Date('2026-03-28T00:00:00.000Z'), 1))).toBe('2026-03-29');
    expect(toIsoDate(addUtcDays(new Date('2026-03-29T00:00:00.000Z'), 1))).toBe('2026-03-30');
  });

  it('counts calendar days in both directions', () => {
    const from = new Date('2026-07-24T00:00:00.000Z');
    expect(daysBetweenUtc(from, new Date('2026-07-31T00:00:00.000Z'))).toBe(7);
    expect(daysBetweenUtc(from, from)).toBe(0);
    expect(daysBetweenUtc(from, new Date('2026-07-23T00:00:00.000Z'))).toBe(-1);
  });

  it('treats Saturday and Sunday as the weekend, and nothing else', () => {
    expect(isWeekend(new Date('2026-07-25T00:00:00.000Z'))).toBe(true);
    expect(isWeekend(new Date('2026-07-26T00:00:00.000Z'))).toBe(true);
    expect(isWeekend(new Date('2026-07-27T00:00:00.000Z'))).toBe(false);
  });

  it('indexes Monday first', () => {
    expect(mondayFirstIndex(new Date('2026-07-27T00:00:00.000Z'))).toBe(0);
    expect(mondayFirstIndex(new Date('2026-07-26T00:00:00.000Z'))).toBe(6);
  });
});

describe('month arithmetic', () => {
  it('clamps rather than rolling into the next month', () => {
    expect(toIsoDate(addUtcMonths(new Date('2026-01-31T00:00:00.000Z'), 1))).toBe('2026-02-28');
    expect(toIsoDate(addUtcMonths(new Date('2028-01-31T00:00:00.000Z'), 1))).toBe('2028-02-29');
  });

  it('steps backwards too', () => {
    expect(toIsoDate(addUtcMonths(new Date('2026-03-31T00:00:00.000Z'), -1))).toBe('2026-02-28');
  });

  it('finds the bounds of a month', () => {
    const inside = new Date('2026-07-14T00:00:00.000Z');
    expect(toIsoDate(startOfUtcMonth(inside))).toBe('2026-07-01');
    expect(toIsoDate(endOfUtcMonth(inside))).toBe('2026-07-31');
  });

  it('compares months and days', () => {
    const a = new Date('2026-07-01T00:00:00.000Z');
    const b = new Date('2026-07-31T00:00:00.000Z');
    expect(isSameUtcMonth(a, b)).toBe(true);
    expect(isSameUtcDay(a, b)).toBe(false);
    expect(isSameUtcDay(a, new Date('2026-07-01T23:00:00.000Z'))).toBe(true);
  });
});

describe('monthGridDays', () => {
  it('always draws six weeks so the grid never changes height', () => {
    for (const month of ['2026-02-01', '2026-07-01', '2026-08-01', '2027-01-01']) {
      expect(monthGridDays(new Date(`${month}T00:00:00.000Z`))).toHaveLength(
        WEEKS_PER_MONTH_GRID * DAYS_PER_WEEK,
      );
    }
  });

  it('starts on the Monday on or before the first of the month', () => {
    // July 2026 starts on a Wednesday, so the grid opens on 29 June.
    const days = monthGridDays(new Date('2026-07-01T00:00:00.000Z'));
    expect(toIsoDate(days[0] as Date)).toBe('2026-06-29');
    expect(toIsoDate(days[41] as Date)).toBe('2026-08-09');
  });

  it('does not shift when the month already begins on a Monday', () => {
    // June 2026 begins on a Monday: no leading days at all.
    const days = monthGridDays(new Date('2026-06-15T00:00:00.000Z'));
    expect(toIsoDate(days[0] as Date)).toBe('2026-06-01');
  });

  it('chunks into six rows of seven', () => {
    const weeks = monthGridWeeks(new Date('2026-07-01T00:00:00.000Z'));
    expect(weeks).toHaveLength(WEEKS_PER_MONTH_GRID);
    expect(weeks.every((week) => week.length === DAYS_PER_WEEK)).toBe(true);
    expect(toIsoDate(weeks[2]?.[1] as Date)).toBe('2026-07-14');
  });
});

describe('iso round trip', () => {
  it('round-trips a calendar date', () => {
    expect(toIsoDate(fromIsoDate('2026-07-24') as Date)).toBe('2026-07-24');
  });

  it('rejects a well-formed string naming a day that does not exist', () => {
    // `new Date('2026-02-31')` would quietly become 3 March.
    expect(fromIsoDate('2026-02-31')).toBeNull();
    expect(fromIsoDate('2026-13-01')).toBeNull();
  });

  it('rejects anything that is not exactly yyyy-MM-dd', () => {
    expect(fromIsoDate('24.07.2026')).toBeNull();
    expect(fromIsoDate('2026-7-24')).toBeNull();
    expect(fromIsoDate('')).toBeNull();
  });

  it('accepts a leap day only in a leap year', () => {
    expect(makeUtcDate(2028, 2, 29)).not.toBeNull();
    expect(makeUtcDate(2026, 2, 29)).toBeNull();
  });
});

describe('weekdayNames', () => {
  it('starts on Monday and carries a full name for the header', () => {
    const names = weekdayNames('en-US');
    expect(names).toHaveLength(DAYS_PER_WEEK);
    expect(names[0]?.long).toBe('Monday');
    expect(names[6]?.long).toBe('Sunday');
  });
});

describe('dateEntryPattern', () => {
  it('reads the group order and separator from the locale', () => {
    expect(dateEntryPattern('en-US')).toEqual({
      order: ['month', 'day', 'year'],
      separator: '/',
      placeholder: 'mm/dd/yyyy',
    });
    expect(dateEntryPattern('de-DE').placeholder).toBe('dd.mm.yyyy');
    expect(dateEntryPattern('sv-SE').placeholder).toBe('yyyy-mm-dd');
  });
});

describe('the whole point: no local-time drift', () => {
  /*
   * `new Date(y, m, d)` is local-time, so west of UTC the grid it builds is one
   * day behind the dates the API stores. These assertions are written against
   * UTC accessors only, so they hold whatever TZ the test machine has, and
   * the CI matrix and a developer east of UTC would both catch a regression here.
   */
  it('reads a floating UTC midnight back as the day it names', () => {
    const stored = new Date('2026-07-24T00:00:00.000Z');
    expect(toIsoDate(startOfUtcDay(stored))).toBe('2026-07-24');
  });

  it('puts the first of the month in the column its UTC weekday demands', () => {
    // 1 July 2026 is a Wednesday: column index 2, Monday-first.
    const days = monthGridDays(new Date('2026-07-01T00:00:00.000Z'));
    const first = days.findIndex((day) => toIsoDate(day) === '2026-07-01');
    expect(first % DAYS_PER_WEEK).toBe(2);
  });
});
