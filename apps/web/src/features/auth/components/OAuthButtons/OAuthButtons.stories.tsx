import type { Meta, StoryObj } from '@storybook/react-vite';
import OAuthButtons from './OAuthButtons';

/**
 * Renders only once `GET /api/auth/oauth/providers` answers with an enabled
 * provider, so this story is blank without an api behind the Storybook dev
 * server. The color treatment it would draw is pinned by
 * OAuthButtons.test.tsx instead, which is where the Google branding contract is
 * actually asserted.
 */
const meta: Meta<typeof OAuthButtons> = {
  title: 'auth/OAuthButtons',
  component: OAuthButtons,
};

export default meta;

type Story = StoryObj<typeof OAuthButtons>;

export const Default: Story = {};
