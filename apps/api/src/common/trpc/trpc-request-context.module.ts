import { Module } from '@nestjs/common';
import { TrpcRequestContextMiddleware } from './trpc-request-context.middleware';

/**
 * Its own module rather than a second provider on TrpcTimingModule: the two
 * middlewares share only a transport, not a concern, and this one is a
 * prerequisite of the tenancy boundary rather than an observability nicety.
 *
 * Kept separate from RequestContextModule as well, to avoid a cycle: the
 * middleware imports `buildRequestContextStore` from that module's file.
 */
@Module({
  providers: [TrpcRequestContextMiddleware],
  exports: [TrpcRequestContextMiddleware],
})
export class TrpcRequestContextModule {}
