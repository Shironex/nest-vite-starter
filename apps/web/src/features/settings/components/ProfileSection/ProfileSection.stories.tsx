import type { Meta, StoryObj } from '@storybook/react-vite';
import ProfileSection from './ProfileSection';

const meta: Meta<typeof ProfileSection> = {
  title: 'settings/ProfileSection',
  component: ProfileSection,
};

export default meta;

type Story = StoryObj<typeof ProfileSection>;

/**
 * Default state: renders nothing when the user is not authenticated (hook returns null).
 * The global QueryClientProvider decorator covers the query/mutation infrastructure.
 * useAuth returns null offline so the component gracefully renders nothing.
 */
export const Default: Story = {};
