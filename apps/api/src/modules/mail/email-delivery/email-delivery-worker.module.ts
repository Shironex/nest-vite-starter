import { Module } from '@nestjs/common';
import { EmailTransportModule } from '../email-transport.module';
import { EmailDeliveryModule } from './email-delivery.module';
import { EmailDeliveryProcessor } from './email-delivery.processor';

/**
 * The consumer half of the email-delivery queue: the processor plus the
 * renderer and transport it sends through. Registering `EmailDeliveryProcessor`
 * is what starts a BullMQ worker, so this module is imported only by a process
 * that consumes the queue: the api through `inlineQueueWorker(...)` (unless
 * `QUEUE_WORKER=off`), and the standalone worker (`src/worker.module.ts`).
 */
@Module({
  imports: [EmailTransportModule, EmailDeliveryModule],
  providers: [EmailDeliveryProcessor],
})
export class EmailDeliveryWorkerModule {}
