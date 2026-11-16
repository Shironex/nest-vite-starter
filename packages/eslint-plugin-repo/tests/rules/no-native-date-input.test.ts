import { noNativeDateInputRule } from '../../src/rules/no-native-date-input';
import { ruleTester } from '../test-utils/ruleTester';

const WEB = 'apps/web/src/features/invoices/components/InvoiceFormDialog/InvoiceFormDialog.tsx';
const UI = 'packages/ui/src/components/input.tsx';
const API = 'apps/api/src/modules/billing/billing.router.ts';

ruleTester.run('no-native-date-input', noNativeDateInputRule, {
  valid: [
    {
      // The replacement, which holds the same `yyyy-MM-dd` value.
      code: 'const C = () => <DateField value={v} onChange={set} />;',
      filename: WEB,
    },
    {
      // Every other input type renders identically in every locale.
      code: 'const C = () => <Input type="text" />;',
      filename: WEB,
    },
    {
      code: 'const C = () => <Input type="email" maxLength={200} />;',
      filename: WEB,
    },
    {
      // A field-router prop is not a native date input: the component it names
      // decides what to render, and the two in this app branch to DateField
      // before an `<Input>` is reached.
      code: 'const C = () => <InvoiceTextField name="birthDate" type="date" />;',
      filename: WEB,
    },
    {
      // The component's own text input, which is what the replacement renders.
      code: 'const C = () => <input type="text" inputMode="numeric" />;',
      filename: 'packages/ui/src/components/date-field.tsx',
    },
    {
      // Server code has no JSX to gate, and the glob keeps the rule off it.
      code: 'const type = "date";',
      filename: API,
    },
  ],
  invalid: [
    {
      code: 'const C = () => <Input type="date" {...field} />;',
      filename: WEB,
      errors: [{ messageId: 'nativeDateInput' }],
    },
    {
      // The lowercase intrinsic, which is the same defect one layer down.
      code: 'const C = () => <input type="date" />;',
      filename: UI,
      errors: [{ messageId: 'nativeDateInput' }],
    },
    {
      // Braced literal, same string.
      code: 'const C = () => <Input type={"date"} />;',
      filename: WEB,
      errors: [{ messageId: 'nativeDateInput' }],
    },
    {
      // `datetime-local` reads from the browser UI language for exactly the
      // same reason, and adds a time whose separator moves too.
      code: 'const C = () => <Input type="datetime-local" />;',
      filename: WEB,
      errors: [{ messageId: 'nativeDateInput' }],
    },
    {
      code: 'const C = () => <input type="month" />;',
      filename: WEB,
      errors: [{ messageId: 'nativeDateInput' }],
    },
    {
      code: 'const C = () => <input type="week" />;',
      filename: WEB,
      errors: [{ messageId: 'nativeDateInput' }],
    },
    {
      // Two on one element are two findings, not one.
      code: 'const C = () => (<div><input type="date" /><Input type="date" /></div>);',
      filename: WEB,
      errors: [{ messageId: 'nativeDateInput' }, { messageId: 'nativeDateInput' }],
    },
  ],
});
