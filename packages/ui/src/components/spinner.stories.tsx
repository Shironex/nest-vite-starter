import type { Meta, StoryObj } from '@storybook/react-vite';
import { Spinner } from './spinner';

const meta = {
  title: 'Components/Spinner',
  component: Spinner,
  tags: ['autodocs'],
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex min-h-[200px] items-center justify-center p-8">
      <Spinner />
    </div>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div className="space-y-8 p-8">
      <div>
        <p className="mb-4 text-sm text-muted-foreground">Default</p>
        <div className="flex h-20 items-center justify-center rounded bg-muted">
          <Spinner variant="default" />
        </div>
      </div>

      <div>
        <p className="mb-4 text-sm text-muted-foreground">Dots</p>
        <div className="flex h-20 items-center justify-center rounded bg-muted">
          <Spinner variant="dots" />
        </div>
      </div>

      <div>
        <p className="mb-4 text-sm text-muted-foreground">Bars</p>
        <div className="flex h-20 items-center justify-center rounded bg-muted">
          <Spinner variant="bars" />
        </div>
      </div>

      <div>
        <p className="mb-4 text-sm text-muted-foreground">Pulse</p>
        <div className="flex h-20 items-center justify-center rounded bg-muted">
          <Spinner variant="pulse" />
        </div>
      </div>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="space-y-8 p-8">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Extra Small (xs)</p>
        <div className="flex h-12 items-center justify-center rounded bg-muted">
          <Spinner size="xs" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Small (sm)</p>
        <div className="flex h-12 items-center justify-center rounded bg-muted">
          <Spinner size="sm" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Medium (md)</p>
        <div className="flex h-16 items-center justify-center rounded bg-muted">
          <Spinner size="md" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Large (lg)</p>
        <div className="flex h-20 items-center justify-center rounded bg-muted">
          <Spinner size="lg" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Extra Large (xl)</p>
        <div className="flex h-24 items-center justify-center rounded bg-muted">
          <Spinner size="xl" />
        </div>
      </div>
    </div>
  ),
};

export const WithLabel: Story = {
  render: () => (
    <div className="space-y-8 p-8">
      <div className="flex min-h-[200px] items-center justify-center">
        <Spinner label="Loading..." />
      </div>

      <div className="flex min-h-[200px] items-center justify-center">
        <Spinner variant="dots" label="Processing..." />
      </div>

      <div className="flex min-h-[200px] items-center justify-center">
        <Spinner variant="bars" label="Uploading..." />
      </div>
    </div>
  ),
};
