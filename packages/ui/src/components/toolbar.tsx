'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@repo/ui/lib/utils';
import { Button } from '@repo/ui/button';

const toolbarVariants = cva(
  'flex items-center gap-1 rounded-lg border bg-background p-1 shadow-xs',
  {
    variants: {
      variant: {
        default: 'border-input',
        ghost: 'border-transparent bg-transparent shadow-none',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

interface IToolbarProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof toolbarVariants> {}

const Toolbar = React.forwardRef<HTMLDivElement, IToolbarProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toolbar"
      data-variant={variant}
      className={cn(toolbarVariants({ variant, className }))}
      role="toolbar"
      {...props}
    />
  ),
);
Toolbar.displayName = 'Toolbar';

type ToolbarButtonProps = React.ComponentProps<typeof Button>;

const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ className, variant = 'ghost', size = 'sm', ...props }, ref) => (
    <Button
      ref={ref}
      data-slot="toolbar-button"
      variant={variant}
      size={size}
      className={cn('h-8 px-2', className)}
      {...props}
    />
  ),
);
ToolbarButton.displayName = 'ToolbarButton';

type ToolbarSeparatorProps = React.HTMLAttributes<HTMLDivElement>;

const ToolbarSeparator = React.forwardRef<HTMLDivElement, ToolbarSeparatorProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toolbar-separator"
      className={cn('my-1 h-4 w-px bg-border', className)}
      {...props}
    />
  ),
);
ToolbarSeparator.displayName = 'ToolbarSeparator';

type ToolbarGroupProps = React.HTMLAttributes<HTMLDivElement>;

const ToolbarGroup = React.forwardRef<HTMLDivElement, ToolbarGroupProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toolbar-group"
      className={cn('flex items-center gap-1', className)}
      {...props}
    />
  ),
);
ToolbarGroup.displayName = 'ToolbarGroup';

interface IToolbarToggleProps extends Omit<React.ComponentProps<typeof Button>, 'onClick'> {
  pressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
}

const ToolbarToggle = React.forwardRef<HTMLButtonElement, IToolbarToggleProps>(
  (
    { className, variant = 'ghost', size = 'sm', pressed = false, onPressedChange, ...props },
    ref,
  ) => (
    <Button
      ref={ref}
      data-slot="toolbar-toggle"
      data-state={pressed ? 'on' : 'off'}
      variant={pressed ? 'default' : variant}
      size={size}
      className={cn(
        'h-8 px-2 transition-colors',
        pressed && 'bg-primary text-primary-foreground',
        className,
      )}
      onClick={() => {
        onPressedChange?.(!pressed);
      }}
      {...props}
    />
  ),
);
ToolbarToggle.displayName = 'ToolbarToggle';

export {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  ToolbarGroup,
  ToolbarToggle,
  toolbarVariants,
  type IToolbarProps,
};
