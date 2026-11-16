'use client';

import * as React from 'react';
import { formatDistanceToNow, format, type Locale } from 'date-fns';

import { cn } from '@repo/ui/lib/utils';

interface IRelativeTimeProps extends React.HTMLAttributes<HTMLTimeElement> {
  date: Date | string | number;
  locale?: Locale;
  addSuffix?: boolean;
  showTooltip?: boolean;
  tooltipFormat?: string;
}

const getUpdateInterval = (date: Date): number => {
  const now = new Date();
  const diffMs = Math.abs(now.getTime() - date.getTime());
  const diffMins = Math.floor(diffMs / (1000 * 60));

  // Update every second for first minute
  if (diffMins < 1) return 1000;
  // Every minute for first hour
  if (diffMins < 60) return 60000;
  // Every 5 minutes for first day
  if (diffMins < 1440) return 5 * 60000;
  // Every hour after that
  return 60 * 60000;
};

const RelativeTime = React.forwardRef<HTMLTimeElement, IRelativeTimeProps>(
  (
    {
      className,
      date,
      locale,
      addSuffix = true,
      showTooltip = true,
      tooltipFormat = 'PPpp',
      ...props
    },
    ref,
  ) => {
    const dateObj = React.useMemo(() => new Date(date), [date]);

    const [displayText, setDisplayText] = React.useState<string>('');
    const [tooltipText, setTooltipText] = React.useState<string>('');
    const timerRef = React.useRef<ReturnType<typeof setInterval>>(undefined);

    const updateDisplay = React.useCallback(() => {
      try {
        const relativeText = formatDistanceToNow(dateObj, {
          addSuffix,
          ...(locale ? { locale } : {}),
        });
        setDisplayText(relativeText);

        if (showTooltip) {
          const fullText = format(dateObj, tooltipFormat, {
            ...(locale ? { locale } : {}),
          });
          setTooltipText(fullText);
        }
      } catch (error) {
        console.error('Error formatting date:', error);
        setDisplayText(dateObj.toLocaleString());
      }
    }, [dateObj, addSuffix, locale, showTooltip, tooltipFormat]);

    React.useEffect(() => {
      updateDisplay();

      const interval = getUpdateInterval(dateObj);
      timerRef.current = setInterval(updateDisplay, interval);

      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };
    }, [updateDisplay, dateObj]);

    const isoString = dateObj.toISOString();

    return (
      <time
        ref={ref}
        dateTime={isoString}
        data-slot="relative-time"
        className={cn(
          'inline-block',
          showTooltip && 'cursor-help border-b border-dotted border-muted-foreground/50',
          className,
        )}
        title={showTooltip ? tooltipText : undefined}
        {...props}
      >
        {displayText}
      </time>
    );
  },
);
RelativeTime.displayName = 'RelativeTime';

export { RelativeTime, type IRelativeTimeProps };
