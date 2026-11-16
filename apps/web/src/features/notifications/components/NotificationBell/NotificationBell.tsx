import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@repo/ui/button';
import { Skeleton } from '@repo/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/dropdown-menu';
import { NotificationItem } from '@/features/notifications/components/NotificationItem';
import { useNotificationBell } from './NotificationBell.hooks';

// Static first-load placeholders shaped like a NotificationItem row (icon +
// title/message lines), per the sibling skeleton-on-first-load convention.
const loadingRowItems = [0, 1, 2].map((row) => (
  <div key={row} className="flex items-start gap-3 py-2">
    <Skeleton className="mt-0.5 size-4 shrink-0 rounded-full" />
    <div className="flex-1 space-y-1.5">
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  </div>
));

export default function NotificationBell() {
  const { t } = useTranslation();
  const { notifications, badgeLabel, ariaLabel, isEmpty, isLoading, hasUnread, onMarkAllAsRead } =
    useNotificationBell();

  const loadingRows = (
    <div role="status" aria-label={t('notifications.loading')} className="space-y-1 px-3 py-2">
      {loadingRowItems}
    </div>
  );

  // Rows must be Radix menu items (asChild) or the menu's keyboard model
  // skips them entirely: it traps Tab and arrow-navigates only registered
  // items. onSelect preventDefault keeps the menu open (matching the mouse
  // behavior of the plain buttons), so several rows can be read in one visit.
  const items = notifications.map((notification) => (
    <DropdownMenuItem key={notification.id} asChild onSelect={(event) => event.preventDefault()}>
      <NotificationItem notification={notification} />
    </DropdownMenuItem>
  ));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative">
          <Bell className="size-4" />
          {hasUnread && (
            // type-label-overline is the ramp's smallest entry (11px/600) and the
            // only one that fits the 16px dot without shrinking the count; its
            // uppercasing is a no-op for a label that is only ever digits or 9+.
            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-brand type-label-overline text-brand-fg">
              {badgeLabel}
            </span>
          )}
          <span className="sr-only">{ariaLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      {/*
       * 416px, not 320px. The original translation of "Mark all as read" was 33
       * characters and measured 239px wide beside a 110px title in a 320px
       * menu, so it overflowed its own container by 47px and was hard-clipped
       * mid-word by the popover's overflow. The design draws this
       * panel wider than a menu for exactly that reason, with the mark-all
       * action as a brand-coloured text link rather than a button, which is
       * what stops the header competing with the rows underneath it.
       */}
      <DropdownMenuContent align="end" className="relative w-104 p-0" sideOffset={8}>
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <DropdownMenuLabel className="p-0 type-body-strong text-text">
            {t('notifications.title')}
          </DropdownMenuLabel>
          {hasUnread && (
            <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
              <Button
                variant="link"
                size="xs"
                onClick={onMarkAllAsRead}
                className="h-auto shrink-0 p-0 type-label-caption text-brand-ink hover:text-brand-ink-hover"
              >
                {t('notifications.markAllRead')}
              </Button>
            </DropdownMenuItem>
          )}
        </div>
        <DropdownMenuSeparator className="m-0" />
        {/*
         * Taller, and the fade is a scroll AFFORDANCE: `max-h-72` cut the last
         * row mid-line with nothing on screen saying there was more below it.
         */}
        <div className="relative max-h-104 overflow-y-auto p-1">
          {isLoading ? (
            loadingRows
          ) : isEmpty ? (
            <p className="py-6 text-center type-body-regular text-text-muted">
              {t('notifications.empty')}
            </p>
          ) : (
            items
          )}
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6 rounded-b-md bg-gradient-to-t from-surface to-transparent"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
