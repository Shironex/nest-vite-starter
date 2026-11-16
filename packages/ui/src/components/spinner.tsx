'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@repo/ui/lib/utils';
import { useUiLabels } from '@repo/ui/ui-labels';

const spinnerVariants = cva('inline-flex flex-col items-center justify-center', {
  variants: {
    variant: {
      default: '',
      dots: '',
      bars: '',
      pulse: '',
    },
    size: {
      xs: 'size-3 [&>*]:size-0.5',
      sm: 'size-4 [&>*]:size-1',
      md: 'size-6 [&>*]:size-1.5',
      lg: 'size-8 [&>*]:size-2',
      xl: 'size-10 [&>*]:size-2.5',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

interface ISpinnerProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof spinnerVariants> {
  label?: string;
  color?: string;
}

const Spinner = React.forwardRef<HTMLDivElement, ISpinnerProps>(
  (
    { className, variant = 'default', size = 'md', label, color = 'currentColor', ...props },
    ref,
  ) => {
    const labels = useUiLabels();
    const sizeMap = {
      xs: 'h-3 w-3',
      sm: 'h-4 w-4',
      md: 'h-6 w-6',
      lg: 'h-8 w-8',
      xl: 'h-10 w-10',
    };

    const renderSpinner = () => {
      if (variant === 'dots') {
        return (
          <div className="flex items-center justify-center gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={cn(sizeMap[size as keyof typeof sizeMap], 'rounded-full')}
                style={{
                  backgroundColor: color,
                  animation: `bounce 1.4s infinite ease-in-out`,
                  animationDelay: `${i * 0.16}s`,
                }}
              />
            ))}
          </div>
        );
      }

      if (variant === 'bars') {
        return (
          <div
            className={cn(
              'flex items-end justify-center gap-1',
              sizeMap[size as keyof typeof sizeMap],
            )}
          >
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="w-1 rounded-sm"
                style={{
                  height: '100%',
                  backgroundColor: color,
                  animation: `grow 1s ease-in-out infinite`,
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
        );
      }

      if (variant === 'pulse') {
        return (
          <div
            className={cn(sizeMap[size as keyof typeof sizeMap], 'rounded-full')}
            style={{
              backgroundColor: color,
              animation: 'pulse 2s ease-in-out infinite',
            }}
          />
        );
      }

      // default: circular spinner
      return (
        <div
          className={cn(sizeMap[size as keyof typeof sizeMap], 'relative')}
          style={{
            animation: 'spin 1s linear infinite',
          }}
        >
          <div
            className="absolute inset-0 rounded-full border-2 border-transparent"
            style={{
              borderTopColor: color,
              borderRightColor: color,
            }}
          />
        </div>
      );
    };

    return (
      <div
        ref={ref}
        role="status"
        data-slot="spinner"
        data-variant={variant}
        data-size={size}
        className={cn('flex flex-col items-center gap-2', className)}
        {...props}
      >
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          @keyframes bounce {
            0%, 100% { opacity: 0.3; transform: translateY(0); }
            50% { opacity: 1; transform: translateY(-0.5rem); }
          }
          @keyframes grow {
            0%, 100% { transform: scaleY(0.5); }
            50% { transform: scaleY(1); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
        {renderSpinner()}
        {label ? (
          <span className="type-label-caption text-muted-foreground">{label}</span>
        ) : (
          <span className="sr-only">{labels.loading}</span>
        )}
      </div>
    );
  },
);
Spinner.displayName = 'Spinner';

export { Spinner, spinnerVariants, type ISpinnerProps };
