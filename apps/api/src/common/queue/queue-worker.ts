import type { DynamicModule } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';

/**
 * Where the BullMQ workers run, read from `QUEUE_WORKER`:
 *
 *   - `inline` (the default): the api process runs them beside the HTTP server.
 *     One container, nothing else to deploy.
 *   - `off`: the api process only produces jobs, and a separate worker process
 *     (`pnpm --filter @repo/api start:worker`, entry `src/worker.ts`) consumes
 *     them. Use it when job load should not share a process with requests.
 *
 * Producers are unaffected either way: a queue is registered in both modes, so
 * `queue.add(...)` works whether or not this process consumes it.
 */
export const QUEUE_WORKER_MODES = ['inline', 'off'] as const;

export type QueueWorkerMode = (typeof QUEUE_WORKER_MODES)[number];

/** True unless `QUEUE_WORKER=off`. Unset means `inline`. */
export function runsInlineQueueWorker(env: NodeJS.ProcessEnv): boolean {
  return env['QUEUE_WORKER'] !== 'off';
}

/**
 * Import a module that provides `@Processor` classes only when this process
 * runs its workers inline. A processor provider that is not registered starts
 * no BullMQ worker, which is the whole switch.
 */
export function inlineQueueWorker(workerModule: DynamicModule['module']): Promise<DynamicModule> {
  return ConditionalModule.registerWhen(workerModule, runsInlineQueueWorker, { debug: false });
}
