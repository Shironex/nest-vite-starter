import type { Meta, StoryObj } from '@storybook/react-vite';
import DateField from './DateField';

const meta: Meta<typeof DateField> = {
  title: 'shared/DateField',
  component: DateField,
  args: {
    value: '',
    onChange: () => undefined,
  },
};

export default meta;

type Story = StoryObj<typeof DateField>;

export const Empty: Story = {};

export const WithValue: Story = { args: { value: '2026-07-14' } };

/** The pair a day-first reader would confuse: 4 March, not 3 April. */
export const TheAmbiguousDate: Story = { args: { value: '2026-03-04' } };

/** Bounded by min and max: out-of-range days stay announced. */
export const Bounded: Story = {
  args: { value: '2026-07-14', min: '2026-07-06', max: '2026-07-24' },
};
