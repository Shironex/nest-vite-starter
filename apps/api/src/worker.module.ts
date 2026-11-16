import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validationSchema } from './config/configuration.config';
import { QueueModule } from './common/queue/queue.module';
import { CustomLogger } from './modules/logger/logger.service';
import { EmailDeliveryWorkerModule } from './modules/mail/email-delivery/email-delivery-worker.module';

/**
 * The standalone worker process (`src/worker.ts`): every queue consumer and
 * nothing else. No HTTP server, no database client, no schedulers. Run it
 * beside an api started with `QUEUE_WORKER=off`; with the default
 * `QUEUE_WORKER=inline` the api consumes the queues itself and this process is
 * not needed.
 *
 * Add a queue's worker module here and to AppModule's `inlineQueueWorker(...)`
 * imports together.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema, envFilePath: '.env' }),
    QueueModule,
    EmailDeliveryWorkerModule,
  ],
  providers: [CustomLogger],
})
export class WorkerModule {}
