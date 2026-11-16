import { Module } from '@nestjs/common';
import { EventsModule } from '../../events/events.module';
import { NotificationsModule } from '../notifications.module';
import { NotificationDispatchProcessor } from './notification-dispatch.processor';
import { NotificationDispatchQueueModule } from './notification-dispatch-queue.module';

/**
 * Consumer side of the notification-dispatch queue. A SINK in the module
 * graph (only AppModule and QueueObservabilityModule import it), which is
 * what lets the processor depend on EventsModule (socket emit after persist)
 * while EventsModule depends on NotificationsModule (the gateway's dev
 * test-notification trigger) without a cycle. The queue registration itself
 * lives in NotificationDispatchQueueModule so the producer side shares it
 * without touching this module.
 *
 * Re-exports the queue module so the observability layer keeps injecting the
 * queue for depth metrics through this module, same surface as before.
 */
@Module({
  imports: [NotificationDispatchQueueModule, NotificationsModule, EventsModule],
  providers: [NotificationDispatchProcessor],
  exports: [NotificationDispatchQueueModule],
})
export class NotificationDispatchModule {}
