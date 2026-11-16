import type { Meta, StoryObj } from '@storybook/react-vite';
import WorkspaceSelect from './WorkspaceSelect';

const meta: Meta<typeof WorkspaceSelect> = {
  title: 'workspace/WorkspaceSelect',
  component: WorkspaceSelect,
  args: {
    value: '',
    onChange: () => undefined,
  },
};

export default meta;

type Story = StoryObj<typeof WorkspaceSelect>;

/** As a create form uses it: one workspace required, ADMIN may add. */
export const Required: Story = {
  args: { allowCreate: true },
};

/** As a filter uses it: an "all workspaces" option and no create affordance. */
export const AsFilter: Story = {
  args: { allowEmpty: true, showLabel: false },
};

/** Marked invalid by a form that requires a selection. */
export const Invalid: Story = {
  args: { hasError: true },
};
