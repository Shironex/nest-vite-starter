import type { Meta, StoryObj } from '@storybook/react-vite';
import RecoveryCodesPanel from './RecoveryCodesPanel';

const meta: Meta<typeof RecoveryCodesPanel> = {
  title: 'two-factor/RecoveryCodesPanel',
  component: RecoveryCodesPanel,
};

export default meta;

type Story = StoryObj<typeof RecoveryCodesPanel>;

export const Default: Story = {
  args: {
    codes: [
      'A1B2-C3D4-E5F6-G7H8',
      'J9K0-L1M2-N3P4-Q5R6',
      'S7T8-U9V0-W1X2-Y3Z4',
      'B5C6-D7E8-F9G0-H1J2',
    ],
  },
};
