import type { Meta, StoryObj } from '@storybook/react-vite';
import TitleBar from './TitleBar';

const meta: Meta<typeof TitleBar> = {
  title: 'desktop/TitleBar',
  component: TitleBar,
};

export default meta;

type Story = StoryObj<typeof TitleBar>;

/**
 * Default state: renders nothing outside Electron (IS_ELECTRON is false in Storybook).
 * In a real Electron renderer this would show the frameless window title bar.
 */
export const Default: Story = {};
