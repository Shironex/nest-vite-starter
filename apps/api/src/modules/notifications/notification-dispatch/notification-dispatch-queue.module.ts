import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { registerQueueWithDefaults } from '../../../common/queue';
import {
  NOTIFICATION_DISPATCH_DEFAULTS,
  NOTIFICATION_DISPATCH_QUEUE_NAME,
} from './notification-dispatch.constants';

/**
 * Queue registration ONLY, split from the processor so producer and consumer
 * sides can depend on the queue without depending on each other. This is what
 * keeps the module graph acyclic: the processor needs EventsService (to emit
 * after persisting) and EventsModule needs NotificationsService (the gateway's
 * dev test-notification trigger). If the producer got the queue by importing
 * the processor's module, that would close the cycle
 * EventsModule -> NotificationsModule -> NotificationDispatchModule ->
 * EventsModule. Both sides import this leaf instead.
 */
@Module({
  imports: [
    registerQueueWithDefaults(NOTIFICATION_DISPATCH_QUEUE_NAME, NOTIFICATION_DISPATCH_DEFAULTS),
  ],
  exports: [BullModule],
})
export class NotificationDispatchQueueModule {}
