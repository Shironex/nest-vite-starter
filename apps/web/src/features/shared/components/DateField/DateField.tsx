import { DateField as DateFieldPrimitive } from '@repo/ui/date-field';
import { APP_LOCALE } from '@/lib/format';
import { useDateField } from './DateField.hooks';
import type { IDateFieldProps } from './DateField.types';

/**
 * The app's date field: the `@repo/ui` primitive with this product's copy and
 * locale already attached.
 *
 * Every date input in the app goes through here rather than through the
 * primitive directly, so the copy is resolved once and the locale cannot
 * be forgotten at a call site. `repo/no-native-date-input` is the gate that
 * keeps a `<input type="date">` from coming back.
 */
export default function DateField(props: IDateFieldProps) {
  const v = useDateField();

  return <DateFieldPrimitive {...props} locale={APP_LOCALE} labels={v.labels} />;
}
