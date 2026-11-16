import { Controller, Get } from '@nestjs/common';
import { HealthCheckService, HealthCheck, MemoryHealthIndicator } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { QueueHealthIndicator } from './indicators/queue.health';

/**
 * Three health endpoints with distinct semantics:
 *
 *   GET /health        Full status incl. the queue indicator. NOT depooling:
 *                      use it for dashboards/alerts, not the load balancer.
 *                      (Differs from /health/ready by the extra queue check,
 *                      which is observability-only and must never depool.)
 *   GET /health/live   Liveness: is the process up? Trivial; never depends
 *                      on external services. Used by orchestrators to decide
 *                      whether to restart the container. A failing
 *                      /health/live with healthy /health/ready means RESTART.
 *   GET /health/ready  Readiness: is the process ready to serve traffic?
 *                      Verifies DB, Redis, memory. A failing /health/ready
 *                      means REMOVE FROM POOL but DON'T restart: a 30-second
 *                      Redis blip shouldn't cause a container kill. The queue
 *                      indicator is deliberately EXCLUDED here: a backlog of
 *                      non-critical mail must not pull the node from the pool.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly queue: QueueHealthIndicator,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    // Intentionally trivial. If the process can answer this, it's "alive".
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
      () => this.memory.checkHeap('memory', 150 * 1024 * 1024),
    ]);
  }

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
      () => this.memory.checkHeap('memory', 150 * 1024 * 1024),
      () => this.queue.isHealthy('queue'),
    ]);
  }
}
