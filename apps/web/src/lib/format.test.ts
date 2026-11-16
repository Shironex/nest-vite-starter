import { describe, expect, it } from 'vitest';
import { createMoney } from '@repo/shared/money';
import {
  formatCalendarDate,
  formatCurrency,
  formatDate,
  formatNumber,
  fromDateInputValue,
  toDateInputValue,
} from './format';

describe('format', () => {
  it('formats dates as MM/dd/yyyy', () => {
    expect(formatDate(new Date(Date.UTC(2026, 6, 4, 12)))).toBe('07/04/2026');
    expect(formatDate('2026-12-31T12:00:00Z')).toBe('12/31/2026');
  });

  it('returns an empty string for an unparseable date', () => {
    expect(formatDate('not a date')).toBe('');
  });

  it('formats numbers with the app locale separators', () => {
    expect(formatNumber(1234567.89)).toBe('1,234,567.89');
    expect(formatNumber(1234.5)).toBe('1,234.5');
    expect(formatNumber(Number.NaN)).toBe('');
  });

  it('formats money through the shared formatMoney helper', () => {
    expect(formatCurrency(createMoney('1234567.89', 'USD'))).toBe('$1,234,567.89');
  });
});

/**
 * Calendar dates are stored as floating UTC midnights (see
 * apps/api/src/common/clock/app-calendar.ts). Reading one back in the browser's local
 * zone renders the PREVIOUS day for anyone west of UTC: a contract would look
 * like it ends a day early. These assertions pin the UTC boundary that prevents
 * that, which is the whole reason formatCalendarDate exists next to formatDate.
 */
describe('calendar dates', () => {
  it('renders a floating UTC midnight as the day that was stored', () => {
    expect(formatCalendarDate(new Date('2026-07-24T00:00:00Z'))).toBe('07/24/2026');
  });

  it('does not roll back across the UTC midnight boundary', () => {
    // The instant a local-zone formatter would render as the 23rd for any
    // viewer west of UTC.
    expect(formatCalendarDate(new Date('2026-01-01T00:00:00Z'))).toBe('01/01/2026');
    expect(formatCalendarDate('2026-03-01T00:00:00Z')).toBe('03/01/2026');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatCalendarDate('not a date')).toBe('');
  });

  it('round-trips through an <input type="date"> value without shifting the day', () => {
    const stored = new Date('2026-07-24T00:00:00Z');

    const inputValue = toDateInputValue(stored);
    expect(inputValue).toBe('2026-07-24');

    const parsed = fromDateInputValue(inputValue);
    expect(parsed?.toISOString()).toBe('2026-07-24T00:00:00.000Z');
    expect(formatCalendarDate(parsed as Date)).toBe('07/24/2026');
  });

  it('treats an absent or invalid date as an empty input value', () => {
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue(undefined)).toBe('');
    expect(toDateInputValue(new Date('nope'))).toBe('');
  });

  it('refuses anything that is not a bare yyyy-MM-dd', () => {
    // A datetime string would parse in the LOCAL zone and reintroduce the drift
    // this helper exists to prevent, so it is rejected rather than coerced.
    expect(fromDateInputValue('2026-07-24T12:00:00')).toBeNull();
    expect(fromDateInputValue('07/24/2026')).toBeNull();
    expect(fromDateInputValue('')).toBeNull();
  });
});
