import type { Meta, StoryObj } from '@storybook/react-vite';
import WorkspaceFormDialog from './WorkspaceFormDialog';

const meta: Meta<typeof WorkspaceFormDialog> = {
  title: 'workspace/WorkspaceFormDialog',
  component: WorkspaceFormDialog,
  args: {
    open: true,
    onOpenChange: () => undefined,
  },
};

export default meta;

type Story = StoryObj<typeof WorkspaceFormDialog>;

/** A brand-new workspace: everything blank, only the name required. */
export const Create: Story = {
  args: { mode: 'create' },
};

/** Correcting an existing workspace's details. */
export const Edit: Story = {
  args: {
    mode: 'edit',
    workspace: {
      id: 'f-1',
      name: 'Northwind Ltd',
      legalName: 'Northwind Traders Limited',
      street: 'Main St 1',
      postalCode: '12345',
      city: 'Springfield',
    },
  },
};
