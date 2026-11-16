import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { TagsInput } from './tags-input';

const meta = {
  title: 'Components/TagsInput',
  component: TagsInput,
  tags: ['autodocs'],
} satisfies Meta<typeof TagsInput>;

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => {
    const [tags, setTags] = React.useState<string[]>([]);
    return <TagsInput value={tags} onChange={setTags} />;
  },
};

export const WithTags: Story = {
  render: () => {
    const [tags, setTags] = React.useState<string[]>(['Urgent', 'Finance', 'Q1']);
    return <TagsInput value={tags} onChange={setTags} />;
  },
};

export const WithMaxTags: Story = {
  render: () => {
    const [tags, setTags] = React.useState<string[]>(['Budget', '2026']);
    return (
      <div className="space-y-2">
        <TagsInput value={tags} onChange={setTags} maxTags={5} />
        <p className="text-xs text-muted-foreground">Maximum 5 tags allowed</p>
      </div>
    );
  },
};
