import type { ComponentPropsWithRef } from 'react';
import type { NotificationItemOutput } from '@repo/shared/schemas';

/**
 * Button props are accepted and spread so the item can be slotted as a Radix
 * DropdownMenuItem (asChild): without that, rows inside the bell menu are
 * unreachable by keyboard (the menu traps Tab and only visits menu items).
 */
export interface INotificationItemProps extends ComponentPropsWithRef<'button'> {
  readonly notification: NotificationItemOutput;
}
