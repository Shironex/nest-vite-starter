import { Module } from '@nestjs/common';
import { QueueMetricsService } from './queue-metrics.service';

/**
 * Cross-queue observability: the depth-metrics scrape that feeds `/metrics` and
 * the cached counts the queue health indicator reads.
 *
 * NO FEATURE-MODULE IMPORTS, deliberately. Importing a feature module here just
 * to make its `@InjectQueue` token resolve would point a `common/` module at the
 * features it observes, and it would make coverage depend on somebody
 * remembering to add the import, an omission nothing fails on.
 * `QueueMetricsService` resolves every name in `QUEUE_NAMES` from the
 * application container instead; see its docblock for why that is the right
 * shape for a cross-cutting observer.
 *
 * Exports `QueueMetricsService` so the health module's queue indicator can read
 * the cached counts, and AppModule keeps the @Interval scrape alive.
 *
 * The QueueHealthIndicator itself lives in HealthModule (with its sibling
 * indicators and TerminusModule's HealthIndicatorService), not here.
 */
@Module({
  providers: [QueueMetricsService],
  exports: [QueueMetricsService],
})
export class QueueObservabilityModule {}
