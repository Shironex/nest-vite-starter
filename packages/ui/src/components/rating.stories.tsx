import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Rating } from './rating';

const meta = {
  title: 'Components/Rating',
  component: Rating,
  tags: ['autodocs'],
} satisfies Meta<typeof Rating>;

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => {
    const [rating, setRating] = React.useState<number>(3);
    return (
      <div className="space-y-2">
        <Rating value={rating} onValueChange={setRating} />
        <p className="text-sm text-muted-foreground">Rating: {rating}/5</p>
      </div>
    );
  },
};

export const ReadOnly: Story = {
  render: () => {
    return (
      <div className="space-y-2">
        <Rating value={4} readonly />
        <p className="text-sm text-muted-foreground">Read-only: 4/5 stars</p>
      </div>
    );
  },
};

export const AllSizes: Story = {
  render: () => {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <span className="w-12 text-sm font-medium">Small</span>
          <Rating value={3} size="sm" readonly />
        </div>
        <div className="flex items-center gap-4">
          <span className="w-12 text-sm font-medium">Medium</span>
          <Rating value={3} size="md" readonly />
        </div>
        <div className="flex items-center gap-4">
          <span className="w-12 text-sm font-medium">Large</span>
          <Rating value={3} size="lg" readonly />
        </div>
      </div>
    );
  },
};

export const HalfStars: Story = {
  render: () => {
    const [rating, setRating] = React.useState<number>(3.5);
    return (
      <div className="space-y-2">
        <Rating value={rating} onValueChange={setRating} allowHalf={true} />
        <p className="text-sm text-muted-foreground">Rating: {rating}/5 stars</p>
      </div>
    );
  },
};
