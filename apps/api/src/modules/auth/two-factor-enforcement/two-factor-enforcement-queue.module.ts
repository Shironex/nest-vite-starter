import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { registerQueueWithDefaults } from '../../../common/queue';
import {
  TWO_FACTOR_ENFORCEMENT_DEFAULTS,
  TWO_FACTOR_ENFORCEMENT_QUEUE_NAME,
} from './two-factor-enforcement.constants';

/**
 * Queue registration ONLY (the `registerQueueWithDefaults` call for this queue
 * lives here exactly once). Split from the processor/scheduler so the producer
 * (scheduler) and consumer (processor) sides share the same queue instance by
 * importing this leaf, without importing each other, the same split the
 * email-delivery and notification-dispatch folders use. `exports: [BullModule]`
 * re-exports the queue provider so `@InjectQueue(...)` resolves in whichever
 * module wires the processor + scheduler (AuthModule).
 */
@Module({
  imports: [
    registerQueueWithDefaults(TWO_FACTOR_ENFORCEMENT_QUEUE_NAME, TWO_FACTOR_ENFORCEMENT_DEFAULTS),
  ],
  exports: [BullModule],
})
export class TwoFactorEnforcementQueueModule {}
