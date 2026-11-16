import type { NotificationType } from '@repo/shared/schemas';

/** What a producer asks NotificationsService.notify to deliver. */
export interface INotificationInput {
  readonly type: NotificationType;
  readonly title: string;
  readonly message: string;
}

/**
 * Job-data contract for the notification-dispatch queue. The worker persists
 * the notification row for `userId` FIRST (Postgres is the source of truth
 * for the bell) and only then emits the socket event, so a crash between the
 * two is healed by the retry, never lost.
 */
export interface INotificationDispatchJobData {
  readonly userId: string;
  readonly notification: INotificationInput;
}
