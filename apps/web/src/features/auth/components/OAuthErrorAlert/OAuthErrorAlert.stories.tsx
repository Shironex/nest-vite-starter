import type { Meta, StoryObj } from '@storybook/react-vite';
import OAuthErrorAlert from './OAuthErrorAlert';

/**
 * Reads `?error=` off the `/auth` route, so it is blank outside a router. Each
 * code's rendered sentence is pinned in OAuthErrorAlert.test.tsx.
 */
const meta: Meta<typeof OAuthErrorAlert> = {
  title: 'auth/OAuthErrorAlert',
  component: OAuthErrorAlert,
};

export default meta;

type Story = StoryObj<typeof OAuthErrorAlert>;

export const Default: Story = {};
