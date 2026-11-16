import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { registerQueueWithDefaults } from '../../../common/queue';
import { EmailTransportModule } from '../email-transport.module';
import { EMAIL_DELIVERY_DEFAULTS, EMAIL_DELIVERY_QUEUE_NAME } from './email-delivery.constants';
import { EmailDeliveryProcessor } from './email-delivery.processor';

/**
 * The first real queue and the canonical per-queue convention reference:
 * one folder (`.constants` / `.types` / `.processor` / `.module`), retry policy
 * pinned once via `defaultJobOptions`, processor extends `TracedWorkerHost`.
 *
 * Registration happens HERE only (a single `registerQueueWithDefaults` call).
 * `exports: [BullModule]` re-exports the queue provider so the producer
 * (`MailService` in `MailModule`) and the observability layer can `@InjectQueue`
 * the same instance.
 */
@Module({
  imports: [
    EmailTransportModule,
    registerQueueWithDefaults(EMAIL_DELIVERY_QUEUE_NAME, EMAIL_DELIVERY_DEFAULTS),
  ],
  providers: [EmailDeliveryProcessor],
  exports: [BullModule],
})
export class EmailDeliveryModule {}
