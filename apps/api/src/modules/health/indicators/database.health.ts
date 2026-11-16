import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../../../common/database/prisma.service';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const start = Date.now();
      await this.prisma.client.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;
      return indicator.up({ latency });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return indicator.down({ error: message });
    }
  }
}
