import { Module } from '@nestjs/common';
import { TrpcRequestContextMiddleware } from './trpc-request-context.middleware';

/**
 * Its own module, a prerequisite of the tenancy boundary. Kept separate from
 * RequestContextModule to avoid a cycle: the
 * middleware imports `buildRequestContextStore` from that module's file.
 */
@Module({
  providers: [TrpcRequestContextMiddleware],
  exports: [TrpcRequestContextMiddleware],
})
export class TrpcRequestContextModule {}
