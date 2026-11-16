import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { ColorPicker } from './color-picker';
import { Popover, PopoverTrigger, PopoverContent } from './popover';
import { Button } from './button';

const meta = {
  title: 'Components/ColorPicker',
  component: ColorPicker,
  tags: ['autodocs'],
} satisfies Meta<typeof ColorPicker>;

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => {
    const [color, setColor] = React.useState('#3b82f6ff');
    return (
      <div className="w-64">
        <ColorPicker value={color} onValueChange={setColor} />
        <p className="mt-2 text-sm text-muted-foreground">Selected: {color}</p>
      </div>
    );
  },
};

export const WithPresets: Story = {
  render: () => {
    const [color, setColor] = React.useState('#3b82f6ff');

    const erpPresets = [
      '#3b82f6ff', // Primary blue
      '#10b981ff', // Success green
      '#f59e0bff', // Warning amber
      '#ef4444ff', // Danger red
      '#8b5cf6ff', // Purple
      '#06b6d4ff', // Cyan
      '#1e293bff', // Slate
      '#ffffff00', // Transparent
    ];

    return (
      <div className="w-64">
        <ColorPicker value={color} onValueChange={setColor} presets={erpPresets} />
        <p className="mt-2 text-sm text-muted-foreground">Selected: {color}</p>
      </div>
    );
  },
};

export const InPopover: Story = {
  render: () => {
    const [color, setColor] = React.useState('#3b82f6ff');

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">Pick a color</Button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="start">
          <ColorPicker value={color} onValueChange={setColor} showAlpha={true} />
        </PopoverContent>
      </Popover>
    );
  },
};
