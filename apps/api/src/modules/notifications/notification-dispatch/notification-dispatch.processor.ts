import { Processor } from '@nestjs/bullmq';
import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import type { NotificationPayload } from '@repo/shared/events';
import { TracedWorkerHost } from '../../../common/queue/traced-worker.host';
import { parseJobData } from '../../../common/queue/job-payload';
import { getRequestContext } from '../../../common/context/request-context';
import { EventsService } from '../../events/events.service';
import { NotificationsRepository } from '../notifications.repository';
import {
  NOTIFICATION_DISPATCH_DEFAULTS,
  NOTIFICATION_DISPATCH_JOB_NAMES,
  NOTIFICATION_DISPATCH_QUEUE_NAME,
} from './notification-dispatch.constants';
import { notificationDispatchJobSchema } from './notification-dispatch.schemas';

/**
 * Consumer for the notification-dispatch queue. Persist FIRST, emit SECOND:
 * the Notification row in Postgres is the source of truth for the bell, and
 * the Socket.io event is best-effort delivery on top of it. A crash between
 * the two steps is healed by the BullMQ retry.
 *
 * Retry idempotency: the row carries the BullMQ-assigned job id in its
 * uniquely-indexed `jobId` column, so a retried attempt finds the row the
 * first attempt persisted and only re-emits; it can never insert a
 * duplicate. tenantId comes from the ALS context TracedWorkerHost rebuilds
 * from the producer's `withJobContext` envelope (null for system producers
 * outside a tenant context).
 */
@Processor(NOTIFICATION_DISPATCH_QUEUE_NAME, {
  concurrency: NOTIFICATION_DISPATCH_DEFAULTS.concurrency,
})
export class NotificationDispatchProcessor extends TracedWorkerHost {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    private readonly eventsService: EventsService,
  ) {
    super();
  }

  async processJob(job: Job): Promise<void> {
    switch (job.name) {
      case NOTIFICATION_DISPATCH_JOB_NAMES.DISPATCH: {
        const { userId, notification } = parseJobData(notificationDispatchJobSchema, job);

        const jobId = job.id ?? null;
        const existing = jobId ? await this.notificationsRepository.findByJobId(jobId) : null;
        const row =
          existing ??
          (await this.notificationsRepository.create({
            userId,
            tenantId: getRequestContext()?.tenantId ?? null,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            jobId,
          }));

        // Emit AFTER the commit so the socket payload always references a row
        // the bell can hydrate. id/timestamp come from the row, so a client
        // that got the live event and one that refreshed see the same item.
        const payload: NotificationPayload = {
          id: row.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          timestamp: row.createdAt.getTime(),
        };
        this.eventsService.notifyUser(userId, payload);
        return;
      }
      default:
        // Retrying an unknown name can never succeed: fail straight to the DLQ.
        throw new UnrecoverableError(`Unknown notification-dispatch job name: ${job.name}`);
    }
  }
}
