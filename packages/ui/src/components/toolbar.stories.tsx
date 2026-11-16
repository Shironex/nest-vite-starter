import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Toolbar, ToolbarButton, ToolbarSeparator, ToolbarGroup, ToolbarToggle } from './toolbar';
import { Plus, Edit2, Trash2, Download, List, Grid3x3 } from 'lucide-react';

const meta = {
  title: 'Components/Toolbar',
  component: Toolbar,
  tags: ['autodocs'],
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="p-8">
      <Toolbar>
        <ToolbarButton onClick={() => alert('New item')} title="Create new item">
          <Plus className="size-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => alert('Edit item')} title="Edit selected item">
          <Edit2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => alert('Delete item')} title="Delete selected item">
          <Trash2 className="size-4" />
        </ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton onClick={() => alert('Export data')} title="Export data">
          <Download className="size-4" />
        </ToolbarButton>
      </Toolbar>
    </div>
  ),
};

export const WithToggle: Story = {
  render: () => {
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

    return (
      <div className="space-y-4 p-8">
        <Toolbar>
          <ToolbarButton onClick={() => alert('New item')}>
            <Plus className="size-4" />
          </ToolbarButton>
          <ToolbarSeparator />
          <ToolbarToggle
            pressed={viewMode === 'list'}
            onPressedChange={() => setViewMode('list')}
            title="List view"
          >
            <List className="size-4" />
          </ToolbarToggle>
          <ToolbarToggle
            pressed={viewMode === 'grid'}
            onPressedChange={() => setViewMode('grid')}
            title="Grid view"
          >
            <Grid3x3 className="size-4" />
          </ToolbarToggle>
        </Toolbar>
        <p className="text-sm text-muted-foreground">
          Current view mode: <span className="font-semibold">{viewMode}</span>
        </p>
      </div>
    );
  },
};

export const WithGroups: Story = {
  render: () => (
    <div className="space-y-4 p-8">
      <Toolbar>
        <ToolbarGroup>
          <ToolbarButton onClick={() => alert('New')}>
            <Plus className="size-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => alert('Edit')}>
            <Edit2 className="size-4" />
          </ToolbarButton>
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup>
          <ToolbarButton onClick={() => alert('Delete')}>
            <Trash2 className="size-4" />
          </ToolbarButton>
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup>
          <ToolbarButton onClick={() => alert('Export')}>
            <Download className="size-4" />
          </ToolbarButton>
        </ToolbarGroup>
      </Toolbar>
      <p className="text-sm text-muted-foreground">
        Toolbar with grouped actions separated by dividers
      </p>
    </div>
  ),
};
