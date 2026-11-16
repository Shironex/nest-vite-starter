import { getQueueToken } from '@nestjs/bullmq';
import type { ModuleRef } from '@nestjs/core';
import type { Queue } from 'bullmq';
import { QueueMetricsService } from './queue-metrics.service';
import { QUEUE_NAMES } from './queue.constants';
import { queueJobsFailed } from './queue.metrics';

const makeQueue = (
  name: string,
  counts: Record<string, number> | Error,
): jest.Mocked<Pick<Queue, 'name' | 'getJobCounts'>> =>
  ({
    name,
    getJobCounts: jest.fn(() =>
      counts instanceof Error ? Promise.reject(counts) : Promise.resolve(counts),
    ),
  }) as unknown as jest.Mocked<Pick<Queue, 'name' | 'getJobCounts'>>;

const idle = { waiting: 0, active: 0, failed: 0, delayed: 0 };

/**
 * A container that answers `getQueueToken(name)` for the given queues and
 * throws (as Nest's own injector does) for anything else.
 */
const containerWith = (
  queues: readonly jest.Mocked<Pick<Queue, 'name' | 'getJobCounts'>>[],
): ModuleRef => {
  const byToken = new Map(queues.map((queue) => [getQueueToken(queue.name), queue]));
  return {
    get: jest.fn((token: unknown) => {
      const found = byToken.get(token as string);
      if (!found) throw new Error(`Nest could not find ${String(token)}`);
      return found;
    }),
  } as unknown as ModuleRef;
};

/** Every queue the registry declares, all idle. */
const allQueuesIdle = () => Object.values(QUEUE_NAMES).map((name) => makeQueue(name, { ...idle }));

const boot = (queues: readonly jest.Mocked<Pick<Queue, 'name' | 'getJobCounts'>>[]) => {
  const service = new QueueMetricsService(containerWith(queues));
  service.onModuleInit();
  return service;
};

describe('QueueMetricsService resolution', () => {
  it('scrapes EVERY queue in QUEUE_NAMES, not a hand-written subset', async () => {
    // A queue absent from the scrape has no gauges AND sits outside the DLQ
    // alarm, because the health indicator reads these same snapshots, so its
    // jobs can stop moving with nothing anywhere saying so.
    const service = boot(allQueuesIdle());

    await service.collect();

    for (const name of Object.values(QUEUE_NAMES)) {
      expect(service.getSnapshot(name)).toEqual(idle);
    }
  });

  it('fails the boot when a declared queue was never registered', () => {
    // Silently skipping it would re-open the same blind spot, and the symptom
    // (a queue nobody watches) surfaces only when its jobs start failing.
    const missing = QUEUE_NAMES.TWO_FACTOR_ENFORCEMENT;
    const partial = allQueuesIdle().filter((queue) => queue.name !== missing);

    const service = new QueueMetricsService(containerWith(partial));

    expect(() => service.onModuleInit()).toThrow(new RegExp(`Queue "${missing}" is declared`));
  });
});

describe('QueueMetricsService.collect', () => {
  let failedSetSpy: jest.SpyInstance;

  beforeEach(() => {
    failedSetSpy = jest.spyOn(queueJobsFailed, 'set').mockImplementation(() => undefined);
  });

  afterEach(() => failedSetSpy.mockRestore());

  it('caches a snapshot and sets the failed gauge per queue', async () => {
    const service = boot([
      makeQueue(QUEUE_NAMES.EMAIL_DELIVERY, { waiting: 2, active: 1, failed: 3, delayed: 0 }),
      makeQueue(QUEUE_NAMES.NOTIFICATION_DISPATCH, { ...idle }),
      makeQueue(QUEUE_NAMES.TWO_FACTOR_ENFORCEMENT, { ...idle }),
    ]);

    await service.collect();

    expect(service.getSnapshot(QUEUE_NAMES.EMAIL_DELIVERY)).toEqual({
      waiting: 2,
      active: 1,
      failed: 3,
      delayed: 0,
    });
    expect(failedSetSpy).toHaveBeenCalledWith({ queue: QUEUE_NAMES.EMAIL_DELIVERY }, 3);
  });

  it('is best-effort: a getJobCounts failure does not throw and leaves other queues collectable', async () => {
    const service = boot([
      makeQueue(QUEUE_NAMES.EMAIL_DELIVERY, new Error('redis down')),
      makeQueue(QUEUE_NAMES.NOTIFICATION_DISPATCH, {
        waiting: 1,
        active: 0,
        failed: 0,
        delayed: 0,
      }),
      makeQueue(QUEUE_NAMES.TWO_FACTOR_ENFORCEMENT, { ...idle }),
    ]);

    await expect(service.collect()).resolves.toBeUndefined();
    expect(service.getSnapshot(QUEUE_NAMES.EMAIL_DELIVERY)).toBeUndefined();
    expect(service.getSnapshot(QUEUE_NAMES.NOTIFICATION_DISPATCH)).toEqual({
      waiting: 1,
      active: 0,
      failed: 0,
      delayed: 0,
    });
  });
});
