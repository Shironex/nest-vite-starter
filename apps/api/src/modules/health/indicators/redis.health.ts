import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const start = Date.now();
      const response = await this.redis.ping();
      const latency = Date.now() - start;

      if (response === 'PONG') {
        return indicator.up({ latency });
      }
      return indicator.down({ error: `Unexpected response: ${response}` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return indicator.down({ error: message });
    }
  }
}
