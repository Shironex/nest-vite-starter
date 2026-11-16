import type { Meta, StoryObj } from '@storybook/react-vite';
import SessionsSection from './SessionsSection';

const meta: Meta<typeof SessionsSection> = {
  title: 'settings/SessionsSection',
  component: SessionsSection,
};

export default meta;

type Story = StoryObj<typeof SessionsSection>;

/**
 * Default state: the global QueryClientProvider decorator covers the query
 * infrastructure; offline the list query stays pending, so the panel renders
 * its loading line.
 */
export const Default: Story = {};
