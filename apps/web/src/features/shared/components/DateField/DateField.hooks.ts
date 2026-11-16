import { dateEntryPattern } from '@repo/ui/lib/calendar';
import { APP_LOCALE } from '@/lib/format';
import type { IDateFieldView } from './DateField.types';
import { commonStrings } from '@/lib/strings';

/**
 * Resolves the picker's own copy from the shared `common` catalog.
 *
 * It lives in `common` rather than in a feature because several features use
 * this field, and a per-feature copy of "Open calendar" is one more chance per
 * feature for the copy to drift.
 */
export function useDateField(): IDateFieldView {
  // The written pattern comes from the locale, not the catalog, so the
  // placeholder and the hint always describe what the field actually accepts.
  const pattern = dateEntryPattern(APP_LOCALE).placeholder;

  return {
    labels: {
      placeholder: pattern,
      openCalendar: commonStrings.dateField.openCalendar,
      previousMonth: commonStrings.dateField.previousMonth,
      nextMonth: commonStrings.dateField.nextMonth,
      formatHint: commonStrings.dateField.formatHint({ pattern }),
    },
  };
}
