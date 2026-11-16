import {
  addAppMonths,
  appDateParts,
  appDayKey,
  daysBetweenAppDays,
  endOfAppYearPlus,
  isOnOrBeforeAppDay,
  resolveAppTimeZone,
  startOfAppDay,
} from './app-calendar';

/** A zone with DST, so the transition cases actually cross one. */
const NEW_YORK = 'America/New_York';
/** A zone ahead of UTC, so its day rolls before the UTC day does. */
const TOKYO = 'Asia/Tokyo';

describe('app calendar helpers', () => {
  describe('resolveAppTimeZone', () => {
    it('defaults to UTC when APP_TIME_ZONE is unset or empty', () => {
      expect(resolveAppTimeZone(undefined)).toBe('UTC');
      expect(resolveAppTimeZone('  ')).toBe('UTC');
    });

    it('accepts an IANA zone name', () => {
      expect(resolveAppTimeZone(NEW_YORK)).toBe(NEW_YORK);
    });

    it('refuses a zone Intl does not know', () => {
      expect(() => resolveAppTimeZone('Mars/Olympus_Mons')).toThrow(/APP_TIME_ZONE/u);
    });
  });

  describe('appDateParts', () => {
    it('resolves the app-zone calendar date, not the UTC one', () => {
      // 02:30 UTC on 15 June is still 22:30 on 14 June in New York (EDT, -4).
      // Reading UTC parts here would put the event on the wrong day.
      expect(appDateParts(new Date('2026-06-15T02:30:00Z'), NEW_YORK)).toEqual({
        year: 2026,
        month: 6,
        day: 14,
      });
    });

    it('handles the winter offset too', () => {
      // 04:30 UTC on 15 January is 23:30 on 14 January in New York (EST, -5).
      expect(appDateParts(new Date('2026-01-15T04:30:00Z'), NEW_YORK)).toEqual({
        year: 2026,
        month: 1,
        day: 14,
      });
    });
  });

  describe('daysBetweenAppDays', () => {
    it('counts date boundaries crossed, not elapsed 24h periods', () => {
      // 90 minutes apart, but they straddle midnight in New York (EST, -5 in
      // February): 04:00Z is 23:00 on the 10th, 05:30Z is 00:30 on the 11th. A
      // duration-based implementation would report 0 days here.
      const from = new Date('2026-02-11T04:00:00Z');
      const to = new Date('2026-02-11T05:30:00Z');
      expect(daysBetweenAppDays(from, to, NEW_YORK)).toBe(1);
    });

    it('is unaffected by the spring DST transition', () => {
      // New York springs forward on 2026-03-08, so the local day that holds the
      // transition is 23 hours long. Counting date boundaries is immune to it.
      const from = new Date('2026-03-01T12:00:00Z');
      const to = new Date('2026-03-31T12:00:00Z');
      expect(daysBetweenAppDays(from, to, NEW_YORK)).toBe(30);
    });

    it('is unaffected by the autumn DST transition', () => {
      // New York falls back on 2026-11-01.
      const from = new Date('2026-10-15T12:00:00Z');
      const to = new Date('2026-11-14T12:00:00Z');
      expect(daysBetweenAppDays(from, to, NEW_YORK)).toBe(30);
    });

    it('returns a negative count for a past date', () => {
      expect(
        daysBetweenAppDays(new Date('2026-07-24T10:00:00Z'), new Date('2026-07-17T10:00:00Z')),
      ).toBe(-7);
    });

    it('returns zero for two instants on the same app-zone day', () => {
      // 05:00Z and 20:00Z are 01:00 and 16:00 on the 24th in New York.
      expect(
        daysBetweenAppDays(
          new Date('2026-07-24T05:00:00Z'),
          new Date('2026-07-24T20:00:00Z'),
          NEW_YORK,
        ),
      ).toBe(0);
    });
  });

  describe('addAppMonths', () => {
    it('clamps to the end of a shorter target month', () => {
      // 31 January + 1 month must be 28 February, never 3 March. Overshooting
      // would hand out days of validity nobody is entitled to.
      expect(startOfAppDay(addAppMonths(new Date('2026-01-31T00:00:00Z'), 1))).toEqual(
        new Date(Date.UTC(2026, 1, 28)),
      );
    });

    it('clamps to 29 February in a leap year', () => {
      expect(startOfAppDay(addAppMonths(new Date('2028-01-31T00:00:00Z'), 1))).toEqual(
        new Date(Date.UTC(2028, 1, 29)),
      );
    });

    it('rolls the year over for intervals longer than twelve months', () => {
      // A six-year (72-month) interval.
      expect(startOfAppDay(addAppMonths(new Date('2026-07-24T00:00:00Z'), 72))).toEqual(
        new Date(Date.UTC(2032, 6, 24)),
      );
    });

    it('keeps the day of month when the target month is long enough', () => {
      expect(startOfAppDay(addAppMonths(new Date('2026-01-15T00:00:00Z'), 36))).toEqual(
        new Date(Date.UTC(2029, 0, 15)),
      );
    });
  });

  describe('endOfAppYearPlus', () => {
    it('counts from the end of the year, not from the date', () => {
      // 10 years from the END of the calendar year in which the record closed.
      // Closing in March 2026 therefore runs to 2037-01-01, not to 2036-03.
      expect(endOfAppYearPlus(new Date('2026-03-15T00:00:00Z'), 10)).toEqual(
        new Date(Date.UTC(2037, 0, 1)),
      );
    });

    it('gives the same deadline for any date within one year', () => {
      const january = endOfAppYearPlus(new Date('2026-01-01T00:00:00Z'), 10);
      const december = endOfAppYearPlus(new Date('2026-12-31T00:00:00Z'), 10);
      expect(january).toEqual(december);
    });
  });

  describe('isOnOrBeforeAppDay', () => {
    it('treats the final day of validity as still valid', () => {
      const validTo = new Date('2026-07-24T00:00:00Z');
      const duringThatDay = new Date('2026-07-24T18:00:00Z');
      expect(isOnOrBeforeAppDay(validTo, duringThatDay)).toBe(true);
    });

    it('treats the next day as past', () => {
      const validTo = new Date('2026-07-24T00:00:00Z');
      const nextDay = new Date('2026-07-25T06:00:00Z');
      expect(isOnOrBeforeAppDay(validTo, nextDay)).toBe(true);
      expect(isOnOrBeforeAppDay(nextDay, validTo)).toBe(false);
    });
  });

  describe('appDayKey', () => {
    it('formats YYYYMMDD in the app zone', () => {
      expect(appDayKey(new Date('2026-07-25T10:00:00.000Z'))).toBe('20260725');
    });

    it('rolls at local midnight, not UTC midnight', () => {
      // 16:30 UTC in July is 01:30 the NEXT day in Tokyo (UTC+9). A digest
      // marker keyed on the UTC day would let a late sweep re-mail everyone.
      expect(appDayKey(new Date('2026-07-25T16:30:00.000Z'), TOKYO)).toBe('20260726');
    });
  });
});
