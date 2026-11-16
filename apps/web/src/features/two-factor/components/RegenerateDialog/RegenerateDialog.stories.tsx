import type { Meta, StoryObj } from '@storybook/react-vite';
import RegenerateDialog from './RegenerateDialog';

const meta: Meta<typeof RegenerateDialog> = {
  title: 'two-factor/RegenerateDialog',
  component: RegenerateDialog,
};

export default meta;

type Story = StoryObj<typeof RegenerateDialog>;

export const Open: Story = {
  args: { open: true, onOpenChange: () => {} },
};
