import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { registerQueueWithDefaults } from '../../../common/queue';
import { EMAIL_DELIVERY_DEFAULTS, EMAIL_DELIVERY_QUEUE_NAME } from './email-delivery.constants';

/**
 * The producer half of the email-delivery queue, and the canonical per-queue
 * convention reference: one folder (`.constants` / `.types` / `.processor` /
 * `.module`), retry policy pinned once via `defaultJobOptions`.
 *
 * Registration happens HERE only (a single `registerQueueWithDefaults` call).
 * `exports: [BullModule]` re-exports the queue provider so the producer
 * (`MailService` in `MailModule`), the worker module and the observability
 * layer all `@InjectQueue` the same instance. The consumer lives in
 * `EmailDeliveryWorkerModule`, so a process that does not run workers
 * (`QUEUE_WORKER=off`) still enqueues.
 */
@Module({
  imports: [registerQueueWithDefaults(EMAIL_DELIVERY_QUEUE_NAME, EMAIL_DELIVERY_DEFAULTS)],
  exports: [BullModule],
})
export class EmailDeliveryModule {}
