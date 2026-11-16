import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@repo/ui/lib/utils';
import { useNotificationItem } from './NotificationItem.hooks';
import type { INotificationItemProps } from './NotificationItem.types';

// The palette has success, warning and danger stems but no info stem,
// so info borrows the brand blue rather than growing the token layer for a
// single icon. Brand is the color the design already uses for neutral,
// non-alarming emphasis (chart-1, links, the active nav pill), and it carries
// a light and a dark value, which a raw blue-500 did not.
const TYPE_CONFIG = {
  info: { icon: Info, color: 'text-brand-ink' },
  success: { icon: CheckCircle2, color: 'text-success' },
  warning: { icon: AlertTriangle, color: 'text-warning' },
  error: { icon: XCircle, color: 'text-danger' },
} as const;

export default function NotificationItem({
  notification,
  className,
  onClick,
  ...rest
}: INotificationItemProps) {
  const { t } = useTranslation();
  const config = TYPE_CONFIG[notification.type];
  const Icon = config.icon;
  const { handleClick, relativeTime } = useNotificationItem(notification);

  return (
    <button
      type="button"
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        handleClick();
      }}
      className={cn(
        'flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left type-body-regular transition-colors hover:bg-hover',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        notification.read && 'opacity-60',
        className,
      )}
    >
      <span className="sr-only">
        {notification.read
          ? t('notifications.itemRead', { type: notification.type })
          : t('notifications.itemUnread', { type: notification.type })}
      </span>
      <Icon className={cn('mt-0.5 size-4 shrink-0', config.color)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate type-body-medium text-text">{notification.title}</span>
          {!notification.read && <span className="size-1.5 shrink-0 rounded-full bg-brand" />}
        </div>
        {/*
         * Two lines, not one. Every message in the seed is a sentence carrying
         * a date and a company name ("Deadline passes on 12/24/2026 (Acme
         * Holdings..."), and a single truncated line cut every one of them before the
         * fact the reader opened the panel for.
         */}
        <p className="line-clamp-2 type-body-small text-text-muted">{notification.message}</p>
        <p className="mt-0.5 type-label-caption text-text-tertiary">{relativeTime}</p>
      </div>
    </button>
  );
}
