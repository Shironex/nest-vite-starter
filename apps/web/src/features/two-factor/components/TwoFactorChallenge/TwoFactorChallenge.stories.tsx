import type { Meta, StoryObj } from '@storybook/react-vite';
import TwoFactorChallenge from './TwoFactorChallenge';

const meta: Meta<typeof TwoFactorChallenge> = {
  title: 'two-factor/TwoFactorChallenge',
  component: TwoFactorChallenge,
};

export default meta;

type Story = StoryObj<typeof TwoFactorChallenge>;

/** The challenge form as first shown after a password login returns twofa_required. */
export const Default: Story = {};
