import { Module } from '@nestjs/common';
import { TrpcTimingMiddleware } from './trpc-timing.middleware';

@Module({
  providers: [TrpcTimingMiddleware],
  exports: [TrpcTimingMiddleware],
})
export class TrpcTimingModule {}
