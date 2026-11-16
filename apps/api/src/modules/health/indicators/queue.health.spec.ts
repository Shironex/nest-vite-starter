import { QueueHealthIndicator } from './queue.health';
import { QUEUE_FAILED_ALERT_THRESHOLD, QUEUE_NAMES } from '../../../common/queue/queue.constants';
import type {
  QueueMetricsService,
  IQueueCounts,
} from '../../../common/queue/queue-metrics.service';
import type { HealthIndicatorService } from '@nestjs/terminus';

const buildIndicator = (snapshots: Map<string, IQueueCounts>) => {
  const up = jest.fn((d: unknown) => ({ queue: { status: 'up', ...(d as object) } }));
  const down = jest.fn((d: unknown) => ({ queue: { status: 'down', ...(d as object) } }));
  const health = { check: jest.fn(() => ({ up, down })) } as unknown as HealthIndicatorService;
  const metrics = { getSnapshots: jest.fn(() => snapshots) } as unknown as QueueMetricsService;
  return { indicator: new QueueHealthIndicator(health, metrics), up, down };
};

const counts = (failed: number): IQueueCounts => ({ waiting: 0, active: 0, failed, delayed: 0 });

/** A snapshot map covering every declared queue, all at the given depth. */
const everyQueueAt = (failed: number) =>
  new Map(Object.values(QUEUE_NAMES).map((name) => [name, counts(failed)] as const));

describe('QueueHealthIndicator', () => {
  it('reports up when every queue is below the failed threshold', () => {
    const { indicator, up, down } = buildIndicator(everyQueueAt(QUEUE_FAILED_ALERT_THRESHOLD - 1));
    indicator.isHealthy('queue');
    expect(up).toHaveBeenCalledWith({
      failed: Object.fromEntries(
        Object.values(QUEUE_NAMES).map((name) => [name, QUEUE_FAILED_ALERT_THRESHOLD - 1]),
      ),
      unscraped: [],
    });
    expect(down).not.toHaveBeenCalled();
  });

  it('reports down when a queue reaches the failed threshold', () => {
    const { indicator, up, down } = buildIndicator(
      new Map([[QUEUE_NAMES.EMAIL_DELIVERY, counts(QUEUE_FAILED_ALERT_THRESHOLD)]]),
    );
    indicator.isHealthy('queue');
    expect(down).toHaveBeenCalled();
    expect(up).not.toHaveBeenCalled();
  });

  it('reports up with no queues scraped yet (empty snapshot), listing all of them', () => {
    // The first 15 seconds after boot, before the interval has fired once.
    const { indicator, up } = buildIndicator(new Map());
    indicator.isHealthy('queue');
    expect(up).toHaveBeenCalledWith({ failed: {}, unscraped: Object.values(QUEUE_NAMES) });
  });

  it('carries the unscraped list on the down path too', () => {
    const { indicator, down } = buildIndicator(
      new Map([[QUEUE_NAMES.EMAIL_DELIVERY, counts(QUEUE_FAILED_ALERT_THRESHOLD)]]),
    );
    indicator.isHealthy('queue');
    expect(down).toHaveBeenCalledWith({
      failed: { [QUEUE_NAMES.EMAIL_DELIVERY]: QUEUE_FAILED_ALERT_THRESHOLD },
      unscraped: [],
      threshold: QUEUE_FAILED_ALERT_THRESHOLD,
    });
  });
});
