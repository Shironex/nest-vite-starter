import type { Meta, StoryObj } from '@storybook/react-vite';
import ConfirmEmailChange from './ConfirmEmailChange';

const meta: Meta<typeof ConfirmEmailChange> = {
  title: 'auth/ConfirmEmailChange',
  component: ConfirmEmailChange,
};

export default meta;

type Story = StoryObj<typeof ConfirmEmailChange>;

/** No token in the URL: the terminal "open the email link again" state. */
export const MissingToken: Story = {
  args: { token: undefined },
};
