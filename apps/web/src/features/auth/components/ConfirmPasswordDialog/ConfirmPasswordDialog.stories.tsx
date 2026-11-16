import type { Meta, StoryObj } from '@storybook/react-vite';
import ConfirmPasswordDialog from './ConfirmPasswordDialog';

/**
 * The sudo prompt needs a live api to do anything (auth.confirmPassword), so
 * the story only shows the chrome; the error branches are pinned by
 * ConfirmPasswordDialog.hooks.test.tsx.
 */
const meta: Meta<typeof ConfirmPasswordDialog> = {
  title: 'auth/ConfirmPasswordDialog',
  component: ConfirmPasswordDialog,
  args: {
    open: true,
    onOpenChange: () => undefined,
    onConfirmed: () => undefined,
  },
};

export default meta;

type Story = StoryObj<typeof ConfirmPasswordDialog>;

export const Default: Story = {};
