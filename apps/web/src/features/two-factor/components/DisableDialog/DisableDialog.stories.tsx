import type { Meta, StoryObj } from '@storybook/react-vite';
import DisableDialog from './DisableDialog';

const meta: Meta<typeof DisableDialog> = {
  title: 'two-factor/DisableDialog',
  component: DisableDialog,
};

export default meta;

type Story = StoryObj<typeof DisableDialog>;

export const Open: Story = {
  args: { open: true, onOpenChange: () => {} },
};
