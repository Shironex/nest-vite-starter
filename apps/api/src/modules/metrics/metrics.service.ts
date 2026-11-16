import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { collectDefaultMetrics } from 'prom-client';

/**
 * Registers Node-process / GC / heap default metrics with prom-client's
 * global registry. Runs after the DI graph is constructed so labels can be
 * sourced from ConfigService. Previously this side-effect ran at module
 * import time, which bypassed the NestJS lifecycle and threw on parallel
 * Jest workers because the registry rejects double-registration.
 */
@Injectable()
export class MetricsService implements OnApplicationBootstrap {
  constructor(private readonly configService: ConfigService) {}

  onApplicationBootstrap(): void {
    collectDefaultMetrics({
      prefix: 'api_',
      labels: {
        service: 'api',
        version: this.configService.get<string>('APP_VERSION') ?? 'dev',
      },
    });
  }
}
