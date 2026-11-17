import { BullModule } from '@nestjs/bullmq';
import type { DynamicModule } from '@nestjs/common';

import type { IQueueDefaults, QueueName } from './queue.constants';

/**
 * The only way a queue is registered in this codebase.
 *
 * `BullModule.registerQueue({ name })` takes `defaultJobOptions` as an optional
 * field, so a registration that forgets it compiles and ships a queue with
 * BullMQ's defaults: one attempt, and completed/failed sets that grow forever.
 * Taking the whole `IQueueDefaults` object as a required argument makes the
 * retry and retention policy part of registering the queue rather than
 * something a module remembers to spread in, and `IQueueDefaults` in turn makes
 * attempts, backoff and both retention bounds required fields.
 *
 * `concurrency` is not passed here: BullMQ keeps it on the worker, so it is read
 * off the same defaults object by the `@Processor(name, { concurrency })`
 * decorator. Both sides taking their half from one constant is what keeps a
 * queue's producer and consumer policy in one file.
 *
 * Do not call `BullModule.registerQueue(` outside this folder.
 */
export function registerQueueWithDefaults(
  name: QueueName,
  defaults: IQueueDefaults,
): DynamicModule {
  return BullModule.registerQueue({ name, defaultJobOptions: defaults.jobOptions });
}
