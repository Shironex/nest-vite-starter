import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { QueueMetricsService } from '../../../common/queue/queue-metrics.service';
import { QUEUE_FAILED_ALERT_THRESHOLD, QUEUE_NAMES } from '../../../common/queue/queue.constants';

/**
 * Observability-only queue health. Reads the cached counts from
 * `QueueMetricsService` (no live Redis probe) and reports `down` when any
 * queue's failed-depth (the DLQ) crosses the alert threshold.
 *
 * Intentionally wired into `GET /health` only, never `GET /health/ready`:
 * readiness failure depools the node, and a backlog of NON-critical mail must
 * not pull the API out of the load balancer. Redis reachability is already
 * covered by the separate `redis` indicator.
 *
 * `unscraped` exists because absence reads as health here and must not. This
 * indicator can only see queues the scrape has reported on, so a queue that has
 * never been scraped (one the metrics service could not resolve, or whose
 * every `getJobCounts` has thrown) simply does not appear in `failed`, and a
 * payload listing three healthy queues looks exactly like one listing four. The
 * list is diffed against `QUEUE_NAMES`, the same registry the scrape iterates, so
 * the answer names the queue nobody is watching instead of quietly omitting it.
 * It does NOT flip the indicator down: `/health` is read by humans and
 * dashboards, the first 15 seconds after every boot are legitimately unscraped,
 * and a Redis blip is already the `redis` indicator's job to report.
 */
@Injectable()
export class QueueHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly queueMetrics: QueueMetricsService,
  ) {}

  isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);

    const snapshots = this.queueMetrics.getSnapshots();
    const perQueue: Record<string, number> = {};
    let breached = false;
    for (const [queueName, counts] of snapshots) {
      perQueue[queueName] = counts.failed;
      if (counts.failed >= QUEUE_FAILED_ALERT_THRESHOLD) {
        breached = true;
      }
    }

    const unscraped = Object.values(QUEUE_NAMES).filter((name) => !snapshots.has(name));

    if (breached) {
      return indicator.down({
        failed: perQueue,
        unscraped,
        threshold: QUEUE_FAILED_ALERT_THRESHOLD,
      });
    }
    return indicator.up({ failed: perQueue, unscraped });
  }
}
