import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { DateField, type IDateFieldLabels } from './date-field';
import { Label } from './label';

/**
 * The replacement for `<input type="date">`.
 *
 * Chromium reads a native date input's format from the BROWSER's UI language
 * and ignores the element's `lang` and the page locale, so a day-first product
 * on a US-English Chrome renders `03/04/2026` and nobody can tell 3 April from
 * 4 March. The control is replaced rather than configured, and its written
 * form follows the `locale` prop (`en-US` by default).
 *
 * The value contract is unchanged: `yyyy-MM-dd` in, `yyyy-MM-dd` out, exactly
 * what the native control held. Typing is the primary path and never needs the
 * calendar; the calendar is a secondary path opened from the button or with
 * Alt+ArrowDown.
 */
const meta = {
  title: 'Components/DateField',
  component: DateField,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Locale-format date entry (en-US by default). Type `07142026` and the separators appear; open the calendar for a Monday-first month grid with full keyboard navigation.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

const labels: IDateFieldLabels = {
  openCalendar: 'Open calendar',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  placeholder: 'mm/dd/yyyy',
  formatHint:
    'Format mm/dd/yyyy. Type the date, or press Alt and the down arrow to open the calendar.',
};

function Demo({
  initial = '',
  min,
  max,
  invalid = false,
  disabled = false,
}: {
  initial?: string;
  min?: string;
  max?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <div className="w-64 space-y-2">
      <Label htmlFor="story-date">Contract end date</Label>
      <DateField
        id="story-date"
        value={value}
        onChange={setValue}
        labels={labels}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={invalid}
      />
      <p className="type-body-small text-text-muted">
        Wire value: <code>{value === '' ? '(empty)' : value}</code>
      </p>
    </div>
  );
}

export const Empty: Story = { render: () => <Demo /> };

export const WithValue: Story = { render: () => <Demo initial="2026-07-14" /> };

/** The exact pair the native control could not distinguish: 4 March, not 3 April. */
export const TheAmbiguousDate: Story = { render: () => <Demo initial="2026-03-04" /> };

/** Days outside the window stay visible and announced, but cannot be chosen. */
export const Bounded: Story = {
  render: () => <Demo initial="2026-07-14" min="2026-07-06" max="2026-07-24" />,
};

export const Invalid: Story = { render: () => <Demo initial="2026-07-14" invalid /> };

export const Disabled: Story = { render: () => <Demo initial="2026-07-14" disabled /> };
