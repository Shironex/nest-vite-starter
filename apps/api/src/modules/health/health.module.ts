import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { QueueObservabilityModule } from '../../common/queue/queue-observability.module';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { QueueHealthIndicator } from './indicators/queue.health';

@Module({
  // QueueObservabilityModule exports QueueMetricsService (the cached counts the
  // queue indicator reads). TerminusModule provides HealthIndicatorService that
  // QueueHealthIndicator injects, so the indicator is provided HERE alongside
  // its siblings, not in QueueObservabilityModule.
  imports: [TerminusModule, QueueObservabilityModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, RedisHealthIndicator, QueueHealthIndicator],
})
export class HealthModule {}
