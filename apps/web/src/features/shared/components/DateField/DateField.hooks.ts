import { useTranslation } from 'react-i18next';
import { dateEntryPattern } from '@repo/ui/lib/calendar';
import { APP_LOCALE } from '@/lib/i18n/format';
import type { IDateFieldView } from './DateField.types';

/**
 * Resolves the picker's own copy from the shared `common` catalog.
 *
 * It lives in `common` rather than in a feature because several features use
 * this field, and a per-feature copy of "Open calendar" is one more chance per
 * feature for the copy to drift.
 */
export function useDateField(): IDateFieldView {
  const { t } = useTranslation('common');
  // The written pattern comes from the locale, not the catalog, so the
  // placeholder and the hint always describe what the field actually accepts.
  const pattern = dateEntryPattern(APP_LOCALE).placeholder;

  return {
    labels: {
      placeholder: pattern,
      openCalendar: t('dateField.openCalendar'),
      previousMonth: t('dateField.previousMonth'),
      nextMonth: t('dateField.nextMonth'),
      formatHint: t('dateField.formatHint', { pattern }),
    },
  };
}
