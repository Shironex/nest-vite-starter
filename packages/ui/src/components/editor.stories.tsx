import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Editor } from './editor';

const meta = {
  title: 'Components/Editor',
  component: Editor,
  tags: ['autodocs'],
} satisfies Meta<typeof Editor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = React.useState('');
    return <Editor value={value} onChange={setValue} />;
  },
};

export const WithContent: Story = {
  render: () => {
    const [value, setValue] = React.useState(
      '<h2>Project Proposal</h2><p>This is a <strong>formatted</strong> document with various styles including <em>italic text</em> and <u>underlined</u> content.</p><ul><li>Requirement 1</li><li>Requirement 2</li><li>Requirement 3</li></ul><blockquote>Important note about the project timeline</blockquote>',
    );
    return <Editor value={value} onChange={setValue} />;
  },
};

export const ReadOnly: Story = {
  render: () => {
    const content =
      '<h2>Financial Report Q1 2026</h2><p>Total Revenue: <strong>$2.5M</strong></p><p>Expenses breakdown:</p><ol><li>Salaries: $1.2M</li><li>Operations: $600K</li><li>Marketing: $400K</li></ol>';
    return <Editor value={content} onChange={() => {}} contentClassName="pointer-events-none" />;
  },
};
