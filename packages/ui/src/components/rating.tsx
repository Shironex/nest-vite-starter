'use client';

import * as React from 'react';
import { StarIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@repo/ui/lib/utils';

const ratingVariants = cva('inline-flex gap-1', {
  variants: {
    size: {
      sm: '[&_svg]:h-3 [&_svg]:w-3',
      md: '[&_svg]:h-4 [&_svg]:w-4',
      lg: '[&_svg]:h-6 [&_svg]:w-6',
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

interface IRatingProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof ratingVariants> {
  value?: number;
  onValueChange?: (value: number) => void;
  maxStars?: number;
  readonly?: boolean;
  allowHalf?: boolean;
  icon?: React.ReactNode;
  emptyIcon?: React.ReactNode;
}

const Rating = React.forwardRef<HTMLDivElement, IRatingProps>(
  (
    {
      className,
      value = 0,
      onValueChange,
      maxStars = 5,
      readonly = false,
      allowHalf = false,
      size = 'md',
      icon,
      emptyIcon,
      ...props
    },
    ref,
  ) => {
    const [hoverValue, setHoverValue] = React.useState<number | null>(null);
    const [tempValue, setTempValue] = React.useState(value);

    const displayValue = hoverValue !== null ? hoverValue : tempValue;

    const handleMouseMove = (starIndex: number, e: React.MouseEvent<HTMLButtonElement>) => {
      if (readonly) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;

      let newValue = starIndex + 1;

      if (allowHalf && x < rect.width / 2) {
        newValue = starIndex + 0.5;
      }

      setHoverValue(newValue);
    };

    const handleClick = (starIndex: number, e: React.MouseEvent<HTMLButtonElement>) => {
      if (readonly) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;

      let newValue = starIndex + 1;

      if (allowHalf && x < rect.width / 2) {
        newValue = starIndex + 0.5;
      }

      setTempValue(newValue);
      onValueChange?.(newValue);
    };

    const handleMouseLeave = () => {
      setHoverValue(null);
    };

    return (
      <div
        ref={ref}
        className={cn(ratingVariants({ size, className }))}
        data-slot="rating"
        {...props}
      >
        {Array.from({ length: maxStars }).map((_, index) => {
          const isFilled = displayValue >= index + 1;
          const isHalf = displayValue === index + 0.5;

          return (
            <button
              key={index}
              type="button"
              onMouseMove={(e) => handleMouseMove(index, e)}
              onClick={(e) => handleClick(index, e)}
              onMouseLeave={handleMouseLeave}
              disabled={readonly}
              className={cn(
                'cursor-pointer transition-colors disabled:cursor-default',
                readonly && 'pointer-events-none',
              )}
              aria-label={`Rate ${index + 1} stars`}
            >
              {isFilled ? (
                icon ? (
                  <div className="text-primary">{icon}</div>
                ) : (
                  <StarIcon className="fill-primary text-primary" />
                )
              ) : isHalf ? (
                <div className="relative inline-block">
                  {icon ? (
                    <div className="text-muted-foreground/30">{icon}</div>
                  ) : (
                    <StarIcon className="text-muted-foreground/30" />
                  )}
                  <div className="absolute inset-0 overflow-hidden" style={{ width: '50%' }}>
                    {icon ? (
                      <div className="text-primary">{icon}</div>
                    ) : (
                      <StarIcon className="fill-primary text-primary" />
                    )}
                  </div>
                </div>
              ) : emptyIcon ? (
                <div className="text-muted-foreground/30">{emptyIcon}</div>
              ) : (
                <StarIcon className="text-muted-foreground/30" />
              )}
            </button>
          );
        })}
      </div>
    );
  },
);

Rating.displayName = 'Rating';

export { Rating, ratingVariants, type IRatingProps };
