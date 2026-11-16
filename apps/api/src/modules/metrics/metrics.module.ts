import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { VitalsController } from './vitals.controller';

@Module({
  controllers: [MetricsController, VitalsController],
  providers: [MetricsService, { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor }],
})
export class MetricsModule {}
