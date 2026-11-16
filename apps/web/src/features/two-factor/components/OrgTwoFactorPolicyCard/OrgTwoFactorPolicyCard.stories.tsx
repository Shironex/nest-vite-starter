import type { Meta, StoryObj } from '@storybook/react-vite';
import OrgTwoFactorPolicyCard from './OrgTwoFactorPolicyCard';

const meta: Meta<typeof OrgTwoFactorPolicyCard> = {
  title: 'two-factor/OrgTwoFactorPolicyCard',
  component: OrgTwoFactorPolicyCard,
};

export default meta;

type Story = StoryObj<typeof OrgTwoFactorPolicyCard>;

/** Driven by twoFactor.getTenantPolicy; the global QueryClient decorator covers the query. */
export const Default: Story = {};
