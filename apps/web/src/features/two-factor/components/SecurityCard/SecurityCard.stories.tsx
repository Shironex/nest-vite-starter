import type { Meta, StoryObj } from '@storybook/react-vite';
import SecurityCard from './SecurityCard';

const meta: Meta<typeof SecurityCard> = {
  title: 'two-factor/SecurityCard',
  component: SecurityCard,
};

export default meta;

type Story = StoryObj<typeof SecurityCard>;

/** Driven by twoFactor.status; the global QueryClient decorator covers the query. */
export const Default: Story = {};
