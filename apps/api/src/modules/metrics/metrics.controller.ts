import { Controller, Get, Header, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Req } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { register } from 'prom-client';

/**
 * Prometheus scrape endpoint. Protected by basic-auth driven by
 * METRICS_BASIC_AUTH (`user:password`). Drop the env var to disable auth in
 * dev. Never expose unauthenticated to the public internet: `prom-client`
 * defaults can leak event-loop / file descriptor counts an attacker could
 * use to fingerprint the deployment.
 *
 * Default-metrics registration lives in MetricsService (OnApplicationBootstrap).
 * Behind a reverse proxy, also restrict by IP at the proxy.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  @Header('Content-Type', register.contentType)
  async metrics(@Req() req: Request, @Res({ passthrough: true }) _res: Response): Promise<string> {
    const expected = this.configService.get<string>('METRICS_BASIC_AUTH');
    if (expected) {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Basic ')) {
        throw new UnauthorizedException('basic auth required');
      }
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      // Constant-time compare so the endpoint can't be used as a timing oracle.
      const a = Buffer.from(decoded);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new UnauthorizedException('invalid metrics credentials');
      }
    }

    return register.metrics();
  }
}
