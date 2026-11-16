import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@repo/ui/tooltip';
import { cn } from '@repo/ui/lib/utils';
import { useConnectionIndicator } from './ConnectionIndicator.hooks';

export default function ConnectionIndicator() {
  const { t } = useTranslation();
  const { label, color } = useConnectionIndicator();
  const indicatorClass = cn('inline-block size-2 rounded-full', color);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/*
           * role="status" + sr-only text: an aria-label on a role-less span is
           * unreliably announced, and the live region announces state changes.
           * tabIndex 0 makes the tooltip reachable by keyboard (opens on focus).
           *
           * The LABEL is rendered beside the dot from `md:` up, because color
           * was the only thing separating the three states and a low-vision or
           * colour-blind reader had to hover to learn which one they were in.
           * Narrow viewports keep the dot alone and the tooltip carries it.
           */}
          <span
            role="status"
            tabIndex={0}
            className="inline-flex items-center gap-1.5 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <span aria-hidden="true" className={indicatorClass} />
            <span className="sr-only">{t('connection.status', { label })}</span>
            <span
              aria-hidden="true"
              className="hidden type-label-caption text-text-muted md:inline"
            >
              {label}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
