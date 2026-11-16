import type { Meta, StoryObj } from '@storybook/react-vite';
import ListSearchField from './ListSearchField';

const meta: Meta<typeof ListSearchField> = {
  title: 'shared/ListSearchField',
  component: ListSearchField,
  args: {
    value: '',
    onValueChange: () => undefined,
    label: 'Search workspaces',
    placeholder: 'Search workspaces...',
  },
};

export default meta;

type Story = StoryObj<typeof ListSearchField>;

export const Default: Story = {};

export const WithTerm: Story = { args: { value: 'Kowalska' } };
